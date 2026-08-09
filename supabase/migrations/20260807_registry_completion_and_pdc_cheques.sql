-- Two admin asks, plus the data-integrity bug they surfaced.
--
--   1. "Registry complete hone par status update"  -- record when a plot is actually
--      registered in the customer's name and move the plot to its terminal state.
--   2. "Aane wale PDC cheques ki entry"            -- post-dated cheques handed over at
--      booking time, tracked until they clear or bounce.
--
-- ── Why PDCs are NOT bp_payments rows ────────────────────────────────────────
-- A post-dated cheque is a promise, not money.  Putting it in bp_payments would:
--   * inflate total_collected / balance_due via trg_update_booking_totals, and
--   * fire trg_payment_recompute, paying the broker commission on money that has
--     not arrived (and may bounce).
-- So PDCs live in their own table and become exactly ONE bp_payments row at the
-- moment they clear -- see pdc_clear_cheque() below.  The unique payment_id link is
-- what makes double-clearing impossible.

-- ── 1) Registry completion fields on the booking ─────────────────────────────
-- registry_date + registry_notes already exist but were never written by the live
-- app.  Registry "status" is deliberately NOT a separate column: it is derived from
-- registry_date IS NOT NULL, so a status and a date can never disagree.
ALTER TABLE public.bp_bookings
  ADD COLUMN IF NOT EXISTS registry_doc_no       text,
  ADD COLUMN IF NOT EXISTS registry_office       text,
  ADD COLUMN IF NOT EXISTS registry_completed_at timestamptz,
  ADD COLUMN IF NOT EXISTS registry_completed_by uuid;

-- ── 2) PDC cheque register ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.bp_pdc_cheques (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id    uuid NOT NULL REFERENCES public.bp_bookings(id) ON DELETE CASCADE,
  customer_id   uuid REFERENCES public.bp_customers(id),
  cheque_no     text NOT NULL,
  bank_name     text,
  branch        text,
  -- The date written ON the cheque: when it may be banked.
  cheque_date   date NOT NULL,
  amount        numeric NOT NULL CHECK (amount > 0),
  -- Which bucket the cleared money lands in.  Mirrors bp_payments.payment_type so
  -- the row created on clearing always satisfies bp_payments_payment_type_check.
  payment_type  text NOT NULL DEFAULT 'emi'
                CHECK (payment_type = ANY (ARRAY['token','booking','emi','full','full_payment'])),
  status        text NOT NULL DEFAULT 'pending'
                CHECK (status = ANY (ARRAY['pending','deposited','cleared','bounced','cancelled'])),
  deposited_on  date,
  cleared_on    date,
  bounce_reason text,
  notes         text,
  -- Set only by pdc_clear_cheque().  UNIQUE = one cheque can never produce two
  -- payments, and one payment can never be claimed by two cheques.
  payment_id    uuid UNIQUE REFERENCES public.bp_payments(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  -- A cheque is only 'cleared' if it actually produced a payment.
  CONSTRAINT bp_pdc_cleared_needs_payment
    CHECK (status <> 'cleared' OR payment_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_bp_pdc_booking ON public.bp_pdc_cheques(booking_id);
CREATE INDEX IF NOT EXISTS idx_bp_pdc_due     ON public.bp_pdc_cheques(cheque_date) WHERE status IN ('pending','deposited');

-- The same physical cheque must not be entered twice.  Cheque numbers repeat across
-- banks, so identity is (number + bank).  Cancelled entries are excluded so a
-- mis-keyed cheque can be voided and re-entered correctly.
CREATE UNIQUE INDEX IF NOT EXISTS uq_bp_pdc_cheque_identity
  ON public.bp_pdc_cheques (lower(btrim(cheque_no)), lower(btrim(coalesce(bank_name, ''))))
  WHERE status <> 'cancelled';

ALTER TABLE public.bp_pdc_cheques ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_select ON public.bp_pdc_cheques;
DROP POLICY IF EXISTS p_insert ON public.bp_pdc_cheques;
DROP POLICY IF EXISTS p_update ON public.bp_pdc_cheques;
DROP POLICY IF EXISTS p_delete ON public.bp_pdc_cheques;
CREATE POLICY p_select ON public.bp_pdc_cheques FOR SELECT TO authenticated USING (true);
CREATE POLICY p_insert ON public.bp_pdc_cheques FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY p_update ON public.bp_pdc_cheques FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY p_delete ON public.bp_pdc_cheques FOR DELETE TO authenticated USING (true);

DROP TRIGGER IF EXISTS trg_bp_pdc_updated ON public.bp_pdc_cheques;
CREATE TRIGGER trg_bp_pdc_updated BEFORE UPDATE ON public.bp_pdc_cheques
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ── 3) Clearing a cheque: cheque row + payment row in ONE transaction ────────
-- Doing this from the client as "insert payment, then update cheque" can leave an
-- orphan payment if the second call fails, and a double-click can post twice.  The
-- row lock + payment_id check below make both impossible.
CREATE OR REPLACE FUNCTION public.pdc_clear_cheque(
  p_cheque_id  uuid,
  p_cleared_on date DEFAULT current_date
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  c          record;
  v_payment  uuid;
  v_receipt  text;
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

  BEGIN
    v_receipt := public.next_receipt_no();
  EXCEPTION WHEN undefined_function THEN
    v_receipt := NULL;
  END;

  INSERT INTO public.bp_payments (
    booking_id, customer_id, payment_type, amount, payment_mode,
    cheque_no, bank_name, drawn_on_bank, branch,
    payment_date, verification_status, verified_at, receipt_no,
    subject_to_realisation, sponsor_name, notes
  ) VALUES (
    c.booking_id, c.customer_id, c.payment_type, c.amount, 'cheque',
    c.cheque_no, c.bank_name, c.bank_name, c.branch,
    p_cleared_on, 'verified', now(), v_receipt,
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

-- ── 4) Bouncing a cheque, including one that was wrongly marked cleared ──────
-- Deleting the payment lets trg_payment_recompute strip the commission it created.
-- A payout cycle that already went out is NOT silently unwound -- admin must reopen
-- the cycle first, same rule reversePaymentCommission() enforces client-side.
CREATE OR REPLACE FUNCTION public.pdc_bounce_cheque(
  p_cheque_id uuid,
  p_reason    text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  c          record;
  cycled     int;
  v_payment  uuid;
BEGIN
  SELECT * INTO c FROM public.bp_pdc_cheques WHERE id = p_cheque_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Cheque not found';
  END IF;

  v_payment := c.payment_id;

  IF v_payment IS NOT NULL THEN
    SELECT count(*) INTO cycled
      FROM public.payout_distributions
     WHERE payment_id = v_payment AND cycle_id IS NOT NULL;
    IF cycled > 0 THEN
      RAISE EXCEPTION 'Commission on this cheque is already in a closed payout cycle. Reopen that cycle on /payout-cycles before bouncing it.';
    END IF;
  END IF;

  -- Status and payment_id have to move together: bp_pdc_cleared_needs_payment
  -- rejects a 'cleared' row whose payment_id has been nulled.
  UPDATE public.bp_pdc_cheques
     SET status = 'bounced', bounce_reason = p_reason, cleared_on = NULL, payment_id = NULL
   WHERE id = c.id;

  -- Dropping the payment lets trg_payment_recompute strip the commission it created.
  IF v_payment IS NOT NULL THEN
    DELETE FROM public.bp_payments WHERE id = v_payment;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.pdc_clear_cheque(uuid, date)  TO authenticated;
GRANT EXECUTE ON FUNCTION public.pdc_bounce_cheque(uuid, text) TO authenticated;

-- Reports has a "delete this payment row" action.  Deleting a receipt that a cleared
-- cheque owns would fire the FK's ON DELETE SET NULL and trip
-- bp_pdc_cleared_needs_payment -- correct (it fails closed) but the raw constraint
-- error tells admin nothing.  Say what to do instead.
-- pdc_bounce_cheque() clears payment_id before deleting, so it is unaffected.
CREATE OR REPLACE FUNCTION public.block_delete_of_pdc_payment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cheque text;
BEGIN
  SELECT cheque_no INTO v_cheque FROM public.bp_pdc_cheques WHERE payment_id = OLD.id;
  IF v_cheque IS NOT NULL THEN
    RAISE EXCEPTION 'This receipt was created by PDC cheque %. Mark that cheque bounced on the PDC Cheques page -- that reverses the receipt and the commission together.', v_cheque;
  END IF;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_block_delete_of_pdc_payment ON public.bp_payments;
CREATE TRIGGER trg_block_delete_of_pdc_payment
  BEFORE DELETE ON public.bp_payments
  FOR EACH ROW EXECUTE FUNCTION public.block_delete_of_pdc_payment();

-- ── 5) Bug fix: bp_plots has no 'sold' status ────────────────────────────────
-- bp_plots_status_check allows available / token / booked / registry_done / cancelled.
-- Closing a booking wrote status='sold', which the constraint rejects -- and the app
-- never checked that update for an error, so the plot silently stayed 'booked'.
-- 'registry_done' is this schema's terminal state, so any plot on a closed
-- booking_done booking is corrected to it here; the app is fixed to match.
UPDATE public.bp_plots p
   SET status = 'registry_done'
  FROM public.bp_bookings b
 WHERE b.plot_id = p.id
   AND b.closed_at IS NOT NULL
   AND b.stage = 'booking_done'
   AND p.status = 'booked';
