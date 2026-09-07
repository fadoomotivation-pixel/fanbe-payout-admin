-- "Broker change toh ho raha hai, par tree mein nahi ja raha."
--
-- Reported by Mukul, reproduced on the live row.  Customer FNB05102 upendra kumar:
--
--   booking's broker  ->  radhey shyam [FNB05100]   (what admin corrected it to)
--   tree sponsor      ->  radhey shyam [FNB05095]   (a DIFFERENT radhey shyam, the old one)
--
-- Why the two disagreed: every customer is auto-promoted to a broker row, and their place
-- in the tree is brokers.sponsor_id, which is stamped ONCE from the broker on their first
-- MLM booking.  Nothing ever revisited it.  So correcting the broker on the booking fixed
-- the booking and left the tree pointing at whoever was picked by mistake — which, with
-- two brokers named "radhey shyam" on the system, is not a mistake anyone would spot by
-- reading the name.
--
-- The same gap ran through the money: payout_distributions are rebuilt by a trigger on
-- bp_payments only.  Change the broker on a booking that already has verified payments and
-- the OLD broker's upline keeps the commission, with nothing to show anything is wrong.
--
-- This migration closes both, and adds the guard rail that makes automatic re-parenting
-- safe to do at all.

-- ── Is one broker underneath another? ───────────────────────────────
-- Used two ways below: to refuse a sponsor change that would bend the tree into a loop,
-- and to find everyone whose commission depends on a node that just moved.
CREATE OR REPLACE FUNCTION public.broker_is_descendant(p_candidate uuid, p_ancestor uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_cur    uuid := p_candidate;
  v_safety int := 0;
BEGIN
  IF p_candidate IS NULL OR p_ancestor IS NULL THEN RETURN false; END IF;
  IF p_candidate = p_ancestor THEN RETURN true; END IF;
  LOOP
    v_safety := v_safety + 1;
    -- The existing data could already contain a loop; stop rather than spin forever.
    EXIT WHEN v_safety > 100;
    SELECT sponsor_id INTO v_cur FROM public.brokers WHERE id = v_cur;
    EXIT WHEN v_cur IS NULL;
    IF v_cur = p_ancestor THEN RETURN true; END IF;
  END LOOP;
  RETURN false;
END;
$$;

-- ── A broker can never end up under their own downline ──────────────
-- Without this the tree walk that pays differential commission would run in circles: it
-- has a 15-step safety counter, so it would not hang, it would just quietly pay the wrong
-- people.  Refusing the write is the honest outcome.
CREATE OR REPLACE FUNCTION public.enforce_no_sponsor_cycle()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.sponsor_id IS NULL THEN RETURN NEW; END IF;
  IF NEW.sponsor_id = NEW.id THEN
    RAISE EXCEPTION 'A broker cannot be their own sponsor.';
  END IF;
  IF public.broker_is_descendant(NEW.sponsor_id, NEW.id) THEN
    RAISE EXCEPTION 'That sponsor sits below this broker in the tree — it would make a loop.';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_no_sponsor_cycle ON public.brokers;
CREATE TRIGGER trg_enforce_no_sponsor_cycle
BEFORE INSERT OR UPDATE OF sponsor_id ON public.brokers
FOR EACH ROW EXECUTE FUNCTION public.enforce_no_sponsor_cycle();

-- ── Changing a booking's broker moves the customer in the tree ──────
CREATE OR REPLACE FUNCTION public.sync_tree_sponsor_with_booking_broker()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_node      uuid;
  v_node_type text;
  v_new_type  text;
  v_first     uuid;
BEGIN
  IF NEW.customer_id IS NULL OR NEW.broker_id IS NULL THEN RETURN NULL; END IF;

  -- Traditional deals do not sit in the MLM tree at all.
  IF COALESCE(NEW.commission_mode, 'mlm') <> 'mlm' THEN RETURN NULL; END IF;

  -- The customer's own node, created by the auto-promote flow.  A customer who was never
  -- promoted has no place in the tree to move.
  SELECT id, broker_type INTO v_node, v_node_type
    FROM public.brokers WHERE customer_id = NEW.customer_id;
  IF v_node IS NULL OR v_node = NEW.broker_id THEN RETURN NULL; END IF;

  -- Only the booking that DECIDED the sponsor may change it.  A customer's second or
  -- third booking can be sold by a different broker; re-parenting the person every time
  -- one of those is edited would drag them around the tree behind admin's back.
  SELECT bk.id INTO v_first
    FROM public.bp_bookings bk
   WHERE bk.customer_id = NEW.customer_id
     AND bk.broker_id IS NOT NULL
     AND COALESCE(bk.commission_mode, 'mlm') = 'mlm'
   ORDER BY bk.created_at ASC
   LIMIT 1;
  IF v_first IS DISTINCT FROM NEW.id THEN RETURN NULL; END IF;

  SELECT broker_type INTO v_new_type FROM public.brokers WHERE id = NEW.broker_id;
  IF v_new_type IS NULL THEN RETURN NULL; END IF;

  -- The two trees are kept separate, and a booking edit must not fail because of a
  -- bookkeeping detail — so a mismatch is skipped with a warning, not raised.
  IF v_node_type IS NOT NULL AND v_new_type <> v_node_type THEN
    RAISE WARNING 'tree sponsor not moved for customer %: broker % is % but the customer node is %',
      NEW.customer_id, NEW.broker_id, v_new_type, v_node_type;
    RETURN NULL;
  END IF;

  IF public.broker_is_descendant(NEW.broker_id, v_node) THEN
    RAISE WARNING 'tree sponsor not moved for customer %: broker % sits below them and it would make a loop',
      NEW.customer_id, NEW.broker_id;
    RETURN NULL;
  END IF;

  UPDATE public.brokers
     SET sponsor_id = NEW.broker_id
   WHERE id = v_node
     AND sponsor_id IS DISTINCT FROM NEW.broker_id;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_booking_broker_syncs_tree ON public.bp_bookings;
CREATE TRIGGER trg_booking_broker_syncs_tree
AFTER UPDATE OF broker_id ON public.bp_bookings
FOR EACH ROW
WHEN (OLD.broker_id IS DISTINCT FROM NEW.broker_id)
EXECUTE FUNCTION public.sync_tree_sponsor_with_booking_broker();

-- ── Changing a booking's broker re-cuts that booking's commission ───
-- recompute_booking_payouts() already leaves rows that belong to a closed payout cycle
-- alone, so money already paid out is never rewritten — only what is still open moves.
CREATE OR REPLACE FUNCTION public.trg_booking_broker_recompute()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  PERFORM public.recompute_booking_payouts(NEW.id);
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_booking_broker_recompute ON public.bp_bookings;
CREATE TRIGGER trg_booking_broker_recompute
AFTER UPDATE OF broker_id ON public.bp_bookings
FOR EACH ROW
WHEN (OLD.broker_id IS DISTINCT FROM NEW.broker_id)
EXECUTE FUNCTION public.trg_booking_broker_recompute();

-- ── Moving a node re-cuts everything underneath it ──────────────────
-- Differential commission is the gap between a broker's rank and their upline's.  Move a
-- broker to a new sponsor and every booking sold by that broker OR anyone below them now
-- pays a different set of people.  This applies to the automatic move above and to the
-- "move broker" action in the team tree alike.
CREATE OR REPLACE FUNCTION public.trg_broker_sponsor_recompute()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  bk record;
BEGIN
  FOR bk IN
    WITH RECURSIVE subtree AS (
      SELECT NEW.id AS id, 0 AS depth
      UNION ALL
      SELECT b.id, s.depth + 1
        FROM public.brokers b
        JOIN subtree s ON b.sponsor_id = s.id
       WHERE s.depth < 20          -- guard, in case older data already holds a loop
    )
    SELECT DISTINCT bkg.id
      FROM public.bp_bookings bkg
      JOIN subtree s ON s.id = bkg.broker_id
  LOOP
    PERFORM public.recompute_booking_payouts(bk.id);
  END LOOP;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_broker_sponsor_recompute ON public.brokers;
CREATE TRIGGER trg_broker_sponsor_recompute
AFTER UPDATE OF sponsor_id ON public.brokers
FOR EACH ROW
WHEN (OLD.sponsor_id IS DISTINCT FROM NEW.sponsor_id)
EXECUTE FUNCTION public.trg_broker_sponsor_recompute();

-- ── Repair what already drifted ─────────────────────────────────────
-- One row on live data at the time of writing: upendra kumar, sitting under the wrong
-- radhey shyam.  Restricted to nodes whose sponsor disagrees with the broker on the
-- booking that stamped it, and skips anything that would make a loop.
UPDATE public.brokers me
   SET sponsor_id = f.broker_id
  FROM (
    SELECT DISTINCT ON (bk.customer_id) bk.customer_id, bk.broker_id
      FROM public.bp_bookings bk
     WHERE bk.broker_id IS NOT NULL
       AND COALESCE(bk.commission_mode, 'mlm') = 'mlm'
     ORDER BY bk.customer_id, bk.created_at ASC
  ) f
 WHERE me.customer_id = f.customer_id
   AND me.sponsor_id IS DISTINCT FROM f.broker_id
   AND me.id <> f.broker_id
   AND NOT public.broker_is_descendant(f.broker_id, me.id)
   AND me.broker_type IS NOT DISTINCT FROM (SELECT broker_type FROM public.brokers WHERE id = f.broker_id);
