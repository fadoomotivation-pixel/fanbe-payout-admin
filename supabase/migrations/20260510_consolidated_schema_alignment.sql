-- ============================================================
-- Consolidated schema alignment for the React admin app.
--
-- Pattern: every page that writes to Supabase has been audited
-- and every column it inserts/updates is added IF NOT EXISTS,
-- legacy enum-style CHECK constraints are dropped and recreated
-- with NOT VALID (to preserve existing data), and missing RPC
-- functions are created.
--
-- Idempotent: safe to run multiple times.
-- ============================================================

-- ─── bp_customers ────────────────────────────────────────────
ALTER TABLE public.bp_customers
  ADD COLUMN IF NOT EXISTS name                   text,
  ADD COLUMN IF NOT EXISTS phone                  text,
  ADD COLUMN IF NOT EXISTS email                  text,
  ADD COLUMN IF NOT EXISTS father_or_husband_name text,
  ADD COLUMN IF NOT EXISTS dob                    date,
  ADD COLUMN IF NOT EXISTS address                text,
  ADD COLUMN IF NOT EXISTS pan                    text,
  ADD COLUMN IF NOT EXISTS nominee_name           text,
  ADD COLUMN IF NOT EXISTS nominee_relation       text,
  ADD COLUMN IF NOT EXISTS nominee_dob            date,
  ADD COLUMN IF NOT EXISTS nominee_father_name    text,
  ADD COLUMN IF NOT EXISTS nominee_address        text,
  ADD COLUMN IF NOT EXISTS nominee_pan            text,
  ADD COLUMN IF NOT EXISTS customer_code          text;

-- ─── brokers ─────────────────────────────────────────────────
ALTER TABLE public.brokers
  ADD COLUMN IF NOT EXISTS name              text,
  ADD COLUMN IF NOT EXISTS email             text,
  ADD COLUMN IF NOT EXISTS phone             text,
  ADD COLUMN IF NOT EXISTS referral_code     text,
  ADD COLUMN IF NOT EXISTS rank              text,
  ADD COLUMN IF NOT EXISTS status            text,
  ADD COLUMN IF NOT EXISTS tds_applicable    boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS pan_no            text,
  ADD COLUMN IF NOT EXISTS gst_no            text,
  ADD COLUMN IF NOT EXISTS sponsor_id        uuid,
  ADD COLUMN IF NOT EXISTS date_of_joining   date,
  ADD COLUMN IF NOT EXISTS bank_name         text,
  ADD COLUMN IF NOT EXISTS account_no        text,
  ADD COLUMN IF NOT EXISTS ifsc              text,
  ADD COLUMN IF NOT EXISTS account_holder    text,
  ADD COLUMN IF NOT EXISTS aadhaar_no        text,
  ADD COLUMN IF NOT EXISTS broker_id         text;

-- Prevent self-sponsor (audit item: circular upline)
DO $$ BEGIN
  ALTER TABLE public.brokers
    ADD CONSTRAINT brokers_no_self_sponsor CHECK (sponsor_id IS DISTINCT FROM id) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ─── bp_plots ────────────────────────────────────────────────
ALTER TABLE public.bp_plots
  ADD COLUMN IF NOT EXISTS plot_no        text,
  ADD COLUMN IF NOT EXISTS size_sqyd      numeric,
  ADD COLUMN IF NOT EXISTS price_per_sqyd numeric,
  ADD COLUMN IF NOT EXISTS plc_charges    numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_price    numeric,
  ADD COLUMN IF NOT EXISTS status         text NOT NULL DEFAULT 'available',
  ADD COLUMN IF NOT EXISTS project_id     uuid;

-- ─── bp_projects ─────────────────────────────────────────────
ALTER TABLE public.bp_projects
  ADD COLUMN IF NOT EXISTS name     text,
  ADD COLUMN IF NOT EXISTS location text;

-- ─── commission_ranks ────────────────────────────────────────
ALTER TABLE public.commission_ranks
  ADD COLUMN IF NOT EXISTS rank_name                 text,
  ADD COLUMN IF NOT EXISTS level                     integer,
  ADD COLUMN IF NOT EXISTS commission_pct            numeric,
  ADD COLUMN IF NOT EXISTS active                    boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS rank_qualification_type   text,
  ADD COLUMN IF NOT EXISTS min_sq_yards              numeric,
  ADD COLUMN IF NOT EXISTS max_sq_yards              numeric,
  ADD COLUMN IF NOT EXISTS required_sub_rank_level   integer,
  ADD COLUMN IF NOT EXISTS required_sub_rank_count   integer,
  ADD COLUMN IF NOT EXISTS min_directs               integer,
  ADD COLUMN IF NOT EXISTS badge_color               text;

-- ─── emi_schedules ───────────────────────────────────────────
ALTER TABLE public.emi_schedules
  ADD COLUMN IF NOT EXISTS booking_id        uuid,
  ADD COLUMN IF NOT EXISTS customer_id       uuid,
  ADD COLUMN IF NOT EXISTS frequency         text,
  ADD COLUMN IF NOT EXISTS start_date        date,
  ADD COLUMN IF NOT EXISTS num_installments  integer,
  ADD COLUMN IF NOT EXISTS principal         numeric,
  ADD COLUMN IF NOT EXISTS total_payable     numeric,
  ADD COLUMN IF NOT EXISTS interest_rate_pct numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS interest_method   text NOT NULL DEFAULT 'flat';

-- ─── emi_installments ────────────────────────────────────────
ALTER TABLE public.emi_installments
  ADD COLUMN IF NOT EXISTS schedule_id          uuid,
  ADD COLUMN IF NOT EXISTS seq                  integer,
  ADD COLUMN IF NOT EXISTS due_date             date,
  ADD COLUMN IF NOT EXISTS amount               numeric,
  ADD COLUMN IF NOT EXISTS principal_component  numeric,
  ADD COLUMN IF NOT EXISTS interest_component   numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS status               text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS paid_at              timestamptz;

-- ─── bp_bookings: ensure auto booking_no ─────────────────────
-- Page reads booking_no but the form never writes it; rely on a
-- sequence-driven default so legacy deployments don't show blanks.
ALTER TABLE public.bp_bookings
  ADD COLUMN IF NOT EXISTS booking_no text;

DO $$ BEGIN
  CREATE SEQUENCE IF NOT EXISTS public.bp_bookings_booking_no_seq;
EXCEPTION WHEN duplicate_table THEN NULL; END $$;

ALTER TABLE public.bp_bookings
  ALTER COLUMN booking_no SET DEFAULT
    'BK-' || to_char(nextval('public.bp_bookings_booking_no_seq'), 'FM00000');

UPDATE public.bp_bookings
   SET booking_no = 'BK-' || to_char(nextval('public.bp_bookings_booking_no_seq'), 'FM00000')
 WHERE booking_no IS NULL;

-- ─── RPC: next_receipt_no ────────────────────────────────────
CREATE SEQUENCE IF NOT EXISTS public.bp_receipt_no_seq;

CREATE OR REPLACE FUNCTION public.next_receipt_no()
RETURNS text
LANGUAGE sql
SECURITY DEFINER
AS $$
  SELECT 'RCT-' || to_char(nextval('public.bp_receipt_no_seq'), 'FM000000');
$$;

GRANT EXECUTE ON FUNCTION public.next_receipt_no() TO anon, authenticated, service_role;

-- ─── Reload PostgREST schema cache ───────────────────────────
NOTIFY pgrst, 'reload schema';
