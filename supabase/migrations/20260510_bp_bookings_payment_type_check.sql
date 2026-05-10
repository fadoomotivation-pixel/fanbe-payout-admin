-- The New Booking form writes payment_type values:
--   'token' | 'booking' | 'emi' | 'full' | 'full_payment'
-- The existing CHECK constraint on bp_bookings.payment_type was
-- written for an older value set and rejects these, raising:
--   new row for relation "bp_bookings" violates check constraint
--   "bp_bookings_payment_type_check"
-- Replace it with one that matches the form.

ALTER TABLE public.bp_bookings
  DROP CONSTRAINT IF EXISTS bp_bookings_payment_type_check;

ALTER TABLE public.bp_bookings
  ADD CONSTRAINT bp_bookings_payment_type_check
  CHECK (payment_type IN ('token','booking','emi','full','full_payment'));

NOTIFY pgrst, 'reload schema';
