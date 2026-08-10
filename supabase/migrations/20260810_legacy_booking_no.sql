-- Admin: "usme jo ID number dikh raha tha wo nahi aa rahi, uski jagah jo Old ID number
-- hai wo aa raha hai -- to hume dono hi check karna padega na?"
--
-- The old-bookings importer wrote the register number straight into booking_no.  That
-- number is real and admin needs it, but putting it THERE meant it replaced the system
-- id: one imported booking reads "341" while every other row reads "CR-0010", so the
-- list has two different kinds of identifier in the same column and admin has to know
-- which is which before they can look anything up.
--
-- The two numbers are different things and now live in different columns:
--
--   booking_no         -- the system id, always the same shape (CR-0011 / FNB05070),
--                         derived from the customer's code by generate_booking_no().
--   legacy_booking_no  -- the number from the paper register, shown alongside so a row
--                         can still be matched against the old files.
--
-- Both are searchable, so admin can look a booking up by either one.

ALTER TABLE public.bp_bookings
  ADD COLUMN IF NOT EXISTS legacy_booking_no text;

CREATE INDEX IF NOT EXISTS idx_bp_bookings_legacy_no
  ON public.bp_bookings (lower(btrim(legacy_booking_no)))
  WHERE legacy_booking_no IS NOT NULL;

COMMENT ON COLUMN public.bp_bookings.legacy_booking_no IS
  'Booking number from the pre-system paper register. Display-and-search only; booking_no remains the system identifier.';

-- Repair the rows already imported: any booking whose number is not its customer's code
-- (nor that code with a -2/-3 suffix) is carrying a foreign number.  Move it into
-- legacy_booking_no and re-issue the system id the same way generate_booking_no() would.
DO $$
DECLARE
  r      record;
  v_new  text;
  n      integer;
BEGIN
  FOR r IN
    SELECT b.id, b.booking_no, c.customer_code
      FROM public.bp_bookings b
      JOIN public.bp_customers c ON c.id = b.customer_id
     WHERE c.customer_code IS NOT NULL
       AND btrim(c.customer_code) <> ''
       AND b.booking_no IS NOT NULL
       AND b.booking_no <> c.customer_code
       AND b.booking_no NOT LIKE c.customer_code || '-%'
  LOOP
    UPDATE public.bp_bookings
       SET legacy_booking_no = r.booking_no
     WHERE id = r.id
       AND legacy_booking_no IS NULL;

    -- Same '-2', '-3' scheme the trigger uses when one customer has several bookings.
    v_new := r.customer_code;
    n := 1;
    WHILE EXISTS (SELECT 1 FROM public.bp_bookings WHERE booking_no = v_new AND id <> r.id) LOOP
      n := n + 1;
      v_new := r.customer_code || '-' || n::text;
    END LOOP;

    UPDATE public.bp_bookings SET booking_no = v_new WHERE id = r.id;
  END LOOP;
END $$;
