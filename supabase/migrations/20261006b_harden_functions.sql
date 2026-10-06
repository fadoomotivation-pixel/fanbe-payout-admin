-- ============================================================================
-- Follow-up to 20261006, from Supabase's own security linter run against the live
-- database after that migration landed.  Three real things, one of them mine.
--
--   1. public.guard_paid_commission() — the trigger that stops paid commission being
--      deleted — was written WITHOUT `SET search_path`.  My mistake in 20261006.  It is
--      SECURITY INVOKER so it is not an escalation, but a function whose whole job is to
--      refuse a write should not resolve its own table names through whatever search_path
--      the caller happens to have set.
--
--   2. public.next_receipt_no() is SECURITY DEFINER *and* has a mutable search_path.
--      That pair is the actual privilege-escalation shape: the function runs as its owner,
--      and the caller chooses which schema its unqualified names resolve in.
--
--   3. Every trigger function in `public` is exposed as a REST endpoint
--      (/rest/v1/rpc/<name>) to `anon` and `authenticated`, 24 of them — including the
--      guards added in 20261006.  Calling one directly fails ("can only be called as a
--      trigger"), so nothing is exploitable, but none of them should be reachable at all.
--      Revoking is safe: Postgres checks EXECUTE on a trigger function when the TRIGGER is
--      created, not each time it fires.
--
--   4. public.recompute_broker_ranks() is SECURITY DEFINER, callable by any signed-in user,
--      and it PROMOTES brokers — promote-only, never reversing.  It cannot invent a
--      promotion (it just applies the slab rules), but rank decides commission %, so it is
--      the office's button, not a broker's.
--
-- Safe to run more than once.  Deletes nothing.  Changes no behaviour for staff.
-- Deliberately NOT touched, because they belong to the call-centre CRM that shares this
-- database: the views v_ghost_leads and v_tele_caller_scorecard (SECURITY DEFINER), and
-- the functions link_call_to_lead, norm_phone, notify_due_followups,
-- missed_followups_for_employee and the shared set_updated_at.  They are reported in the
-- guide instead so whoever owns that app can decide.
-- ============================================================================
BEGIN;

-- ── 1 + 2.  Pin search_path on the functions of ours that lack it ───────────
-- ALTER FUNCTION ... SET is used rather than CREATE OR REPLACE so the bodies are not
-- restated here: there is nothing to get wrong, and the next person reading this file sees
-- that only the setting changed.
ALTER FUNCTION public.guard_paid_commission()            SET search_path = public;
ALTER FUNCTION public.next_receipt_no()                  SET search_path = public;
ALTER FUNCTION public.bp_customers_set_code()            SET search_path = public;
ALTER FUNCTION public.bp_payments_set_receipt_no()       SET search_path = public;
ALTER FUNCTION public.brokers_set_default_referral_code() SET search_path = public;
ALTER FUNCTION public.trg_recompute_broker_ranks()       SET search_path = public;

-- ── 3.  Trigger functions stop being REST endpoints ─────────────────────────
-- Every function in `public` that returns `trigger` — 28 of them, all owned by postgres.
-- Written as a loop over the catalog rather than a list so a trigger function added later
-- is covered the next time this runs.
--
-- This does reach the call-centre CRM's trigger functions as well, and that is deliberate
-- and safe: a trigger keeps firing after its function's EXECUTE is revoked (the privilege
-- is checked once, at CREATE TRIGGER), and the only thing lost is an RPC endpoint that
-- could never have worked — calling a trigger function directly always errors.  No table,
-- policy or row of theirs is touched.
DO $$
DECLARE f record;
BEGIN
  FOR f IN
    SELECT p.oid::regprocedure AS sig
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.prorettype = 'pg_catalog.trigger'::regtype
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated', f.sig);
  END LOOP;
END $$;

-- ── 4.  Rank promotion is the office's button ───────────────────────────────
-- Same shape as the guards in 20261006: the check is inside, because `authenticated` is
-- also the role the office signs in as.  A NULL auth.uid() is the service role, a migration
-- or a trigger fired by one, and passes.
--
-- Body is otherwise byte-for-byte what is live: promote-only, skips rank_locked brokers,
-- three passes so a promotion can cascade up the tree.
CREATE OR REPLACE FUNCTION public.recompute_broker_ranks()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  brk record; slab record;
  v_team_sqyd numeric; v_sub_count integer;
  v_new_rank text; v_new_level int; v_cur_level int; v_iter integer;
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.is_staff() THEN
    RAISE EXCEPTION 'Only office staff can recompute broker ranks.';
  END IF;

  FOR v_iter IN 1..3 LOOP
    FOR brk IN
      SELECT id, rank FROM public.brokers
       WHERE status = 'active' AND broker_type = 'mlm'
         AND rank_locked = false          -- (1) manual jumps are left untouched
    LOOP
      WITH RECURSIVE subtree AS (
        SELECT brk.id AS id UNION ALL
        SELECT b.id FROM public.brokers b JOIN subtree s ON b.sponsor_id = s.id
      )
      SELECT COALESCE(SUM(COALESCE(bk.size_sqyd, pl.size_sqyd, 0)), 0) INTO v_team_sqyd
        FROM public.bp_bookings bk LEFT JOIN public.bp_plots pl ON pl.id = bk.plot_id
       WHERE bk.broker_id IN (SELECT id FROM subtree) AND bk.stage <> 'cancelled';

      v_new_rank := NULL; v_new_level := NULL;
      FOR slab IN SELECT * FROM public.commission_ranks WHERE active IS TRUE ORDER BY level DESC LOOP
        IF slab.rank_qualification_type = 'sub_ranks' THEN
          SELECT count(*) INTO v_sub_count
            FROM public.brokers d JOIN public.commission_ranks dr ON dr.rank_name = d.rank
           WHERE d.sponsor_id = brk.id AND dr.level >= slab.required_sub_rank_level;
          IF v_sub_count >= COALESCE(slab.required_sub_rank_count, 3) THEN
            v_new_rank := slab.rank_name; v_new_level := slab.level; EXIT; END IF;
        ELSE
          IF v_team_sqyd >= COALESCE(slab.min_sq_yards, 0) THEN
            v_new_rank := slab.rank_name; v_new_level := slab.level; EXIT; END IF;
        END IF;
      END LOOP;

      -- Current rank's level (0 if the name isn't in the slab table).
      SELECT COALESCE(cr.level, 0) INTO v_cur_level
        FROM public.commission_ranks cr WHERE cr.rank_name = brk.rank;
      v_cur_level := COALESCE(v_cur_level, 0);

      -- (2) PROMOTE-ONLY: only ever raise the rank, never lower it.
      IF v_new_rank IS NOT NULL
         AND v_new_level > v_cur_level
         AND v_new_rank IS DISTINCT FROM brk.rank THEN
        UPDATE public.brokers SET rank = v_new_rank WHERE id = brk.id;
      END IF;
    END LOOP;
  END LOOP;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.recompute_broker_ranks() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.recompute_broker_ranks() TO authenticated;

COMMIT;

-- ============================================================================
-- After running:
--
--   SELECT p.proname, p.proconfig
--     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--    WHERE n.nspname='public'
--      AND p.proname IN ('guard_paid_commission','next_receipt_no','recompute_broker_ranks');
--   -- expect: every row shows {search_path=public}
--
--   SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
--    WHERE n.nspname='public' AND p.prorettype='pg_catalog.trigger'::regtype
--      AND has_function_privilege('authenticated', p.oid, 'execute');
--   -- expect: 0
--
-- Then re-run the linter: Dashboard > Advisors > Security.  What should still be listed,
-- and is not ours to fix here:
--   - v_ghost_leads / v_tele_caller_scorecard  (call-centre views, SECURITY DEFINER)
--   - link_call_to_lead, norm_phone, notify_due_followups, missed_followups_for_employee,
--     set_updated_at                           (call-centre / shared, mutable search_path)
--   - Leaked Password Protection Disabled      (a switch in Auth settings, not SQL)
-- ============================================================================
