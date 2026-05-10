-- Ensure bp_bookings has all the pricing-breakdown columns the
-- New Booking form writes to. Earlier deployments may be missing some
-- of these (notably discount_amount), causing PostgREST schema-cache
-- errors like:
--   "Could not find the 'discount_amount' column of 'bp_bookings'
--    in the schema cache"
--
-- Idempotent: every column is added only if it does not already exist.

ALTER TABLE public.bp_bookings
  ADD COLUMN IF NOT EXISTS size_sqyd        numeric,
  ADD COLUMN IF NOT EXISTS rate_per_sqyd    numeric,
  ADD COLUMN IF NOT EXISTS base_price       numeric,
  ADD COLUMN IF NOT EXISTS dev_charges      numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS plc_charges      numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS discount_amount  numeric NOT NULL DEFAULT 0;

-- Force PostgREST to reload the schema cache so the new columns are
-- visible immediately to the front-end client.
NOTIFY pgrst, 'reload schema';
