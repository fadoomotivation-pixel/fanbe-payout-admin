-- Two related fixes from the admin screenshots:
--
--   1) Admin: "as booking id is made where is bk-2006-0007 make make booking
--      id also sameid FNB05069".  When a booking belongs to customer ravi
--      (whose customer_code is FNB05069 because they're also a broker), the
--      booking_no should be FNB05069 too -- not an unrelated BK-2026-0007.
--      Same identity, same code, end to end.  For customers with >1 booking
--      we suffix '-2', '-3' so each row stays unique.  Traditional / legacy
--      customers with no customer_code fall back to BK-YYYY-NNNN / TR-YYYY-NNNN.
--
--   2) Admin: "mukul sold ravi 100+ gaj direct why he sitting executive not
--      become sr executive as he qualifies the criteria".  Rank was assigned
--      manually -- nothing promoted a broker on team-yard growth.  A new
--      function recompute_broker_ranks() walks every MLM broker, derives
--      team_sqyd, picks the highest qualifying slab from commission_ranks
--      and stamps brokers.rank.  An AFTER STATEMENT trigger on bp_bookings
--      runs it whenever bookings change.  Re-iterates 3 times so promoting
--      downlines lifts uplines' sub-rank counts in the same pass.

-- ── 1) booking_no derived from the customer's code ────────────────────────
CREATE OR REPLACE FUNCTION public.generate_booking_no()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  needs_assign boolean := false;
  v_code text;
  v_count integer;
BEGIN
  IF NEW.booking_no IS NULL OR NEW.booking_no = '' THEN
    needs_assign := true;
  ELSIF NEW.booking_no ~ '^BK-[0-9]+$'
     OR NEW.booking_no ~ '^BK-[0-9]{4}-[0-9]+$'
     OR NEW.booking_no ~ '^TR-[0-9]{4}-[0-9]+$' THEN
    needs_assign := true;
  END IF;

  IF NOT needs_assign THEN RETURN NEW; END IF;

  IF NEW.customer_id IS NOT NULL THEN
    SELECT customer_code INTO v_code FROM public.bp_customers WHERE id = NEW.customer_id;
    IF v_code IS NOT NULL AND btrim(v_code) <> '' THEN
      SELECT count(*) INTO v_count FROM public.bp_bookings WHERE customer_id = NEW.customer_id;
      IF v_count = 0 THEN NEW.booking_no := v_code;
      ELSE NEW.booking_no := v_code || '-' || (v_count + 1)::text; END IF;
      RETURN NEW;
    END IF;
  END IF;

  IF NEW.commission_mode = 'traditional' THEN
    NEW.booking_no := 'TR-' || to_char(now(), 'YYYY') || '-' || LPAD(nextval('bp_traditional_booking_seq')::text, 4, '0');
  ELSE
    NEW.booking_no := 'BK-' || to_char(now(), 'YYYY') || '-' || LPAD(nextval('bp_booking_seq')::text, 4, '0');
  END IF;
  RETURN NEW;
END;
$function$;

-- Renumber existing rows to the new scheme.  Per-customer walk ordered by
-- created_at so the FIRST booking gets the bare code and subsequent ones
-- get '-2', '-3' suffixes.  Customers without customer_code keep their
-- old number.
DO $$
DECLARE c_row record; b_row record; v_idx integer;
BEGIN
  FOR c_row IN
    SELECT c.id, c.customer_code FROM public.bp_customers c
    WHERE c.customer_code IS NOT NULL AND c.customer_code <> ''
      AND EXISTS (SELECT 1 FROM public.bp_bookings b WHERE b.customer_id = c.id)
  LOOP
    v_idx := 0;
    FOR b_row IN SELECT id FROM public.bp_bookings WHERE customer_id = c_row.id ORDER BY created_at LOOP
      v_idx := v_idx + 1;
      UPDATE public.bp_bookings
         SET booking_no = CASE WHEN v_idx = 1 THEN c_row.customer_code
                               ELSE c_row.customer_code || '-' || v_idx::text END
       WHERE id = b_row.id;
    END LOOP;
  END LOOP;
END $$;

-- ── 2) Auto-rank promotion ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.recompute_broker_ranks()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  brk record; slab record;
  v_team_sqyd numeric; v_sub_count integer; v_new_rank text; v_iter integer;
BEGIN
  -- 3 passes lets a chain like A->B->C settle in one statement: A promotes
  -- on pass 1, B sees A's new rank on pass 2, C sees B's on pass 3.
  FOR v_iter IN 1..3 LOOP
    FOR brk IN
      SELECT id, rank FROM public.brokers WHERE status = 'active' AND broker_type = 'mlm'
    LOOP
      WITH RECURSIVE subtree AS (
        SELECT brk.id AS id
        UNION ALL
        SELECT b.id FROM public.brokers b JOIN subtree s ON b.sponsor_id = s.id
      )
      SELECT COALESCE(SUM(COALESCE(bk.size_sqyd, pl.size_sqyd, 0)), 0)
        INTO v_team_sqyd
        FROM public.bp_bookings bk
        LEFT JOIN public.bp_plots pl ON pl.id = bk.plot_id
       WHERE bk.broker_id IN (SELECT id FROM subtree) AND bk.stage <> 'cancelled';

      v_new_rank := NULL;
      FOR slab IN SELECT * FROM public.commission_ranks WHERE active IS TRUE ORDER BY level DESC LOOP
        IF slab.rank_qualification_type = 'sub_ranks' THEN
          SELECT count(*) INTO v_sub_count
            FROM public.brokers d JOIN public.commission_ranks dr ON dr.rank_name = d.rank
           WHERE d.sponsor_id = brk.id AND dr.level >= slab.required_sub_rank_level;
          IF v_sub_count >= COALESCE(slab.required_sub_rank_count, 3) THEN
            v_new_rank := slab.rank_name; EXIT; END IF;
        ELSE
          -- sq_yards (team) or direct_sq_yards (R1, min=0 -- always matches as fallback)
          IF v_team_sqyd >= COALESCE(slab.min_sq_yards, 0) THEN
            v_new_rank := slab.rank_name; EXIT; END IF;
        END IF;
      END LOOP;

      IF v_new_rank IS NOT NULL AND v_new_rank IS DISTINCT FROM brk.rank THEN
        UPDATE public.brokers SET rank = v_new_rank WHERE id = brk.id;
      END IF;
    END LOOP;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.trg_recompute_broker_ranks()
RETURNS trigger LANGUAGE plpgsql
AS $$ BEGIN PERFORM public.recompute_broker_ranks(); RETURN NULL; END; $$;

DROP TRIGGER IF EXISTS trg_bookings_recompute_ranks ON public.bp_bookings;
CREATE TRIGGER trg_bookings_recompute_ranks
AFTER INSERT OR UPDATE OR DELETE ON public.bp_bookings
FOR EACH STATEMENT EXECUTE FUNCTION public.trg_recompute_broker_ranks();

SELECT public.recompute_broker_ranks();

-- Re-run payout recompute so any rank changes affect existing bookings'
-- commission calculations.
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT DISTINCT bk.id FROM public.bp_bookings bk WHERE bk.broker_id IS NOT NULL LOOP
    PERFORM public.recompute_booking_payouts(r.id);
  END LOOP;
END $$;
