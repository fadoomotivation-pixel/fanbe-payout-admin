-- Two unrelated gaps the admin hit on the same day.
--
-- 1. "CR-0780 to CR-0784 missing"
--    Nothing was lost.  Those five customers were later made brokers, and
--    sync_customer_code_with_broker() rewrites customer_code from CR-xxxx to the broker id
--    (CR-0781 -> FNB05093 and so on) so that one person carries one number across the
--    business.  The old code was simply overwritten, so searching the paperwork number
--    returned nothing and it looked like a deletion.
--    Fix: keep the old code in a column of its own and make it searchable.
--
-- 2. "who is accountable is there in expense head but not whom received the money"
--    An expense recorded who authorised it but not who the cash went to, so a disputed
--    payment had only one name on it.

-- ── 1. The code a customer used to carry ────────────────────────────
ALTER TABLE public.bp_customers
  ADD COLUMN IF NOT EXISTS previous_customer_code text;

COMMENT ON COLUMN public.bp_customers.previous_customer_code IS
  'The CR-xxxx code this customer held before becoming a broker. Kept so the number on the original paperwork still finds the record.';

CREATE INDEX IF NOT EXISTS bp_customers_prev_code_idx
  ON public.bp_customers (previous_customer_code)
  WHERE previous_customer_code IS NOT NULL;

-- Backfill for codes already overwritten before this column existed.  The activity log
-- recorded the change (customer_code: from CR-xxxx to FNBxxxxx), so the history is
-- recoverable from it.  Only the FIRST recorded code is taken -- that is the one printed
-- on the file -- and rows that already carry a value are left alone, so re-running this
-- migration changes nothing.
UPDATE public.bp_customers c
   SET previous_customer_code = f.old_code
  FROM (
    SELECT DISTINCT ON (l.entity_id)
           l.entity_id,
           l.changes->'customer_code'->>'from' AS old_code
      FROM public.bp_activity_log l
     WHERE l.table_name = 'bp_customers'
       AND l.action = 'updated'
       AND l.changes ? 'customer_code'
       AND l.changes->'customer_code'->>'from' LIKE 'CR-%'
     ORDER BY l.entity_id, l.at ASC
  ) f
 WHERE c.id::text = f.entity_id
   AND c.previous_customer_code IS NULL
   AND c.customer_code IS DISTINCT FROM f.old_code;

-- From here on the trigger keeps it up to date itself, so no backfill is ever needed again.
CREATE OR REPLACE FUNCTION public.sync_customer_code_with_broker()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_old_code text;
  b_row record;
  v_idx integer;
BEGIN
  IF NEW.customer_id IS NULL
     OR NEW.broker_id IS NULL
     OR btrim(NEW.broker_id) = '' THEN
    RETURN NEW;
  END IF;

  SELECT customer_code INTO v_old_code FROM public.bp_customers WHERE id = NEW.customer_id;

  IF v_old_code IS DISTINCT FROM NEW.broker_id THEN
    UPDATE public.bp_customers
       SET customer_code = NEW.broker_id,
           -- Only the FIRST code this person was issued is worth keeping: that is the one
           -- on the paperwork.  coalesce stops a later change from overwriting it.
           previous_customer_code = coalesce(previous_customer_code, v_old_code)
     WHERE id = NEW.customer_id;

    v_idx := 0;
    FOR b_row IN
      SELECT id FROM public.bp_bookings
       WHERE customer_id = NEW.customer_id
       ORDER BY created_at
    LOOP
      v_idx := v_idx + 1;
      UPDATE public.bp_bookings
         SET booking_no = CASE WHEN v_idx = 1 THEN NEW.broker_id
                               ELSE NEW.broker_id || '-' || v_idx::text END
       WHERE id = b_row.id;
    END LOOP;
  END IF;
  RETURN NEW;
END;
$$;

-- ── 2. Who the money actually went to ───────────────────────────────
ALTER TABLE public.expenses
  ADD COLUMN IF NOT EXISTS paid_to      text,
  ADD COLUMN IF NOT EXISTS paid_by      text,
  ADD COLUMN IF NOT EXISTS payment_mode text,
  ADD COLUMN IF NOT EXISTS reference_no text;

COMMENT ON COLUMN public.expenses.paid_to      IS 'Who received the money — vendor, staff member or broker name.';
COMMENT ON COLUMN public.expenses.paid_by      IS 'Who handed it over, so a disputed payment has two names on it.';
COMMENT ON COLUMN public.expenses.payment_mode IS 'cash / upi / bank / cheque — how it left the business.';
COMMENT ON COLUMN public.expenses.reference_no IS 'UTR, cheque number or bill number backing the payment.';
