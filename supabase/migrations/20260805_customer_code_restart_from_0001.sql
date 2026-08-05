-- Admin: "booking place karne ke baad jo ID number aa raha hai wo CR-0020 se
-- start ho raha hai, wo CR-0001 se start hona chahiye."
--
-- Root cause: bp_customers_code_seq had already been burned through by earlier
-- test data, so the first real customer landed on CR-0020 and the visible
-- customer/booking numbering started mid-series.
--
-- Fix, in three parts:
--   1) Renumber every CR-NNNN customer_code from 0001 upward in creation order
--      (oldest customer = CR-0001).  Done in two phases so the UNIQUE index on
--      customer_code cannot trip while numbers are being swapped around.
--   2) Carry each new code onto that customer's bookings -- booking_no is
--      derived from customer_code (see generate_booking_no) -- keeping the
--      '-2', '-3' suffixes for customers holding more than one booking.
--   3) Reset bp_customers_code_seq so the next new customer continues the
--      series (CR-0003 after two customers) instead of re-issuing a taken code.
--
-- Customers who are also brokers carry an FNB.../TR... code instead of a CR-
-- code (see 20260616_unify_customer_code_with_broker_id.sql); they are matched
-- by the '^CR-[0-9]+$' pattern below and so are deliberately left untouched.

DO $$
DECLARE
  c_row  record;
  b_row  record;
  v_idx  integer := 0;
  v_bidx integer;
  v_new  text;
BEGIN
  -- Phase 1 -- park existing CR- codes under a temporary, guaranteed-unique
  -- prefix so phase 2 can hand out CR-0001.. without colliding with a code that
  -- is still assigned to another row.
  UPDATE public.bp_customers
     SET customer_code = 'TMPCR-' || id::text
   WHERE customer_code ~ '^CR-[0-9]+$';

  -- Phase 2 -- re-issue the codes from 0001, oldest customer first.
  FOR c_row IN
    SELECT id FROM public.bp_customers
     WHERE customer_code LIKE 'TMPCR-%'
     ORDER BY created_at, id
  LOOP
    v_idx := v_idx + 1;
    v_new := 'CR-' || lpad(v_idx::text, 4, '0');

    UPDATE public.bp_customers SET customer_code = v_new WHERE id = c_row.id;

    v_bidx := 0;
    FOR b_row IN
      SELECT id FROM public.bp_bookings
       WHERE customer_id = c_row.id
       ORDER BY created_at
    LOOP
      v_bidx := v_bidx + 1;
      UPDATE public.bp_bookings
         SET booking_no = CASE WHEN v_bidx = 1 THEN v_new
                               ELSE v_new || '-' || v_bidx::text END
       WHERE id = b_row.id;
    END LOOP;
  END LOOP;

  -- Phase 3 -- point the sequence at the last code we handed out.  With no CR-
  -- customers at all the sequence is armed so the very next nextval() is 1.
  PERFORM setval('bp_customers_code_seq', GREATEST(v_idx, 1), v_idx > 0);
END $$;

-- Harden the generator: if the sequence ever drifts behind the codes already on
-- the table (restored dump, manual insert, another renumber like the one above),
-- skip forward instead of failing the customer insert on the unique index.
CREATE OR REPLACE FUNCTION public.bp_customers_set_code()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
DECLARE
  v_code text;
BEGIN
  IF new.customer_code IS NULL OR new.customer_code = '' THEN
    LOOP
      v_code := 'CR-' || lpad(nextval('bp_customers_code_seq')::text, 4, '0');
      EXIT WHEN NOT EXISTS (
        SELECT 1 FROM public.bp_customers WHERE customer_code = v_code
      );
    END LOOP;
    new.customer_code := v_code;
  END IF;
  RETURN new;
END;
$function$;
