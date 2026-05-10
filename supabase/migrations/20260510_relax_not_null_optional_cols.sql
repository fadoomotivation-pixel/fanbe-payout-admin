-- Audit follow-up: relax NOT NULL on FK columns the app legitimately
-- writes as NULL, so legacy NOT NULL definitions don't crash inserts.
--
-- Bookings.tsx passes customer_id as null for token-only bookings on
-- emi_schedules. Same for emi_installments.schedule_id is required
-- (we always have one), but other FK-ish columns should be nullable
-- to match the form's behaviour.

DO $$ BEGIN
  ALTER TABLE public.emi_schedules ALTER COLUMN customer_id DROP NOT NULL;
EXCEPTION WHEN others THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.bp_bookings ALTER COLUMN broker_id DROP NOT NULL;
EXCEPTION WHEN others THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.bp_bookings ALTER COLUMN project_id DROP NOT NULL;
EXCEPTION WHEN others THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.bp_bookings ALTER COLUMN plot_id DROP NOT NULL;
EXCEPTION WHEN others THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.bp_payments ALTER COLUMN sponsor_name DROP NOT NULL;
EXCEPTION WHEN others THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.bp_payments ALTER COLUMN utr_ref DROP NOT NULL;
EXCEPTION WHEN others THEN NULL; END $$;

NOTIFY pgrst, 'reload schema';
