-- Admin: "new booking still cr-1068 but it should somthing like FNB05070".
--
-- Timing of the auto-promote flow:
--   1. Booking save inserts bp_customers row -> CR-1068 (via bp_customers_set_code)
--   2. Booking insert fires generate_booking_no -> stamps booking_no = 'CR-1068'
--   3. Booking save then inserts brokers row -> sync_customer_code_with_broker
--      trigger flips customers.customer_code from CR-1068 to FNB05070
--   But the booking_no was stamped at step 2 and stays 'CR-1068'.
--
-- Fix: when sync_customer_code_with_broker runs (step 3), also rewrite every
-- booking_no for that customer to use the new FNB code -- keeping the same
-- '-2', '-3' suffix scheme so multi-booking customers stay unique.

CREATE OR REPLACE FUNCTION public.sync_customer_code_with_broker()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_old_code text;
  b_row record;
  v_idx integer;
BEGIN
  IF NEW.customer_id IS NULL
     OR NEW.broker_id IS NULL
     OR btrim(NEW.broker_id) = '' THEN
    RETURN NEW;
  END IF;

  SELECT customer_code INTO v_old_code FROM public.bp_customers WHERE id = NEW.customer_id;

  IF v_old_code IS DISTINCT FROM NEW.broker_id THEN
    UPDATE public.bp_customers
       SET customer_code = NEW.broker_id
     WHERE id = NEW.customer_id;

    v_idx := 0;
    FOR b_row IN
      SELECT id FROM public.bp_bookings
       WHERE customer_id = NEW.customer_id
       ORDER BY created_at
    LOOP
      v_idx := v_idx + 1;
      UPDATE public.bp_bookings
         SET booking_no = CASE WHEN v_idx = 1 THEN NEW.broker_id
                               ELSE NEW.broker_id || '-' || v_idx::text END
       WHERE id = b_row.id;
    END LOOP;
  END IF;
  RETURN NEW;
END;
$$;

-- One-shot fix for any existing bookings whose booking_no is still the old
-- CR-NNNN form but whose customer now has an FNB code.
DO $$
DECLARE c_row record; b_row record; v_idx integer;
BEGIN
  FOR c_row IN
    SELECT c.id, c.customer_code
      FROM public.bp_customers c
     WHERE c.customer_code ~ '^FNB'
       AND EXISTS (
         SELECT 1 FROM public.bp_bookings b
          WHERE b.customer_id = c.id
            AND (b.booking_no IS NULL
                 OR (b.booking_no <> c.customer_code
                     AND b.booking_no NOT LIKE c.customer_code || '-%'))
       )
  LOOP
    v_idx := 0;
    FOR b_row IN
      SELECT id FROM public.bp_bookings
       WHERE customer_id = c_row.id ORDER BY created_at
    LOOP
      v_idx := v_idx + 1;
      UPDATE public.bp_bookings
         SET booking_no = CASE WHEN v_idx = 1 THEN c_row.customer_code
                               ELSE c_row.customer_code || '-' || v_idx::text END
       WHERE id = b_row.id;
    END LOOP;
  END LOOP;
END $$;
