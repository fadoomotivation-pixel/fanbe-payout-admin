-- A traditional broker can be on a flat amount per plot, not only a rate per gaj.
--
-- Manisha, replying to "Brokers -> Edit -> Commission rate per gaj":
-- "Per plot par kardo ise bhi."
--
-- Both arrangements are real. "1000 rupaye gaj" scales with the plot; "is plot pe 50,000"
-- does not. The office agrees whichever suits the broker, and until now only the first
-- could be written down, so the second went on living in somebody's head -- which is the
-- exact problem the per-gaj column was added to solve.
--
-- WHAT IT MEANS FOR THE MONEY. Plots here run from 12.27 gaj to 583.30 gaj. A flat
-- 50,000 is 4,075 per gaj on the smallest and 86 per gaj on the largest -- the same
-- commission for a deal worth forty-seven times more. That is a legitimate way to pay a
-- broker and a very easy thing to agree to by accident, so wherever a per-plot rate is
-- entered the form shows what it works out to per gaj for that deal. The number is put in
-- front of whoever is deciding, rather than left to be discovered in a payout cycle.
--
-- ONE BASIS PER BROKER. A broker is on per-gaj or on per-plot, never both. The form
-- offers it as a choice and clears the other column, and the app reads per-plot first so
-- a row that somehow carries both still behaves one definite way instead of two.
--
-- NO NEW COMMISSION PATH, AGAIN. This is read by the booking form only, to work out what
-- each level of a traditional team earns. The arithmetic now runs in RUPEES ON THIS DEAL
-- rather than rupees per gaj -- a per-gaj broker contributes rate x size, a per-plot
-- broker contributes the flat amount -- so a chain can mix the two and still pay each
-- level the difference between their own figure and the best one below. It ends up in
-- bp_booking_brokers as a percentage, which recompute_booking_payouts() already pays.
--
-- Nothing is compulsory and nothing existing changes: every booking and every broker
-- that works today keeps working untouched.
--
-- Plain ASCII, short lines. Safe to run more than once.

BEGIN;

-- Refuse to run anywhere but the payout database.
DO $guard$
BEGIN
  IF to_regprocedure('public.is_staff()') IS NULL
     OR to_regclass('public.brokers') IS NULL THEN
    RAISE EXCEPTION '%',
      'Wrong Supabase project: public.is_staff() or public.brokers is missing '
      || 'here. Run this in Fanbe-CRM, project ref mfgjzkaabyltscgrkhdz. '
      || 'Nothing was changed.';
  END IF;
END
$guard$;

ALTER TABLE public.brokers
  ADD COLUMN IF NOT EXISTS traditional_rate_per_plot numeric;

COMMENT ON COLUMN public.brokers.traditional_rate_per_plot IS
  'Traditional brokers only: a flat amount in rupees for each plot sold, whatever its '
  'size. An alternative to traditional_rate_per_sqyd, never used together - the form '
  'clears the other one, and the app reads this column first. Null means this broker is '
  'not on a per-plot arrangement.';

COMMENT ON COLUMN public.brokers.traditional_rate_per_sqyd IS
  'Traditional brokers only: the agreed rate in rupees per gaj that this broker is on. '
  'The alternative is traditional_rate_per_plot, a flat amount per plot. The booking form '
  'uses whichever is set to fill the team split, each level earning the difference between '
  'their own figure and the one below. Null means no rate agreed yet - that broker is '
  'simply left out of the auto-fill.';

COMMIT;

-- After running:
--
--   SELECT name, broker_id,
--          traditional_rate_per_sqyd AS per_gaj,
--          traditional_rate_per_plot AS per_plot
--     FROM public.brokers
--    WHERE broker_type = 'traditional'
--    ORDER BY name;
--
-- Nobody should ever have both. If one day somebody does, this finds them:
--
--   SELECT name, broker_id FROM public.brokers
--    WHERE traditional_rate_per_sqyd > 0 AND traditional_rate_per_plot > 0;
