-- Admin: "make a system where traditional booking will treated different and mlm
-- booking treated different.  their both tree are different.  no relationship
-- with each other."
--
-- Two defensive guards at the data layer + a fix to the payout cascade so the
-- two networks can never bleed into each other:
--   1) BEFORE INSERT/UPDATE trigger on brokers that REJECTS a sponsor pointing
--      to a different broker_type.  Anyone walking sponsor_id can assume the
--      whole chain is one type.
--   2) recompute_booking_payouts(): the upline cascade now stops the moment
--      an upline broker is of a different type from the direct broker -- belt
--      and braces in case the trigger from (1) is bypassed.
--
-- UI changes go alongside this in src/pages/BrokerTree.tsx (tabs to switch
-- between the two trees, broker_type filter on the query) and
-- src/pages/Brokers.tsx (SponsorPicker filtered to same-type brokers, and
-- the form's broker_type toggle clears any cross-type sponsor that's selected).

-- 1) Same-type-sponsor guard.
CREATE OR REPLACE FUNCTION public.enforce_same_type_sponsor()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sponsor_type text;
BEGIN
  IF NEW.sponsor_id IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT broker_type INTO v_sponsor_type FROM public.brokers WHERE id = NEW.sponsor_id;
  IF v_sponsor_type IS NOT NULL
     AND NEW.broker_type IS NOT NULL
     AND v_sponsor_type <> NEW.broker_type THEN
    RAISE EXCEPTION 'Sponsor broker_type (%) must match the broker''s broker_type (%) -- MLM and traditional trees are kept strictly separate.',
      v_sponsor_type, NEW.broker_type;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_same_type_sponsor ON public.brokers;
CREATE TRIGGER trg_enforce_same_type_sponsor
BEFORE INSERT OR UPDATE OF sponsor_id, broker_type ON public.brokers
FOR EACH ROW EXECUTE FUNCTION public.enforce_same_type_sponsor();

-- 2) Cascade stop-at-type-boundary.
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
  bb         record;
  direct_pct numeric;
  direct_pct_found boolean;
  direct_type text;
  cur_broker uuid;
  cur_pct    numeric;
  cur_type   text;
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
  multi_count  integer;
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

  SELECT count(*) INTO multi_count
    FROM public.bp_booking_brokers WHERE booking_id = p_booking;

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
    IF bk_mode = 'traditional' AND multi_count > 0 THEN
      FOR bb IN
        SELECT broker_id, commission_pct, position
          FROM public.bp_booking_brokers
         WHERE booking_id = p_booking
         ORDER BY position
      LOOP
        IF bb.commission_pct > 0 THEN
          gross := round(pay.amount * bb.commission_pct / 100, 2);
          net   := round(gross * (100 - cfg_tds - cfg_admin) / 100, 2);
          INSERT INTO public.payout_distributions
            (booking_id, payment_id, beneficiary_broker_id, level, income_type, base_amount,
             rate_pct, upline_rank_pct, downline_rank_pct, differential_pct,
             gross_payout, tds_amount, admin_charge, net_payout, status)
          VALUES
            (pay.booking_id, pay.payment_id, bb.broker_id, bb.position - 1,
             'traditional_split', pay.amount,
             bb.commission_pct, bb.commission_pct, 0, bb.commission_pct,
             gross, round(gross*cfg_tds/100,2), round(gross*cfg_admin/100,2), net, 'credited');
        END IF;
      END LOOP;
      CONTINUE;
    END IF;

    -- Direct broker pct + broker_type up front -- the type stamps the cascade.
    SELECT broker_type INTO direct_type FROM public.brokers WHERE id = pay.broker_id;
    direct_pct_found := true;
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
      IF direct_pct IS NULL THEN
        direct_pct_found := false;
        direct_pct := 0;
        RAISE WARNING 'recompute_booking_payouts: broker % has unmapped rank, MLM cascade skipped for booking %', pay.broker_id, p_booking;
      ELSE
        direct_pct := COALESCE(direct_pct, 0);
      END IF;
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

    IF (bk_mode = 'mlm' AND direct_pct_found) OR (bk_mode = 'traditional' AND bk_pay_up) THEN
      below_pct := direct_pct; cur_broker := pay.broker_id; lvl := 0; safety := 0;
      LOOP
        safety := safety + 1; EXIT WHEN safety > 15;
        SELECT sponsor_id INTO cur_broker FROM public.brokers WHERE id = cur_broker;
        EXIT WHEN cur_broker IS NULL;
        -- Stop at type boundary: an MLM upline never earns from a traditional
        -- deal and vice versa.  The two trees are kept strictly separate.
        SELECT broker_type INTO cur_type FROM public.brokers WHERE id = cur_broker;
        EXIT WHEN direct_type IS NOT NULL AND cur_type IS NOT NULL AND cur_type <> direct_type;
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
