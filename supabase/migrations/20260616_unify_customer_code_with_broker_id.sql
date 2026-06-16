-- Admin's complaint: every MLM customer ends up with TWO ids -- a CR-NNNN
-- customer_code AND a FNB05NNN broker_id (because MLM customers auto-promote
-- to brokers).  Same person, two codes -- "no sense making new customer id."
--
-- Fix: when a customer is linked to a broker (brokers.customer_id), overwrite
-- their customer_code with the broker's broker_id.  Traditional customers
-- (no broker record) keep their CR-NNNN code so traditional-only flows are
-- unchanged.
--
-- This is implemented as:
--   1) One-time backfill UPDATE on existing rows.
--   2) Trigger on brokers AFTER INSERT/UPDATE of broker_id or customer_id --
--      whenever a broker row is created or its broker_id changes, the linked
--      customer's customer_code is rewritten to match.
--
-- broker_id values (FNB05NNN, TR8NN) don't collide with CR-NNNN customer_code
-- values, so the unique constraint on customer_code is safe.

-- 1) Backfill.
UPDATE public.bp_customers c
   SET customer_code = b.broker_id
  FROM public.brokers b
 WHERE b.customer_id = c.id
   AND b.broker_id IS NOT NULL
   AND b.broker_id <> ''
   AND c.customer_code IS DISTINCT FROM b.broker_id;

-- 2) Trigger to keep them aligned going forward.
CREATE OR REPLACE FUNCTION public.sync_customer_code_with_broker()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.customer_id IS NOT NULL
     AND NEW.broker_id IS NOT NULL
     AND btrim(NEW.broker_id) <> '' THEN
    UPDATE public.bp_customers
       SET customer_code = NEW.broker_id
     WHERE id = NEW.customer_id
       AND customer_code IS DISTINCT FROM NEW.broker_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_customer_code_with_broker ON public.brokers;
CREATE TRIGGER trg_sync_customer_code_with_broker
AFTER INSERT OR UPDATE OF broker_id, customer_id ON public.brokers
FOR EACH ROW EXECUTE FUNCTION public.sync_customer_code_with_broker();
