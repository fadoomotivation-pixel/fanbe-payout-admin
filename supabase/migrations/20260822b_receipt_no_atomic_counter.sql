-- Hardens the receipt number introduced in 20260822_receipt_no_customer_format.sql.
--
-- Format stays as the admin asked for: <first two letters of name><id no>/<receipt count>
-- e.g. Mu780/1.  What changes is HOW the count is produced.
--
-- The first cut counted existing rows:
--     SELECT count(*) FROM bp_payments WHERE customer_id = X
-- That is wrong in two ways that would both have shown up on live data:
--
--   1. It goes BACKWARDS when a payment is deleted.  pdc_bounce_cheque() deletes the
--      payment row when a cheque bounces.  Customer holds receipts /1 /2 /3, the cheque
--      behind /2 bounces, count drops to 2, and the next receipt is issued as /3 —
--      a duplicate of a receipt already printed and handed to a customer.
--
--   2. Two payments saved at the same moment both read the same count and both get the
--      same number, because the count was read in a separate round trip from the insert.
--
-- Fix: a per-customer counter row that only ever moves up, incremented atomically in the
-- same statement that reads it, plus a unique index so a duplicate can never reach the
-- table quietly.  Receipt numbers are now assigned by a BEFORE INSERT trigger, so every
-- payment gets one from a single code path instead of five separate callers.

-- ── Per-customer counter ────────────────────────────────────────────
-- Deliberately no FK to bp_customers: this must keep counting even if a customer row is
-- ever removed, so a number can never be handed out twice.
CREATE TABLE IF NOT EXISTS public.bp_customer_receipt_seq (
  customer_id uuid PRIMARY KEY,
  last_no     int  NOT NULL DEFAULT 0
);

ALTER TABLE public.bp_customer_receipt_seq ENABLE ROW LEVEL SECURITY;
-- No policies on purpose.  Only generate_receipt_no() (SECURITY DEFINER, owned by the
-- table owner) touches this table; nothing should reach it directly from the client.

-- Seed from history so customers who already hold receipts carry on counting instead of
-- restarting at /1.
INSERT INTO public.bp_customer_receipt_seq (customer_id, last_no)
SELECT customer_id, count(*)
  FROM public.bp_payments
 WHERE customer_id IS NOT NULL
   AND receipt_no IS NOT NULL
   AND receipt_no <> ''
 GROUP BY customer_id
ON CONFLICT (customer_id) DO NOTHING;

-- ── Receipt number generator ────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.generate_receipt_no(p_customer_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_name      text;
  v_code      text;
  v_prefix    text;
  v_num       text;
  v_n         int;
  v_candidate text;
  v_guard     int := 0;
BEGIN
  -- A payment with no customer attached still needs a receipt; fall back to the old
  -- global RCT- sequence rather than inventing a half-formed number.
  IF p_customer_id IS NULL THEN
    RETURN public.next_receipt_no();
  END IF;

  SELECT name, customer_code INTO v_name, v_code
    FROM public.bp_customers
   WHERE id = p_customer_id;

  IF NOT FOUND THEN
    RETURN public.next_receipt_no();
  END IF;

  -- First two letters of the name: capital, then lowercase (Mukesh -> Mu).
  -- Spaces, digits and punctuation are dropped first so "  mukesh" still gives "Mu".
  v_name := regexp_replace(coalesce(v_name, ''), '[^a-zA-Z]', '', 'g');
  IF v_name = '' THEN
    v_prefix := 'XX';                      -- name is blank or has no letters at all
  ELSE
    v_prefix := upper(left(v_name, 1)) || lower(substring(v_name from 2 for 1));
  END IF;

  -- Numeric part of the customer code: CR-0072 -> 72, FNB05074 -> 5074.
  v_num := ltrim(regexp_replace(coalesce(v_code, ''), '[^0-9]', '', 'g'), '0');
  IF v_num = '' THEN
    v_num := '0';
  END IF;

  LOOP
    -- Atomic read-and-increment.  Concurrent payments for the same customer serialise on
    -- this row, so each one leaves with a different number.
    INSERT INTO public.bp_customer_receipt_seq AS s (customer_id, last_no)
    VALUES (p_customer_id, 1)
    ON CONFLICT (customer_id) DO UPDATE SET last_no = s.last_no + 1
    RETURNING s.last_no INTO v_n;

    v_candidate := v_prefix || v_num || '/' || v_n;

    -- Two different customers can still collide (same first two letters AND same digits,
    -- e.g. CR-0072 and FNB00072 both named Poonam).  Rare, but it would be a duplicate
    -- receipt, so step this customer's counter forward until the number is free instead
    -- of failing the save in front of the admin.
    EXIT WHEN NOT EXISTS (
      SELECT 1 FROM public.bp_payments WHERE receipt_no = v_candidate
    );

    v_guard := v_guard + 1;
    IF v_guard > 1000 THEN
      RETURN public.next_receipt_no();
    END IF;
  END LOOP;

  RETURN v_candidate;
END;
$$;

GRANT EXECUTE ON FUNCTION public.generate_receipt_no(uuid) TO anon, authenticated, service_role;

-- ── One birthplace for receipt numbers ──────────────────────────────
-- Assigning on the row as it is inserted removes the read-then-insert gap the client
-- round trip used to leave open, and guarantees no payment can be saved without one.
-- A receipt number typed in by hand on the Payments page is respected as-is.
CREATE OR REPLACE FUNCTION public.bp_payments_set_receipt_no()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.receipt_no IS NULL OR NEW.receipt_no = '' THEN
    NEW.receipt_no := public.generate_receipt_no(NEW.customer_id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_bp_payments_receipt_no ON public.bp_payments;
CREATE TRIGGER trg_bp_payments_receipt_no
BEFORE INSERT ON public.bp_payments
FOR EACH ROW EXECUTE FUNCTION public.bp_payments_set_receipt_no();

-- ── Last line of defence ────────────────────────────────────────────
-- If anything ever tries to write a receipt number that is already in use, it fails here
-- instead of quietly creating a second receipt with the same number.
CREATE UNIQUE INDEX IF NOT EXISTS bp_payments_receipt_no_uniq
  ON public.bp_payments (receipt_no)
  WHERE receipt_no IS NOT NULL AND receipt_no <> '';

-- ── PDC clearing hands the job to the trigger ───────────────────────
CREATE OR REPLACE FUNCTION public.pdc_clear_cheque(p_cheque_id uuid, p_cleared_on date DEFAULT CURRENT_DATE)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  c          record;
  v_payment  uuid;
  v_sponsor  text;
BEGIN
  SELECT * INTO c FROM public.bp_pdc_cheques WHERE id = p_cheque_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Cheque not found';
  END IF;
  IF c.payment_id IS NOT NULL OR c.status = 'cleared' THEN
    RAISE EXCEPTION 'This cheque is already marked cleared -- no second payment was created.';
  END IF;
  IF c.status = 'cancelled' THEN
    RAISE EXCEPTION 'This cheque was cancelled. Re-enter it as a new cheque instead.';
  END IF;

  SELECT b.name INTO v_sponsor
    FROM public.bp_bookings bk
    LEFT JOIN public.brokers b ON b.id = bk.broker_id
   WHERE bk.id = c.booking_id;

  INSERT INTO public.bp_payments (
    booking_id, customer_id, payment_type, amount, payment_mode,
    cheque_no, bank_name, drawn_on_bank, branch,
    payment_date, verification_status, verified_at,
    subject_to_realisation, sponsor_name, notes
  ) VALUES (
    c.booking_id, c.customer_id, c.payment_type, c.amount, 'cheque',
    c.cheque_no, c.bank_name, c.bank_name, c.branch,
    p_cleared_on, 'verified', now(),
    false, v_sponsor,
    'Cleared PDC cheque ' || c.cheque_no
  )
  RETURNING id INTO v_payment;

  UPDATE public.bp_pdc_cheques
     SET status = 'cleared', cleared_on = p_cleared_on, payment_id = v_payment,
         bounce_reason = NULL
   WHERE id = c.id;

  RETURN v_payment;
END;
$$;
