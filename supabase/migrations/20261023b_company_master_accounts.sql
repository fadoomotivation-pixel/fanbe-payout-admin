-- Mark the company's own nodes, and put the traditional tree under its one.
--
-- Manisha asked for a master in both trees ("Ap master id bana k dedo fanbe k name se
-- mlm m bhi aur traditional m bhi"), and admin on where it sits: "obviously h shiv or
-- surrender se upar hi hogi fanbe."
--
-- Both nodes already exist: FNB05000 and TR821, both named FANBE GROUP, both at the top,
-- neither with a phone or a login. This does two things to them.
--
-- 1. SAYS WHAT THEY ARE. A company node has no commission rate, on purpose, forever. The
--    app reads a missing rate as "somebody forgot" and says so — correctly, for a person.
--    Once FANBE sits above the traditional tree it appears at the top of every chain, so
--    that correct warning would show on every booking the office opens. A warning that
--    appears on everything is one people learn to scroll past, and then the real ones go
--    unread too. A flag on the row is the honest fix: the screens stop asking the company
--    for a rate, and keep asking everybody else.
--
--    It is a column rather than a check on the name because "FANBE GROUP" is a string
--    anybody can type, and this decides whether a missing rate is a problem.
--
-- 2. PUTS THE TREE UNDER IT. SHIV SHANKAR THAKUR (TR814) and surender chaudhary (TR816)
--    are both sitting at the top of their own trees. They move under TR821, which makes
--    the traditional side one tree with the company at its head, the way the Affiliate
--    side will be from its first ID.
--
-- NO MONEY MOVES, and that is checked rather than asserted. Changing a sponsor fires
-- trg_broker_sponsor_recompute, which recomputes every booking in the subtree below the
-- broker that moved. For a traditional booking that recompute pays the bp_booking_brokers
-- rows, or the booking's own rate — neither climbs the sponsors. And FANBE has no rate of
-- any kind, so even the team commission leaves it out. The totals are counted before and
-- after and the whole thing aborts if a single rupee differs.
--
-- Safe to run more than once.

BEGIN;

DO $guard$
BEGIN
  IF to_regprocedure('public.is_staff()') IS NULL OR to_regclass('public.brokers') IS NULL THEN
    RAISE EXCEPTION '%',
      'Wrong Supabase project: public.is_staff() or public.brokers is missing here. '
      || 'Run this in Fanbe-CRM, project ref mfgjzkaabyltscgrkhdz. Nothing was changed.';
  END IF;
END
$guard$;

ALTER TABLE public.brokers
  ADD COLUMN IF NOT EXISTS is_company_account boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.brokers.is_company_account IS
  'True only for the company''s own node at the top of a tree (FANBE GROUP). It is not a '
  'person, has no login and is never paid, so the screens do not ask it for a commission '
  'rate and do not report one as missing.';

DO $work$
DECLARE
  v_master uuid;
  v_before numeric;
  v_after  numeric;
  v_moved  integer;
BEGIN
  SELECT coalesce(sum(net_payout), 0) INTO v_before FROM public.payout_distributions;

  -- Both company nodes, found by the shape that makes them one: top of a tree, no login.
  UPDATE public.brokers
     SET is_company_account = true
   WHERE name = 'FANBE GROUP'
     AND sponsor_id IS NULL
     AND auth_user_id IS NULL
     AND is_company_account IS NOT TRUE;

  SELECT id INTO v_master
    FROM public.brokers
   WHERE broker_type = 'traditional' AND is_company_account IS TRUE
   ORDER BY created_at LIMIT 1;

  IF v_master IS NULL THEN
    RAISE EXCEPTION '%',
      'STOPPED, nothing changed. No traditional company node found. Create FANBE GROUP as a '
      || 'traditional broker with no sponsor and no login first.';
  END IF;

  -- Everyone still at the top of the traditional tree moves under it. Written as a set
  -- rather than two ids so a broker added at the top later is picked up by a re-run.
  UPDATE public.brokers
     SET sponsor_id = v_master, parent_id = v_master
   WHERE broker_type = 'traditional'
     AND sponsor_id IS NULL
     AND id <> v_master
     AND is_company_account IS NOT TRUE;
  GET DIAGNOSTICS v_moved = ROW_COUNT;

  SELECT coalesce(sum(net_payout), 0) INTO v_after FROM public.payout_distributions;

  IF v_after <> v_before THEN
    RAISE EXCEPTION '%',
      'STOPPED, everything rolled back. Commission changed from ' || v_before || ' to '
      || v_after || ' when the tree moved. It should not have, so nothing is being kept '
      || 'until somebody understands why.';
  END IF;

  RAISE NOTICE 'Company nodes marked. % broker(s) moved under the traditional master. Commission unchanged at %.',
    v_moved, v_after;
END
$work$;

COMMIT;

-- After running:
--
--   SELECT broker_id, name, is_company_account,
--          coalesce((SELECT x.broker_id FROM brokers x WHERE x.id = b.sponsor_id), 'TOP') AS upar
--     FROM brokers b ORDER BY broker_type, broker_id;
--   -- expect FNB05000 and TR821 flagged and at TOP, and TR814/TR816 now under TR821.
