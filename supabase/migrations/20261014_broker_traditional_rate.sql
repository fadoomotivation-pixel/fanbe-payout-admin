-- What a traditional broker is "on", per gaj.
--
-- Admin, after Manisha's call: "commission hum Excel se dekh lenge nahi, ise bhi
-- bnao taki staff ko easy ho".
--
-- THE PROBLEM. In the Affiliate tree a broker's rank carries a commission %,
-- so the system can work out the whole chain by itself. Traditional has no
-- rank. Each broker is simply on a rate the office agreed with them -- "kisi
-- ko 100 rupaye gaj de rakha hai kisi ko 1000 kisi ko 1500 2000" -- and that
-- number lived nowhere but in somebody's head. So on every single booking the
-- office had to work out by hand what each person in the chain should get,
-- which is why the answer until now was "we will do the commission in Excel".
--
-- THE FIX IS ONE COLUMN. Put that agreed rate on the broker. Then the booking
-- form can fill the whole chain in one click: each level earns the DIFFERENCE
-- between their own rate and the rate of the person below them, exactly the
-- way the Affiliate differential works, only in rupees per gaj instead of a
-- percentage.
--
--   Pragya  1,000/gaj  ->  earns 1,000/gaj   (she sold it)
--   Shashi  1,200/gaj  ->  earns   200/gaj   (1,200 - 1,000)
--   Alok    1,500/gaj  ->  earns   300/gaj   (1,500 - 1,200)
--   Vaidehi 2,000/gaj  ->  earns   500/gaj   (2,000 - 1,500)
--
-- The total is never more than the top rate, which is the whole point of a
-- differential: on a 100 gaj deal the company pays 2,000 x 100, not the sum of
-- four separate rates.
--
-- NO NEW COMMISSION PATH. This column is read by the booking form only, to
-- pre-fill the bp_booking_brokers rows that already exist and that
-- recompute_booking_payouts() already pays. The arithmetic that turns rupees
-- per gaj into the stored percentage is the same line the payout function uses
-- for the direct broker:
--
--     pct = round((rate_per_sqyd * size_sqyd / total_amount) * 100, 4)
--
-- so a filled split and a hand-typed one end up identical, and commission is
-- still written in exactly one place.
--
-- Nothing is compulsory. A broker with no rate simply does not get pre-filled,
-- and every booking that works today keeps working untouched.
--
-- Plain ASCII, short lines, no long rules. Safe to run more than once.

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
  ADD COLUMN IF NOT EXISTS traditional_rate_per_sqyd numeric;

COMMENT ON COLUMN public.brokers.traditional_rate_per_sqyd IS
  'Traditional brokers only: the agreed rate in rupees per gaj that this broker '
  'is on. The booking form uses it to fill the team split, each level earning '
  'the difference between their rate and the one below. Null means no rate '
  'agreed yet - that broker is simply left out of the auto-fill.';

-- Disarm the old "Also pay upline differential" tick box on traditional bookings.
--
-- This is not tidying, it is money. That tick box set this flag, and the flag sends
-- recompute_booking_payouts() into the AFFILIATE cascade, which reads each upline's
-- percentage from commission_ranks via brokers.rank. A traditional broker has no real
-- rank, but the Add Broker form defaults the column to 'Executive', and Executive is a
-- live 5% slab -- both traditional brokers in the system are sitting on it right now.
--
-- So the moment the office builds the Vaidehi -> Alok -> Shashi -> Pragya chain, a
-- booking with this flag on would pay the upline 5% minus the direct rate of every
-- verified payment: Affiliate money on a traditional deal, with no connection to the
-- rate anybody agreed. On a 50 lakh sale at 2% direct that is about 1.5 lakh to the
-- wrong arithmetic. It has not fired yet only because no traditional broker has a
-- sponsor yet, which is exactly what is about to change.
--
-- One booking currently has it on. Nothing has been paid out under it
-- (payout_distributions has no traditional rows at all), so turning it off takes no
-- money off anybody -- it removes a payment that was never agreed.
--
-- Paying a traditional upline now has one route, and it is the agreed rate per gaj:
-- the booking form's "Fill team commission" writes bp_booking_brokers, and the split
-- branch of the same function pays those rows. The tick box is gone from the form.
UPDATE public.bp_bookings
   SET traditional_pay_upline = false
 WHERE commission_mode = 'traditional'
   AND traditional_pay_upline IS TRUE;

COMMIT;

-- After running:
--
--   SELECT count(*) FROM public.brokers WHERE traditional_rate_per_sqyd IS NOT NULL;
--   -- expect 0 until the office starts filling them in.
--
--   SELECT name, broker_id, traditional_rate_per_sqyd
--     FROM public.brokers WHERE broker_type = 'traditional' ORDER BY name;
