-- Form sends stage values: 'token_received' | 'booking_done' | 'cancelled'.
-- The existing CHECK constraint uses an older value set and rejects them:
--   new row for relation "bp_bookings" violates check constraint
--   "bp_bookings_stage_check"
-- Replace it with one that matches the form.

ALTER TABLE public.bp_bookings
  DROP CONSTRAINT IF EXISTS bp_bookings_stage_check;

ALTER TABLE public.bp_bookings
  ADD CONSTRAINT bp_bookings_stage_check
  CHECK (stage IN ('token_received','booking_done','cancelled'));

NOTIFY pgrst, 'reload schema';
