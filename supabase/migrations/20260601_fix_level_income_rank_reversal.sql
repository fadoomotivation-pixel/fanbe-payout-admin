-- Admin complaint about level income.  Found the bug:
-- The upline differential cascade walks sponsor_id chain, and at each level computes
--   diff = cur_pct - below_pct
-- Then unconditionally sets below_pct := cur_pct.  But when cur_pct < below_pct
-- (an upline has a LOWER rank than someone downstream — happens with rank reversals
-- or unranked brokers in the chain), below_pct gets RESET DOWNWARD.  That lets the
-- next higher upline over-claim the differential.
--
-- Concrete: D(5%) → S1(12%) → S2(8%) → S3(15%).  Old code paid:
--   S1: 12-5 = 7%        ✓
--   S2: 8-12 = -4 → skipped, below_pct := 8 ← BUG (should stay 12)
--   S3: 15-8 = 7%        ✗ should be 15-12 = 3%
--
-- Fix: below_pct := GREATEST(below_pct, cur_pct).  The floor only ever rises.

CREATE OR REPLACE FUNCTION public.recompute_booking_payouts(p_booking uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  cfg_tds   numeric := 5;
  cfg_admin numeric := 10;
  pay        record;
  direct_pct numeric;
  cur_broker uuid;
  cur_pct    numeric;
  below_pct  numeric;
  diff       numeric;
  lvl        integer;
  gross      numeric;
  net        numeric;
  safety     integer;
BEGIN
  BEGIN
    SELECT COALESCE((value->>'tds_pct')::numeric, 5),
           COALESCE((value->>'admin_charge_pct')::numeric, 10)
      INTO cfg_tds, cfg_admin
    FROM public.app_settings WHERE key = 'payout_config' LIMIT 1;
  EXCEPTION WHEN OTHERS THEN cfg_tds := 5; cfg_admin := 10; END;

  DELETE FROM public.payout_distributions
   WHERE booking_id = p_booking
     AND cycle_id IS NULL;

  FOR pay IN
    SELECT p.id AS payment_id, p.booking_id, p.amount, bk.broker_id
    FROM public.bp_payments p
    JOIN public.bp_bookings bk ON bk.id = p.booking_id
    WHERE p.booking_id = p_booking
      AND p.verification_status = 'verified'
      AND bk.broker_id IS NOT NULL
      AND p.amount > 0
      AND NOT EXISTS (
        SELECT 1 FROM public.payout_distributions pd
        WHERE pd.payment_id = p.id AND pd.cycle_id IS NOT NULL
      )
  LOOP
    SELECT cr.commission_pct INTO direct_pct
    FROM public.brokers b JOIN public.commission_ranks cr ON cr.rank_name = b.rank
    WHERE b.id = pay.broker_id;
    direct_pct := COALESCE(direct_pct, 0);

    IF direct_pct > 0 THEN
      gross := round(pay.amount * direct_pct / 100, 2);
      net   := round(gross * (100 - cfg_tds - cfg_admin) / 100, 2);
      INSERT INTO public.payout_distributions
        (booking_id, payment_id, beneficiary_broker_id, level, income_type, base_amount,
         rate_pct, upline_rank_pct, downline_rank_pct, differential_pct,
         gross_payout, tds_amount, admin_charge, net_payout, status)
      VALUES
        (pay.booking_id, pay.payment_id, pay.broker_id, 0, 'direct', pay.amount,
         direct_pct, direct_pct, 0, direct_pct,
         gross, round(gross*cfg_tds/100,2), round(gross*cfg_admin/100,2), net, 'credited');
    END IF;

    below_pct := direct_pct; cur_broker := pay.broker_id; lvl := 0; safety := 0;
    LOOP
      safety := safety + 1; EXIT WHEN safety > 15;
      SELECT sponsor_id INTO cur_broker FROM public.brokers WHERE id = cur_broker;
      EXIT WHEN cur_broker IS NULL;
      lvl := lvl + 1;
      SELECT cr.commission_pct INTO cur_pct
      FROM public.brokers b JOIN public.commission_ranks cr ON cr.rank_name = b.rank
      WHERE b.id = cur_broker;
      cur_pct := COALESCE(cur_pct, 0);
      diff := cur_pct - below_pct;
      IF diff > 0 THEN
        gross := round(pay.amount * diff / 100, 2);
        net   := round(gross * (100 - cfg_tds - cfg_admin) / 100, 2);
        INSERT INTO public.payout_distributions
          (booking_id, payment_id, beneficiary_broker_id, level, income_type, base_amount,
           rate_pct, upline_rank_pct, downline_rank_pct, differential_pct,
           gross_payout, tds_amount, admin_charge, net_payout, status)
        VALUES
          (pay.booking_id, pay.payment_id, cur_broker, lvl, 'differential', pay.amount,
           diff, cur_pct, below_pct, diff,
           gross, round(gross*cfg_tds/100,2), round(gross*cfg_admin/100,2), net, 'credited');
      END IF;
      below_pct := GREATEST(below_pct, cur_pct);
    END LOOP;
  END LOOP;
END $fn$;

CREATE OR REPLACE FUNCTION public.recompute_all_payouts()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  cfg_tds   numeric := 5;
  cfg_admin numeric := 10;
  rec_count integer := 0;
  pay        record;
  direct_pct numeric;
  cur_broker uuid;
  cur_pct    numeric;
  below_pct  numeric;
  diff       numeric;
  lvl        integer;
  gross      numeric;
  net        numeric;
  safety     integer;
BEGIN
  BEGIN
    SELECT COALESCE((value->>'tds_pct')::numeric, 5),
           COALESCE((value->>'admin_charge_pct')::numeric, 10)
      INTO cfg_tds, cfg_admin
    FROM public.app_settings WHERE key = 'payout_config' LIMIT 1;
  EXCEPTION WHEN OTHERS THEN cfg_tds := 5; cfg_admin := 10; END;

  DELETE FROM public.payout_distributions WHERE cycle_id IS NULL;

  FOR pay IN
    SELECT p.id AS payment_id, p.booking_id, p.amount, bk.broker_id
    FROM public.bp_payments p
    JOIN public.bp_bookings bk ON bk.id = p.booking_id
    WHERE p.verification_status = 'verified' AND bk.broker_id IS NOT NULL AND p.amount > 0
      AND NOT EXISTS (
        SELECT 1 FROM public.payout_distributions pd
        WHERE pd.payment_id = p.id AND pd.cycle_id IS NOT NULL
      )
  LOOP
    SELECT cr.commission_pct INTO direct_pct
    FROM public.brokers b JOIN public.commission_ranks cr ON cr.rank_name = b.rank
    WHERE b.id = pay.broker_id;
    direct_pct := COALESCE(direct_pct, 0);

    IF direct_pct > 0 THEN
      gross := round(pay.amount * direct_pct / 100, 2);
      net   := round(gross * (100 - cfg_tds - cfg_admin) / 100, 2);
      INSERT INTO public.payout_distributions
        (booking_id, payment_id, beneficiary_broker_id, level, income_type, base_amount,
         rate_pct, upline_rank_pct, downline_rank_pct, differential_pct,
         gross_payout, tds_amount, admin_charge, net_payout, status)
      VALUES
        (pay.booking_id, pay.payment_id, pay.broker_id, 0, 'direct', pay.amount,
         direct_pct, direct_pct, 0, direct_pct,
         gross, round(gross*cfg_tds/100,2), round(gross*cfg_admin/100,2), net, 'credited');
      rec_count := rec_count + 1;
    END IF;

    below_pct  := direct_pct;
    cur_broker := pay.broker_id;
    lvl        := 0;
    safety     := 0;
    LOOP
      safety := safety + 1; EXIT WHEN safety > 15;
      SELECT sponsor_id INTO cur_broker FROM public.brokers WHERE id = cur_broker;
      EXIT WHEN cur_broker IS NULL;
      lvl := lvl + 1;
      SELECT cr.commission_pct INTO cur_pct
      FROM public.brokers b JOIN public.commission_ranks cr ON cr.rank_name = b.rank
      WHERE b.id = cur_broker;
      cur_pct := COALESCE(cur_pct, 0);

      diff := cur_pct - below_pct;
      IF diff > 0 THEN
        gross := round(pay.amount * diff / 100, 2);
        net   := round(gross * (100 - cfg_tds - cfg_admin) / 100, 2);
        INSERT INTO public.payout_distributions
          (booking_id, payment_id, beneficiary_broker_id, level, income_type, base_amount,
           rate_pct, upline_rank_pct, downline_rank_pct, differential_pct,
           gross_payout, tds_amount, admin_charge, net_payout, status)
        VALUES
          (pay.booking_id, pay.payment_id, cur_broker, lvl, 'differential', pay.amount,
           diff, cur_pct, below_pct, diff,
           gross, round(gross*cfg_tds/100,2), round(gross*cfg_admin/100,2), net, 'credited');
        rec_count := rec_count + 1;
      END IF;
      below_pct := GREATEST(below_pct, cur_pct);
    END LOOP;
  END LOOP;

  RETURN rec_count;
END $fn$;
