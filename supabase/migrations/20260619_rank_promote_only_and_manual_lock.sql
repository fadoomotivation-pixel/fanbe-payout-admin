-- Admin: "registration as broker (rank jump) promotion demotion" +
-- "rank jump but promotion need matching the existing requirement".
--
-- Two rules:
--   1) A manual rank set by admin (a "jump") must STICK -- mark rank_locked=true
--      and the auto-engine skips the broker entirely.
--   2) For everyone else the engine is PROMOTE-ONLY: raise rank when the broker
--      meets the slab requirement, NEVER lower it (no surprise auto-demotion).
--      Demotion is a manual admin action.

ALTER TABLE public.brokers
  ADD COLUMN IF NOT EXISTS rank_locked boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.recompute_broker_ranks()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  brk record; slab record;
  v_team_sqyd numeric; v_sub_count integer;
  v_new_rank text; v_new_level int; v_cur_level int; v_iter integer;
BEGIN
  FOR v_iter IN 1..3 LOOP
    FOR brk IN
      SELECT id, rank FROM public.brokers
       WHERE status = 'active' AND broker_type = 'mlm'
         AND rank_locked = false
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

      SELECT COALESCE(cr.level, 0) INTO v_cur_level
        FROM public.commission_ranks cr WHERE cr.rank_name = brk.rank;
      v_cur_level := COALESCE(v_cur_level, 0);

      IF v_new_rank IS NOT NULL
         AND v_new_level > v_cur_level
         AND v_new_rank IS DISTINCT FROM brk.rank THEN
        UPDATE public.brokers SET rank = v_new_rank WHERE id = brk.id;
      END IF;
    END LOOP;
  END LOOP;
END;
$$;
