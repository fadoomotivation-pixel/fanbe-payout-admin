-- Admin shared the official income plan: Rank 1 is "EX" (Executive) at 5%,
-- direct qualification "100 sqyd (MIN 1 DIRECT)" -- i.e. every broker enters
-- at Executive and earns 5% on their first direct sale.  No team threshold.
--
-- Current DB has "Post-Executive" at level 1 with min_sq_yards=100, max=499
-- which incorrectly required 100 sqyd of TEAM business before the slab kicked
-- in.  Two changes:
--   1) Rename the level-1 slab to "Executive" to match the plan.
--   2) Drop min_sq_yards on level 1 to 0 (entry-level, no team threshold) so a
--      fresh broker earns 5% from the first direct sale onward.
-- Also update brokers.rank rows that point at the old name and re-run
-- recompute so any in-flight commissions land on the renamed slab.

UPDATE public.commission_ranks
   SET rank_name = 'Executive', min_sq_yards = 0
 WHERE level = 1;

UPDATE public.brokers
   SET rank = 'Executive'
 WHERE rank = 'Post-Executive';

DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT DISTINCT bk.id FROM public.bp_bookings bk WHERE bk.broker_id IS NOT NULL
  LOOP
    PERFORM public.recompute_booking_payouts(r.id);
  END LOOP;
END $$;
