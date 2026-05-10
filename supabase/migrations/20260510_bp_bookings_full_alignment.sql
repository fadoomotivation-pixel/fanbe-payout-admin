-- Round-2 schema alignment for bp_bookings.
--
-- After 20260510_bp_bookings_pricing_columns.sql we still hit
-- "Could not find the 'total_amount' column of 'bp_bookings' in
-- the schema cache" because several other columns the New Booking
-- form writes are also missing on older deployments. Add every
-- remaining one in a single idempotent migration.

ALTER TABLE public.bp_bookings
  ADD COLUMN IF NOT EXISTS total_amount         numeric,
  ADD COLUMN IF NOT EXISTS plot_total_price     numeric,
  ADD COLUMN IF NOT EXISTS token_amount         numeric,
  ADD COLUMN IF NOT EXISTS token_date           date,
  ADD COLUMN IF NOT EXISTS booking_amount       numeric,
  ADD COLUMN IF NOT EXISTS booking_date         date,
  ADD COLUMN IF NOT EXISTS full_payment_amount  numeric,
  ADD COLUMN IF NOT EXISTS full_payment_date    date,
  ADD COLUMN IF NOT EXISTS commission_rate      numeric,
  ADD COLUMN IF NOT EXISTS commission_amount    numeric,
  ADD COLUMN IF NOT EXISTS scheme_name          text,
  ADD COLUMN IF NOT EXISTS application_date     date,
  ADD COLUMN IF NOT EXISTS booking_time         time,
  ADD COLUMN IF NOT EXISTS customer_bank_name   text,
  ADD COLUMN IF NOT EXISTS upline_broker_code   text,
  ADD COLUMN IF NOT EXISTS manager_signature_by text,
  ADD COLUMN IF NOT EXISTS affidavit_accepted   boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS payment_type         text,
  ADD COLUMN IF NOT EXISTS notes                text,
  ADD COLUMN IF NOT EXISTS project_id           uuid;

NOTIFY pgrst, 'reload schema';
