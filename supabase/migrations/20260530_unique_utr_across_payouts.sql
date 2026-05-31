-- UTR is a Unique Transaction Reference by definition.  Enforce that no two rows across
-- bp_payments / bp_payout_transactions / withdrawal_requests can ever share the same UTR.
-- Two layers:
--   1. Partial UNIQUE INDEX per table (UTR not null AND not empty) catches same-table dupes.
--   2. BEFORE INSERT/UPDATE trigger scans the other two tables and raises a friendly
--      unique_violation, naming the table the conflict lives on.
--
-- Cash / cheque payments leave UTR blank → both layers ignore NULL/empty.

-- 1. Tag the one pre-existing duplicate so the constraint can be added cleanly.
--    Same booking BK-00016, same amount, same date — this was a test-mode receipt with
--    placeholder UTR "1234567890".  We rename the OLDER row to preserve audit trail.
UPDATE public.bp_payments
SET    utr_ref = '1234567890-LEGACY-' || left(id::text, 8)
WHERE  id = '4e1f26c6-6c3b-4828-8714-309b6425647f'
  AND  utr_ref = '1234567890';

CREATE UNIQUE INDEX IF NOT EXISTS bp_payments_utr_ref_unique_idx
  ON public.bp_payments (utr_ref)
  WHERE utr_ref IS NOT NULL AND utr_ref <> '';

CREATE UNIQUE INDEX IF NOT EXISTS bp_payout_transactions_utr_ref_unique_idx
  ON public.bp_payout_transactions (utr_ref)
  WHERE utr_ref IS NOT NULL AND utr_ref <> '';

CREATE UNIQUE INDEX IF NOT EXISTS withdrawal_requests_utr_unique_idx
  ON public.withdrawal_requests (utr)
  WHERE utr IS NOT NULL AND utr <> '';

CREATE OR REPLACE FUNCTION public.check_utr_unique_cross_tables()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_utr  text;
  v_self text;
  v_id   uuid;
  v_hit  text;
BEGIN
  IF TG_TABLE_NAME = 'withdrawal_requests' THEN
    v_utr  := NEW.utr;
    v_self := 'withdrawal_requests';
  ELSE
    v_utr  := NEW.utr_ref;
    v_self := TG_TABLE_NAME;
  END IF;
  v_id := NEW.id;

  IF v_utr IS NULL OR v_utr = '' THEN
    RETURN NEW;
  END IF;

  -- Same-table check FIRST so the friendly message wins over the raw partial-index error.
  IF v_self = 'bp_payments' AND EXISTS (
    SELECT 1 FROM public.bp_payments WHERE utr_ref = v_utr AND id <> v_id
  ) THEN
    v_hit := 'another customer payment receipt';
  ELSIF v_self = 'bp_payout_transactions' AND EXISTS (
    SELECT 1 FROM public.bp_payout_transactions WHERE utr_ref = v_utr AND id <> v_id
  ) THEN
    v_hit := 'another broker cycle payout';
  ELSIF v_self = 'withdrawal_requests' AND EXISTS (
    SELECT 1 FROM public.withdrawal_requests WHERE utr = v_utr AND id <> v_id
  ) THEN
    v_hit := 'another broker withdrawal';
  -- Cross-table checks
  ELSIF v_self <> 'bp_payments' AND EXISTS (
    SELECT 1 FROM public.bp_payments WHERE utr_ref = v_utr
  ) THEN
    v_hit := 'a customer payment receipt';
  ELSIF v_self <> 'bp_payout_transactions' AND EXISTS (
    SELECT 1 FROM public.bp_payout_transactions WHERE utr_ref = v_utr
  ) THEN
    v_hit := 'a broker cycle payout';
  ELSIF v_self <> 'withdrawal_requests' AND EXISTS (
    SELECT 1 FROM public.withdrawal_requests WHERE utr = v_utr
  ) THEN
    v_hit := 'a broker withdrawal';
  END IF;

  IF v_hit IS NOT NULL THEN
    RAISE EXCEPTION 'Duplicate UTR % — already used on %. UTR numbers must be unique across the system.', v_utr, v_hit
      USING ERRCODE = 'unique_violation';
  END IF;

  RETURN NEW;
END $fn$;

DROP TRIGGER IF EXISTS bp_payments_utr_unique ON public.bp_payments;
CREATE TRIGGER bp_payments_utr_unique
BEFORE INSERT OR UPDATE OF utr_ref ON public.bp_payments
FOR EACH ROW EXECUTE FUNCTION public.check_utr_unique_cross_tables();

DROP TRIGGER IF EXISTS bp_payout_transactions_utr_unique ON public.bp_payout_transactions;
CREATE TRIGGER bp_payout_transactions_utr_unique
BEFORE INSERT OR UPDATE OF utr_ref ON public.bp_payout_transactions
FOR EACH ROW EXECUTE FUNCTION public.check_utr_unique_cross_tables();

DROP TRIGGER IF EXISTS withdrawal_requests_utr_unique ON public.withdrawal_requests;
CREATE TRIGGER withdrawal_requests_utr_unique
BEFORE INSERT OR UPDATE OF utr ON public.withdrawal_requests
FOR EACH ROW EXECUTE FUNCTION public.check_utr_unique_cross_tables();

NOTIFY pgrst, 'reload schema';
