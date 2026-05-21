-- Track the PLANNED booking deposit when token-only is paid today.
-- Does NOT trigger MLM (commission is per-payment when actually received).
ALTER TABLE public.bp_bookings
  ADD COLUMN IF NOT EXISTS expected_booking_amount numeric;

COMMENT ON COLUMN public.bp_bookings.expected_booking_amount IS
  'Planned/committed booking deposit amount, even if unpaid. MLM does not distribute on this value; only on actual verified payments.';
