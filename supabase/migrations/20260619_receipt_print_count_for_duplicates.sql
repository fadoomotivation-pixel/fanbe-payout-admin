-- Admin: "duplicate receipt if customer took 2nd receipt it should show".
-- Track how many times each payment's receipt has been printed.  The first
-- print is the original; every print after that is a DUPLICATE COPY and the
-- receipt template stamps it so.
--
-- bump_receipt_print() increments atomically and returns the NEW count, so
-- concurrent reprints can't race to the same number.
ALTER TABLE public.bp_payments
  ADD COLUMN IF NOT EXISTS print_count integer NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION public.bump_receipt_print(p_payment uuid)
RETURNS integer
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.bp_payments
     SET print_count = COALESCE(print_count, 0) + 1
   WHERE id = p_payment
  RETURNING print_count;
$$;
