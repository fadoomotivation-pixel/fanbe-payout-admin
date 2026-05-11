-- Add missing FKs (so PostgREST nested selects work) and extra
-- bp_payments columns the EmiPanel writes. Idempotent.

-- Extra bp_payments columns the EmiPanel.recordPayment() writes
ALTER TABLE public.bp_payments
  ADD COLUMN IF NOT EXISTS instalment_no            integer,
  ADD COLUMN IF NOT EXISTS is_cash_adjustment       boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS subject_to_realisation   boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS notes                    text;

-- Foreign keys: required so supabase nested selects like
--   .from('emi_schedules').select('*,bp_bookings(...)')
-- can resolve the relationship. Without them, joins return null
-- and lists appear empty even when rows exist.

DO $$ BEGIN
  ALTER TABLE public.emi_schedules
    ADD CONSTRAINT emi_schedules_booking_id_fkey
    FOREIGN KEY (booking_id) REFERENCES public.bp_bookings(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.emi_schedules
    ADD CONSTRAINT emi_schedules_customer_id_fkey
    FOREIGN KEY (customer_id) REFERENCES public.bp_customers(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.emi_installments
    ADD CONSTRAINT emi_installments_schedule_id_fkey
    FOREIGN KEY (schedule_id) REFERENCES public.emi_schedules(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.bp_payments
    ADD CONSTRAINT bp_payments_booking_id_fkey
    FOREIGN KEY (booking_id) REFERENCES public.bp_bookings(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.bp_payments
    ADD CONSTRAINT bp_payments_customer_id_fkey
    FOREIGN KEY (customer_id) REFERENCES public.bp_customers(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.bp_bookings
    ADD CONSTRAINT bp_bookings_plot_id_fkey
    FOREIGN KEY (plot_id) REFERENCES public.bp_plots(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.bp_bookings
    ADD CONSTRAINT bp_bookings_customer_id_fkey
    FOREIGN KEY (customer_id) REFERENCES public.bp_customers(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.bp_bookings
    ADD CONSTRAINT bp_bookings_broker_id_fkey
    FOREIGN KEY (broker_id) REFERENCES public.brokers(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.bp_bookings
    ADD CONSTRAINT bp_bookings_project_id_fkey
    FOREIGN KEY (project_id) REFERENCES public.bp_projects(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

NOTIFY pgrst, 'reload schema';
