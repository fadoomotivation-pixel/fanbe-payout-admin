-- Every customer auto-becomes a broker.
--
-- Until now admin had to click "Make broker" on every customer leaf in the team tree to
-- promote them into the MLM downline.  That's a lot of clicks for a system where pretty
-- much every customer ends up being a broker anyway.  This migration:
--
--   1. Adds brokers.customer_id (idempotent link so we don't double-promote on edits).
--   2. Backfills a broker row for every existing bp_customers row (sponsor = the broker
--      on their first MLM booking; standalone customers go to the top of the tree).
--   3. Links pre-existing broker rows that share phone/email with a customer so the
--      team tree treats them as the same person and stops showing both a broker node
--      and a customer leaf for the same human.

ALTER TABLE public.brokers
  ADD COLUMN IF NOT EXISTS customer_id uuid REFERENCES public.bp_customers(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_brokers_customer_id
  ON public.brokers(customer_id) WHERE customer_id IS NOT NULL;

COMMENT ON COLUMN public.brokers.customer_id IS
  'Set when the broker row was auto-created from a bp_customers row.  NULL for the original real brokers.';

DO $$
DECLARE
  c record;
  sponsor uuid;
  syn_email text;
BEGIN
  FOR c IN
    SELECT * FROM public.bp_customers cu
     WHERE NOT EXISTS (SELECT 1 FROM public.brokers b WHERE b.customer_id = cu.id)
       AND COALESCE(cu.name, '') <> ''
  LOOP
    SELECT bk.broker_id INTO sponsor
      FROM public.bp_bookings bk
     WHERE bk.customer_id = c.id
       AND (bk.commission_mode IS NULL OR bk.commission_mode = 'mlm')
       AND bk.broker_id IS NOT NULL
     ORDER BY bk.created_at ASC
     LIMIT 1;

    syn_email := COALESCE(NULLIF(trim(c.email), ''), 'auto-' || substring(c.id::text, 1, 8) || '@example.com');

    BEGIN
      INSERT INTO public.brokers (name, phone, email, customer_id, sponsor_id, broker_type, status, rank)
      VALUES (c.name, NULLIF(trim(c.phone), ''), syn_email, c.id, sponsor, 'mlm', 'active', 'Executive');
    EXCEPTION WHEN unique_violation THEN
      UPDATE public.brokers b
         SET customer_id = c.id
       WHERE b.customer_id IS NULL
         AND (
           (b.phone IS NOT NULL AND b.phone <> '' AND b.phone = NULLIF(trim(c.phone), ''))
           OR (b.email IS NOT NULL AND b.email <> '' AND lower(b.email) = lower(NULLIF(trim(c.email), '')))
         );
    END;
  END LOOP;
END $$;
