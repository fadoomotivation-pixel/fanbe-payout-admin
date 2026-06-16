-- Traditional bookings were still being numbered BK-NNNNN despite the trigger logic
-- that should have produced TR-YYYY-NNNN.  Root cause: bp_bookings.booking_no had a
-- column DEFAULT clause pulling from bp_bookings_booking_no_seq, and Postgres applies
-- column defaults BEFORE BEFORE-INSERT triggers fire.  So by the time
-- generate_booking_no() ran, NEW.booking_no was already 'BK-00027' and the
-- `IF NEW.booking_no IS NULL OR ...` check never triggered the TR-prefix branch.
--
-- Fix in two parts:
--   1) Drop the column default so the trigger is the single source of truth.
--   2) Strengthen the trigger to also override legacy 'BK-NNNNN' values when the
--      booking is in commission_mode='traditional' — protects against any external
--      caller setting the value explicitly, and makes the migration idempotent.
--
-- We also renumber any existing rows that were saved with the wrong prefix.

ALTER TABLE public.bp_bookings ALTER COLUMN booking_no DROP DEFAULT;

CREATE OR REPLACE FUNCTION public.generate_booking_no()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_seq bigint;
  v_year text := to_char(now(), 'YYYY');
BEGIN
  -- For MLM (default) bookings: only fill in when NULL/empty.  Existing 'BK-NNNNN'
  -- values are left alone so historic numbering stays stable.
  IF NEW.commission_mode IS NULL OR NEW.commission_mode <> 'traditional' THEN
    IF NEW.booking_no IS NULL OR btrim(NEW.booking_no) = '' THEN
      NEW.booking_no := 'BK-' || to_char(
        nextval('bp_bookings_booking_no_seq'::regclass),
        'FM00000'
      );
    END IF;
    RETURN NEW;
  END IF;

  -- Traditional: always use the TR-YYYY-NNNN sequence.  Override any default the
  -- column might have set (defensive — we just dropped the default above, but if
  -- a caller passes a 'BK-...' value explicitly we still want TR-.).
  IF NEW.booking_no IS NULL
     OR btrim(NEW.booking_no) = ''
     OR NEW.booking_no ~ '^BK-[0-9]+$' THEN
    v_seq := nextval('bp_traditional_booking_seq'::regclass);
    NEW.booking_no := 'TR-' || v_year || '-' || to_char(v_seq, 'FM0000');
  END IF;

  RETURN NEW;
END;
$$;

-- Renumber any traditional bookings that slipped through with a BK- prefix.  Uses
-- the same TR-YYYY-NNNN format.  The sequence is advanced for each row so numbers
-- stay unique and chronological by created_at.
DO $$
DECLARE
  r record;
  v_seq bigint;
BEGIN
  FOR r IN
    SELECT id, created_at
    FROM public.bp_bookings
    WHERE commission_mode = 'traditional'
      AND (booking_no IS NULL OR booking_no !~ '^TR-')
    ORDER BY created_at
  LOOP
    v_seq := nextval('bp_traditional_booking_seq'::regclass);
    UPDATE public.bp_bookings
       SET booking_no = 'TR-' || to_char(r.created_at, 'YYYY') || '-' || to_char(v_seq, 'FM0000')
     WHERE id = r.id;
  END LOOP;
END $$;
