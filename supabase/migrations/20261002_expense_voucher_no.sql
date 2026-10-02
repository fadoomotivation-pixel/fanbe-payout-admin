-- Expenses are about to become printed vouchers, so each one needs a number that is
-- written on the paper and can be looked up again a year later when somebody asks what
-- that payment was.  A row id is not that number: nobody reads a uuid off a voucher.
--
-- Same shape as the receipt counter in 20260822b: a single counter row incremented in the
-- same statement that reads it, a unique index so a duplicate can never land quietly, and
-- a BEFORE INSERT trigger so every expense gets one from one code path instead of each
-- caller remembering to ask.

ALTER TABLE public.expenses
  ADD COLUMN IF NOT EXISTS voucher_no text;

COMMENT ON COLUMN public.expenses.voucher_no IS
  'Printed payment voucher number (V-0001). Assigned once, never reused, even if the expense is later deleted.';

-- Deliberately a single global counter, not per-head or per-year: the office files
-- vouchers in one book, so one running number is what matches the paper.
CREATE TABLE IF NOT EXISTS public.bp_voucher_seq (
  id      boolean PRIMARY KEY DEFAULT true CHECK (id),
  last_no int NOT NULL DEFAULT 0
);
ALTER TABLE public.bp_voucher_seq ENABLE ROW LEVEL SECURITY;
-- No policies on purpose: only the SECURITY DEFINER function below touches this.

CREATE OR REPLACE FUNCTION public.next_voucher_no()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_n         int;
  v_candidate text;
  v_guard     int := 0;
BEGIN
  LOOP
    INSERT INTO public.bp_voucher_seq AS s (id, last_no)
    VALUES (true, 1)
    ON CONFLICT (id) DO UPDATE SET last_no = s.last_no + 1
    RETURNING s.last_no INTO v_n;

    v_candidate := 'V-' || lpad(v_n::text, 4, '0');

    -- Step past anything already on the table (e.g. a number typed in by hand) rather
    -- than failing the save in front of whoever is recording the payment.
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.expenses WHERE voucher_no = v_candidate);

    v_guard := v_guard + 1;
    IF v_guard > 1000 THEN
      -- Give up on the pretty number rather than spin; still unique.
      RETURN 'V-' || to_char(now(), 'YYYYMMDDHH24MISS');
    END IF;
  END LOOP;

  RETURN v_candidate;
END;
$$;

GRANT EXECUTE ON FUNCTION public.next_voucher_no() TO authenticated, service_role;

-- Backfill in the order the money actually went out, so the numbers read chronologically.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT id FROM public.expenses
     WHERE voucher_no IS NULL
     ORDER BY expense_date NULLS LAST, created_at NULLS LAST, id
  LOOP
    UPDATE public.expenses SET voucher_no = public.next_voucher_no() WHERE id = r.id;
  END LOOP;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS expenses_voucher_no_uniq
  ON public.expenses (voucher_no)
  WHERE voucher_no IS NOT NULL AND voucher_no <> '';

CREATE OR REPLACE FUNCTION public.expenses_set_voucher_no()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.voucher_no IS NULL OR NEW.voucher_no = '' THEN
    NEW.voucher_no := public.next_voucher_no();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_expenses_voucher_no ON public.expenses;
CREATE TRIGGER trg_expenses_voucher_no
BEFORE INSERT ON public.expenses
FOR EACH ROW EXECUTE FUNCTION public.expenses_set_voucher_no();
