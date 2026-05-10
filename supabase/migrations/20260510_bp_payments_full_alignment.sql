-- Align bp_payments with the columns recordPaymentRow() in
-- src/pages/Bookings.tsx writes. Same pattern as the bp_bookings
-- alignment migrations: idempotent, ADD COLUMN IF NOT EXISTS for
-- everything, then reload PostgREST schema cache.

ALTER TABLE public.bp_payments
  ADD COLUMN IF NOT EXISTS booking_id           uuid,
  ADD COLUMN IF NOT EXISTS customer_id          uuid,
  ADD COLUMN IF NOT EXISTS payment_type         text,
  ADD COLUMN IF NOT EXISTS amount               numeric,
  ADD COLUMN IF NOT EXISTS payment_mode         text,
  ADD COLUMN IF NOT EXISTS utr_ref              text,
  ADD COLUMN IF NOT EXISTS payment_date         date,
  ADD COLUMN IF NOT EXISTS verification_status  text NOT NULL DEFAULT 'verified',
  ADD COLUMN IF NOT EXISTS verified_at          timestamptz,
  ADD COLUMN IF NOT EXISTS receipt_no           text,
  ADD COLUMN IF NOT EXISTS drawn_on_bank        text,
  ADD COLUMN IF NOT EXISTS branch               text,
  ADD COLUMN IF NOT EXISTS sponsor_name         text;

-- Relax any legacy CHECK constraints that may reject the values
-- the form writes (payment_type / payment_mode / verification_status).

ALTER TABLE public.bp_payments
  DROP CONSTRAINT IF EXISTS bp_payments_payment_type_check;
ALTER TABLE public.bp_payments
  ADD CONSTRAINT bp_payments_payment_type_check
  CHECK (payment_type IN ('token','booking','emi','full','full_payment'))
  NOT VALID;

ALTER TABLE public.bp_payments
  DROP CONSTRAINT IF EXISTS bp_payments_payment_mode_check;
ALTER TABLE public.bp_payments
  ADD CONSTRAINT bp_payments_payment_mode_check
  CHECK (payment_mode IN ('cash','neft','rtgs','imps','upi','cheque','dd'))
  NOT VALID;

ALTER TABLE public.bp_payments
  DROP CONSTRAINT IF EXISTS bp_payments_verification_status_check;
ALTER TABLE public.bp_payments
  ADD CONSTRAINT bp_payments_verification_status_check
  CHECK (verification_status IN ('pending','verified','rejected'))
  NOT VALID;

NOTIFY pgrst, 'reload schema';
