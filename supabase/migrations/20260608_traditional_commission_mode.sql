-- Traditional (non-MLM) plot sale mode.
--
-- Until now every bp_booking ran through the MLM differential engine using the
-- broker's rank.commission_pct + upline cascade.  Admin needs to sell some plots
-- the "traditional" way -- a custom commission paid only to the direct broker,
-- with no upline cascade by default.  Two input shapes:
--
--   1. traditional_commission_pct       -- straight % of deposited amount
--   2. traditional_commission_per_sqyd  -- Rs/sq.yd, multiplied by plot.size_sqyd
--                                          to derive an equivalent % for the engine
--
-- traditional_pay_upline lets admin opt back in to the differential cascade on a
-- per-booking basis (mixed model) for the rare case where they want to honour
-- upline payouts on a one-off traditional sale.

ALTER TABLE public.bp_bookings
  ADD COLUMN IF NOT EXISTS commission_mode TEXT NOT NULL DEFAULT 'mlm'
    CHECK (commission_mode IN ('mlm', 'traditional')),
  ADD COLUMN IF NOT EXISTS traditional_commission_pct NUMERIC,
  ADD COLUMN IF NOT EXISTS traditional_commission_per_sqyd NUMERIC,
  ADD COLUMN IF NOT EXISTS traditional_pay_upline BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.bp_bookings.commission_mode IS
  'mlm = default (broker rank % + upline differential cascade); traditional = custom % paid only to direct broker.';
COMMENT ON COLUMN public.bp_bookings.traditional_commission_pct IS
  'Custom commission % used when commission_mode = traditional and a flat % was chosen.';
COMMENT ON COLUMN public.bp_bookings.traditional_commission_per_sqyd IS
  'Custom rate per sq.yd used when commission_mode = traditional and a per-gaj rate was chosen.  Trigger derives an equivalent % using plot.size_sqyd.';
COMMENT ON COLUMN public.bp_bookings.traditional_pay_upline IS
  'Default false.  When true, traditional bookings ALSO run the upline differential cascade after the direct payout.';


-- Update recompute_booking_payouts to branch on commission_mode.
CREATE OR REPLACE FUNCTION public.recompute_booking_payouts(p_booking uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  bk_mode    text;
  bk_trad_pct  numeric;
  bk_trad_psy  numeric;
  bk_pay_up    boolean;
  bk_size_sqyd numeric;
  bk_total     numeric;
BEGIN
  BEGIN
    SELECT COALESCE((value->>'tds_pct')::numeric, 5),
           COALESCE((value->>'admin_charge_pct')::numeric, 10)
      INTO cfg_tds, cfg_admin
    FROM public.app_settings WHERE key = 'payout_config' LIMIT 1;
  EXCEPTION WHEN OTHERS THEN cfg_tds := 5; cfg_admin := 10; END;

  SELECT bk.commission_mode,
         bk.traditional_commission_pct,
         bk.traditional_commission_per_sqyd,
         bk.traditional_pay_upline,
         COALESCE(bk.size_sqyd, pl.size_sqyd, 0),
         COALESCE(bk.total_amount, bk.plot_total_price, 0)
    INTO bk_mode, bk_trad_pct, bk_trad_psy, bk_pay_up, bk_size_sqyd, bk_total
    FROM public.bp_bookings bk
    LEFT JOIN public.bp_plots pl ON pl.id = bk.plot_id
   WHERE bk.id = p_booking;

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
    IF bk_mode = 'traditional' THEN
      IF bk_trad_pct IS NOT NULL THEN
        direct_pct := bk_trad_pct;
      ELSIF bk_trad_psy IS NOT NULL AND bk_size_sqyd > 0 AND bk_total > 0 THEN
        direct_pct := round((bk_trad_psy * bk_size_sqyd / bk_total) * 100, 4);
      ELSE
        direct_pct := 0;
      END IF;
    ELSE
      SELECT cr.commission_pct INTO direct_pct
      FROM public.brokers b JOIN public.commission_ranks cr ON cr.rank_name = b.rank
      WHERE b.id = pay.broker_id;
      direct_pct := COALESCE(direct_pct, 0);
    END IF;

    IF direct_pct > 0 THEN
      gross := round(pay.amount * direct_pct / 100, 2);
      net   := round(gross * (100 - cfg_tds - cfg_admin) / 100, 2);
      INSERT INTO public.payout_distributions
        (booking_id, payment_id, beneficiary_broker_id, level, income_type, base_amount,
         rate_pct, upline_rank_pct, downline_rank_pct, differential_pct,
         gross_payout, tds_amount, admin_charge, net_payout, status)
      VALUES
        (pay.booking_id, pay.payment_id, pay.broker_id, 0,
         CASE WHEN bk_mode = 'traditional' THEN 'traditional_direct' ELSE 'direct' END,
         pay.amount,
         direct_pct, direct_pct, 0, direct_pct,
         gross, round(gross*cfg_tds/100,2), round(gross*cfg_admin/100,2), net, 'credited');
    END IF;

    IF bk_mode = 'mlm' OR bk_pay_up THEN
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
    END IF;
  END LOOP;
END $function$;
