-- Traditional plot sale enhancements:
--   1. Separate booking_no prefix (TR-) and sequence for traditional bookings, so admin
--      can tell at a glance which deals are traditional vs MLM by ID alone.
--   2. New bp_booking_brokers table lets admin split commission across up to 3 brokers
--      on a traditional sale (the "plot sold with help of 2 or 3 brokers" use case).
--      Single-broker traditional bookings keep using bp_bookings.traditional_commission_pct
--      as before; multi-broker bookings populate bp_booking_brokers and the trigger
--      iterates those rows.

CREATE SEQUENCE IF NOT EXISTS bp_traditional_booking_seq START WITH 1;

CREATE OR REPLACE FUNCTION public.generate_booking_no()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.booking_no IS NULL THEN
    IF NEW.commission_mode = 'traditional' THEN
      NEW.booking_no := 'TR-' || to_char(now(), 'YYYY') || '-' || LPAD(nextval('bp_traditional_booking_seq')::text, 4, '0');
    ELSE
      NEW.booking_no := 'BK-' || to_char(now(), 'YYYY') || '-' || LPAD(nextval('bp_booking_seq')::text, 4, '0');
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE TABLE IF NOT EXISTS public.bp_booking_brokers (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id      uuid NOT NULL REFERENCES public.bp_bookings(id) ON DELETE CASCADE,
  broker_id       uuid NOT NULL REFERENCES public.brokers(id),
  commission_pct  numeric NOT NULL CHECK (commission_pct >= 0 AND commission_pct <= 100),
  position        integer NOT NULL CHECK (position BETWEEN 1 AND 3),
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (booking_id, position),
  UNIQUE (booking_id, broker_id)
);
CREATE INDEX IF NOT EXISTS idx_bp_booking_brokers_booking ON public.bp_booking_brokers(booking_id);
CREATE INDEX IF NOT EXISTS idx_bp_booking_brokers_broker  ON public.bp_booking_brokers(broker_id);

ALTER TABLE public.bp_booking_brokers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_select ON public.bp_booking_brokers;
DROP POLICY IF EXISTS p_insert ON public.bp_booking_brokers;
DROP POLICY IF EXISTS p_update ON public.bp_booking_brokers;
DROP POLICY IF EXISTS p_delete ON public.bp_booking_brokers;
CREATE POLICY p_select ON public.bp_booking_brokers FOR SELECT TO authenticated USING (true);
CREATE POLICY p_insert ON public.bp_booking_brokers FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY p_update ON public.bp_booking_brokers FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY p_delete ON public.bp_booking_brokers FOR DELETE TO authenticated USING (true);

-- Trigger update: see live function for full body.  When bp_booking_brokers has rows
-- for a traditional booking, iterate those rows and pay each broker their commission_pct
-- on every verified payment.  Upline cascade is skipped because admin chose the split.
-- (Function body is identical to the one applied in the migration of the same name; if
-- restoring from scratch, re-run the apply_migration call.)
