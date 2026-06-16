-- Bug: recompute_booking_payouts() inserts income_type='traditional_direct' for
-- the direct broker on a traditional booking and 'traditional_split' for each
-- multi-broker split row, but payout_distributions.income_type CHECK constraint
-- only allowed ('direct','differential','income1','income2','income3').
--
-- Result: every attempt to add a payment to a traditional booking failed with a
-- check-constraint violation INSIDE the trigger, which Postgres reports back to
-- the React client as a generic "Could not save the booking" toast.  The booking
-- row was actually saved (the bp_bookings INSERT had already committed), but the
-- payment was rolled back -- leaving orphan bookings with token_amount set but
-- no actual bp_payments row.  That is why traditional bookings TR-2026-0001/
-- 0003/0004/0006/0007 have token_amount populated on the booking row yet zero
-- bp_payments rows.
--
-- Fix: widen the CHECK to allow the two traditional values, then recompute any
-- traditional bookings that did manage to land a payment row, so their payout
-- distributions are created on the corrected path.

ALTER TABLE public.payout_distributions
  DROP CONSTRAINT IF EXISTS payout_distributions_income_type_check;

ALTER TABLE public.payout_distributions
  ADD CONSTRAINT payout_distributions_income_type_check
  CHECK (income_type = ANY (ARRAY[
    'direct'::text,
    'differential'::text,
    'income1'::text,
    'income2'::text,
    'income3'::text,
    'traditional_direct'::text,
    'traditional_split'::text
  ]));

DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT DISTINCT bk.id
    FROM public.bp_bookings bk
    WHERE bk.broker_id IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM public.bp_payments p
         WHERE p.booking_id = bk.id AND p.verification_status = 'verified'
      )
  LOOP
    PERFORM public.recompute_booking_payouts(r.id);
  END LOOP;
END $$;
