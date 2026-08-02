-- Admin: "expense who is responsible" + standard head list
-- "other > advance > payout > discount", and (next PR) "advance debit from
-- earning payout".
--
-- 1) responsible_person: free text naming who is accountable for the spend.
-- 2) broker_id: optional link so Advance / Payout / Discount expenses can be
--    attributed to a specific broker (the hook the payout-debit feature uses).
-- 3) Seed the four standard heads if missing.

ALTER TABLE public.expenses
  ADD COLUMN IF NOT EXISTS responsible_person text,
  ADD COLUMN IF NOT EXISTS broker_id uuid REFERENCES public.brokers(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_expenses_broker_id ON public.expenses(broker_id);

INSERT INTO public.expense_heads (name, active)
SELECT v.name, true
FROM (VALUES ('Other'), ('Advance'), ('Payout'), ('Discount')) AS v(name)
WHERE NOT EXISTS (
  SELECT 1 FROM public.expense_heads h WHERE lower(h.name) = lower(v.name)
);
