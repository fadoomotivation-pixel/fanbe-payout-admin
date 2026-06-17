-- Admin clarified the income plan in detail:
--   * R1 Executive (5%):    0-100 sqyd DIRECT only ("even 50 gaj can be left or right")
--   * R2 Sr Executive (5.5%): 101-500 sqyd team (direct + indirect both count)
--   * R3 Sales Officer (6%): 501-750 sqyd team
--   * R4 Sr S.O (6.5%):      751-1250 sqyd team
--   * R5 Team Manager (7%):  1251-2000 sqyd team
--   * R6+ (7.5% .. 12%):     sub-rank based -- 3 brokers of previous rank
--   * R15 President (12%):   cap, no level above.
--
-- Current DB had R1 (0-499), R2 (500-749), R3 (750-1249), R4 (1250-1999),
-- R5 (2000+) -- shifted off the plan.  This migration realigns the
-- min/max thresholds for R1..R5 to match.
--
-- Also: distinguish R1's qualification scope (direct only) from R2..R5
-- (team).  Existing CHECK constraint allows only 'sq_yards' or 'sub_ranks'
-- so we widen it to add 'direct_sq_yards', then flip R1 to the new value.

ALTER TABLE public.commission_ranks
  DROP CONSTRAINT IF EXISTS commission_ranks_rank_qualification_type_check;

ALTER TABLE public.commission_ranks
  ADD CONSTRAINT commission_ranks_rank_qualification_type_check
  CHECK (rank_qualification_type = ANY (ARRAY[
    'sq_yards'::text,         -- legacy / team-yards based (R2..R5 today)
    'direct_sq_yards'::text,  -- R1 only: counts the broker's own direct sales
    'sub_ranks'::text          -- R6..R15: N brokers of a sub-rank required
  ]));

UPDATE public.commission_ranks SET
  min_sq_yards = 0, max_sq_yards = 100,
  rank_qualification_type = 'direct_sq_yards'
 WHERE level = 1;

UPDATE public.commission_ranks SET
  min_sq_yards = 101, max_sq_yards = 500
 WHERE level = 2;

UPDATE public.commission_ranks SET
  min_sq_yards = 501, max_sq_yards = 750
 WHERE level = 3;

UPDATE public.commission_ranks SET
  min_sq_yards = 751, max_sq_yards = 1250
 WHERE level = 4;

UPDATE public.commission_ranks SET
  min_sq_yards = 1251, max_sq_yards = 2000
 WHERE level = 5;
