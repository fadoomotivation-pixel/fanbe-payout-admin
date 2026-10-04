-- Money integrity guards — found in the October deep review.
--
-- Stands alone: it (re)creates is_staff() with the same definition as
-- 20261003_lock_money_tables_to_staff.sql, so either can be applied first.
--
--  1. Brokers could write the money tables.  Every broker signs in as `authenticated`, and
--     bp_payments, bp_bookings, payout_cycles, bp_payout_transactions, expenses, EMI and
--     commission_ranks all had USING(true)/CHECK(true) write policies for that role.  A broker
--     could insert a "verified" payment on their own booking and the commission trigger would
--     credit them for money that never came in.  Writes are now staff-only; reads are left
--     exactly as they were so the broker portal keeps working.
--  2. pdc_clear_cheque / pdc_bounce_cheque (SECURITY DEFINER) were executable by `anon` —
--     anyone holding the public key could create a verified payment or delete one.
--  3. A cancelled booking kept earning commission: recompute_booking_payouts had no stage
--     check, so touching any of its payments re-credited the brokers.
--  4. Cancelling a booking left its EMI plan active (its kist counted as overdue everywhere),
--     and editing price / commission mode / traditional % / split brokers did not recompute
--     commission (the only recompute trigger was on broker_id).
--  5. A payment whose commission was already paid out in a closed cycle could be deleted
--     (the FK cascade then deleted the closed cycle's rows) or rejected (leaving paid-out
--     commission on a rejected payment).
--  6. bp_bookings.total_collected / balance_due counted pending and rejected payments, and
--     were never updated when a payment was deleted.

-- ── Who is staff (same as 20261003) ─────────────────────────────────
CREATE OR REPLACE FUNCTION public.is_staff()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.app_users u
     WHERE u.auth_user_id = auth.uid() AND u.active
  );
$$;
REVOKE EXECUTE ON FUNCTION public.is_staff() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.is_staff() TO authenticated;

-- ── 1. Money tables: anyone signed in may read (unchanged), only staff may write ──
-- Per-command policies (name pattern <table>_authenticated_<cmd>).
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['bp_payments','bp_bookings','bp_customers','bp_plots','bp_payout_transactions'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_authenticated_insert', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_authenticated_update', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_authenticated_delete', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR INSERT TO authenticated WITH CHECK (public.is_staff())', t || '_staff_insert', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated USING (public.is_staff()) WITH CHECK (public.is_staff())', t || '_staff_update', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR DELETE TO authenticated USING (public.is_staff())', t || '_staff_delete', t);
  END LOOP;

  -- p_insert / p_update / p_delete naming.
  FOREACH t IN ARRAY ARRAY['bp_booking_brokers','bp_pdc_cheques'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS p_insert ON public.%I', t);
    EXECUTE format('DROP POLICY IF EXISTS p_update ON public.%I', t);
    EXECUTE format('DROP POLICY IF EXISTS p_delete ON public.%I', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR INSERT TO authenticated WITH CHECK (public.is_staff())', t || '_staff_insert', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated USING (public.is_staff()) WITH CHECK (public.is_staff())', t || '_staff_update', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR DELETE TO authenticated USING (public.is_staff())', t || '_staff_delete', t);
  END LOOP;

  -- One FOR ALL policy: split into read-all + staff-write.
  FOREACH t IN ARRAY ARRAY['commission_ranks','emi_installments','emi_schedules','expenses'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS auth_all ON public.%I', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (true)', t || '_read', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR ALL TO authenticated USING (public.is_staff()) WITH CHECK (public.is_staff())', t || '_staff_write', t);
  END LOOP;
END $$;

DROP POLICY IF EXISTS payout_cycles_authenticated ON public.payout_cycles;
CREATE POLICY payout_cycles_read        ON public.payout_cycles FOR SELECT TO authenticated USING (true);
CREATE POLICY payout_cycles_staff_write ON public.payout_cycles FOR ALL    TO authenticated USING (public.is_staff()) WITH CHECK (public.is_staff());

-- ── 2. Functions: nothing callable without a login except the sign-in helpers ──
-- broker_email_for_login / broker_email_for_phone / get_email_by_username run before
-- sign-in, and submit_website_lead is the public website form — those keep anon.
REVOKE EXECUTE ON FUNCTION public.pdc_clear_cheque(uuid, date)       FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.pdc_bounce_cheque(uuid, text)      FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.recompute_booking_payouts(uuid)    FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.recompute_all_payouts()            FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.recompute_broker_ranks()           FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.bump_receipt_print(uuid)           FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.generate_receipt_no(uuid)          FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.next_receipt_no()                  FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.next_broker_code()                 FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.sync_broker_id_sequences()         FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.notify_due_followups()             FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.missed_followups_for_employee(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.broker_is_descendant(uuid, uuid)   FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.pdc_clear_cheque(uuid, date)       TO authenticated;
GRANT  EXECUTE ON FUNCTION public.pdc_bounce_cheque(uuid, text)      TO authenticated;
GRANT  EXECUTE ON FUNCTION public.recompute_booking_payouts(uuid)    TO authenticated;
GRANT  EXECUTE ON FUNCTION public.recompute_all_payouts()            TO authenticated;
GRANT  EXECUTE ON FUNCTION public.recompute_broker_ranks()           TO authenticated;
GRANT  EXECUTE ON FUNCTION public.bump_receipt_print(uuid)           TO authenticated;
GRANT  EXECUTE ON FUNCTION public.generate_receipt_no(uuid)          TO authenticated;
GRANT  EXECUTE ON FUNCTION public.next_receipt_no()                  TO authenticated;
GRANT  EXECUTE ON FUNCTION public.next_broker_code()                 TO authenticated;
GRANT  EXECUTE ON FUNCTION public.sync_broker_id_sequences()         TO authenticated;
GRANT  EXECUTE ON FUNCTION public.notify_due_followups()             TO authenticated;
GRANT  EXECUTE ON FUNCTION public.missed_followups_for_employee(uuid) TO authenticated;
GRANT  EXECUTE ON FUNCTION public.broker_is_descendant(uuid, uuid)   TO authenticated;

-- The two PDC functions are SECURITY DEFINER (they bypass RLS), so they check for staff
-- themselves — otherwise any broker login could clear or bounce a cheque.
CREATE OR REPLACE FUNCTION public.pdc_clear_cheque(p_cheque_id uuid, p_cleared_on date DEFAULT CURRENT_DATE)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  c          record;
  v_payment  uuid;
  v_sponsor  text;
BEGIN
  IF NOT public.is_staff() THEN
    RAISE EXCEPTION 'Only office staff can clear a cheque.';
  END IF;

  SELECT * INTO c FROM public.bp_pdc_cheques WHERE id = p_cheque_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Cheque not found';
  END IF;
  IF c.payment_id IS NOT NULL OR c.status = 'cleared' THEN
    RAISE EXCEPTION 'This cheque is already marked cleared -- no second payment was created.';
  END IF;
  IF c.status = 'cancelled' THEN
    RAISE EXCEPTION 'This cheque was cancelled. Re-enter it as a new cheque instead.';
  END IF;

  SELECT b.name INTO v_sponsor
    FROM public.bp_bookings bk
    LEFT JOIN public.brokers b ON b.id = bk.broker_id
   WHERE bk.id = c.booking_id;

  INSERT INTO public.bp_payments (
    booking_id, customer_id, payment_type, amount, payment_mode,
    cheque_no, bank_name, drawn_on_bank, branch,
    payment_date, verification_status, verified_at,
    subject_to_realisation, sponsor_name, notes
  ) VALUES (
    c.booking_id, c.customer_id, c.payment_type, c.amount, 'cheque',
    c.cheque_no, c.bank_name, c.bank_name, c.branch,
    p_cleared_on, 'verified', now(),
    false, v_sponsor,
    'Cleared PDC cheque ' || c.cheque_no
  )
  RETURNING id INTO v_payment;

  UPDATE public.bp_pdc_cheques
     SET status = 'cleared', cleared_on = p_cleared_on, payment_id = v_payment,
         bounce_reason = NULL
   WHERE id = c.id;

  RETURN v_payment;
END;
$function$;

CREATE OR REPLACE FUNCTION public.pdc_bounce_cheque(p_cheque_id uuid, p_reason text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  c          record;
  cycled     int;
  v_payment  uuid;
BEGIN
  IF NOT public.is_staff() THEN
    RAISE EXCEPTION 'Only office staff can bounce a cheque.';
  END IF;

  SELECT * INTO c FROM public.bp_pdc_cheques WHERE id = p_cheque_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Cheque not found';
  END IF;

  v_payment := c.payment_id;

  IF v_payment IS NOT NULL THEN
    SELECT count(*) INTO cycled
      FROM public.payout_distributions
     WHERE payment_id = v_payment AND cycle_id IS NOT NULL;
    IF cycled > 0 THEN
      RAISE EXCEPTION 'Commission on this cheque is already in a closed payout cycle. Reopen that cycle on /payout-cycles before bouncing it.';
    END IF;
  END IF;

  UPDATE public.bp_pdc_cheques
     SET status = 'bounced', bounce_reason = p_reason, cleared_on = NULL, payment_id = NULL
   WHERE id = c.id;

  IF v_payment IS NOT NULL THEN
    DELETE FROM public.bp_payments WHERE id = v_payment;
  END IF;
END;
$function$;

-- ── 3. No commission on a cancelled booking ─────────────────────────
-- Identical to the live function except the early exit: a cancelled booking keeps only the
-- rows already paid out in a closed cycle (that money has left; recovering it is a decision,
-- not a delete) and gets no new ones.
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
  bk_stage     text;
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
         COALESCE(bk.total_amount, bk.plot_total_price, 0),
         bk.stage
    INTO bk_mode, bk_trad_pct, bk_trad_psy, bk_pay_up, bk_size_sqyd, bk_total, bk_stage
    FROM public.bp_bookings bk
    LEFT JOIN public.bp_plots pl ON pl.id = bk.plot_id
   WHERE bk.id = p_booking;

  SELECT count(*) INTO multi_count
    FROM public.bp_booking_brokers WHERE booking_id = p_booking;

  DELETE FROM public.payout_distributions
   WHERE booking_id = p_booking
     AND cycle_id IS NULL;

  IF bk_stage = 'cancelled' THEN
    RETURN;
  END IF;

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
    -- Traditional multi-broker split: iterate bp_booking_brokers, skip cascade.
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
REVOKE EXECUTE ON FUNCTION public.recompute_booking_payouts(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.recompute_booking_payouts(uuid) TO authenticated;

-- ── 4. Booking changes that move money ──────────────────────────────
-- Cancel → close the EMI plan and drop unpaid commission.  Un-cancel → reopen the plan.
-- Any edit to what commission is computed from → recompute.  (Broker changes already have
-- their own trigger, trg_booking_broker_recompute.)
CREATE OR REPLACE FUNCTION public.trg_booking_money_sync()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.stage = 'cancelled' AND OLD.stage IS DISTINCT FROM 'cancelled' THEN
    UPDATE public.emi_schedules SET status = 'closed'
     WHERE booking_id = NEW.id AND status IS DISTINCT FROM 'closed';
  ELSIF OLD.stage = 'cancelled' AND NEW.stage IS DISTINCT FROM 'cancelled' THEN
    UPDATE public.emi_schedules SET status = 'active'
     WHERE booking_id = NEW.id AND status = 'closed';
  END IF;
  PERFORM public.recompute_booking_payouts(NEW.id);
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_booking_money_sync ON public.bp_bookings;
CREATE TRIGGER trg_booking_money_sync
  AFTER UPDATE OF stage, commission_mode, traditional_commission_pct, traditional_commission_per_sqyd,
                  traditional_pay_upline, total_amount, plot_total_price, size_sqyd
  ON public.bp_bookings
  FOR EACH ROW
  WHEN (OLD.stage IS DISTINCT FROM NEW.stage
     OR OLD.commission_mode IS DISTINCT FROM NEW.commission_mode
     OR OLD.traditional_commission_pct IS DISTINCT FROM NEW.traditional_commission_pct
     OR OLD.traditional_commission_per_sqyd IS DISTINCT FROM NEW.traditional_commission_per_sqyd
     OR OLD.traditional_pay_upline IS DISTINCT FROM NEW.traditional_pay_upline
     OR OLD.total_amount IS DISTINCT FROM NEW.total_amount
     OR OLD.plot_total_price IS DISTINCT FROM NEW.plot_total_price
     OR OLD.size_sqyd IS DISTINCT FROM NEW.size_sqyd)
  EXECUTE FUNCTION public.trg_booking_money_sync();

-- Split brokers are rewritten (delete + insert) on every booking edit.
CREATE OR REPLACE FUNCTION public.trg_booking_brokers_recompute()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  PERFORM public.recompute_booking_payouts(COALESCE(NEW.booking_id, OLD.booking_id));
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS trg_booking_brokers_recompute ON public.bp_booking_brokers;
CREATE TRIGGER trg_booking_brokers_recompute
  AFTER INSERT OR UPDATE OR DELETE ON public.bp_booking_brokers
  FOR EACH ROW EXECUTE FUNCTION public.trg_booking_brokers_recompute();

-- ── 5. Payments: paid-out commission and cancelled bookings ─────────
CREATE OR REPLACE FUNCTION public.guard_payment_money()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF EXISTS (SELECT 1 FROM public.bp_bookings WHERE id = NEW.booking_id AND stage = 'cancelled') THEN
      RAISE EXCEPTION 'This booking is cancelled -- a payment cannot be recorded on it.';
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE'
     OR OLD.amount IS DISTINCT FROM NEW.amount
     OR OLD.verification_status IS DISTINCT FROM NEW.verification_status
     OR OLD.booking_id IS DISTINCT FROM NEW.booking_id THEN
    IF EXISTS (SELECT 1 FROM public.payout_distributions
                WHERE payment_id = OLD.id AND cycle_id IS NOT NULL) THEN
      RAISE EXCEPTION 'Commission on this payment has already been paid out in a closed payout cycle. Reopen that cycle on /payout-cycles first.';
    END IF;
  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_guard_payment_money ON public.bp_payments;
CREATE TRIGGER trg_guard_payment_money
  BEFORE INSERT OR DELETE OR UPDATE OF amount, verification_status, booking_id
  ON public.bp_payments
  FOR EACH ROW EXECUTE FUNCTION public.guard_payment_money();

-- ── 6. Booking totals: verified money only, and kept right on delete ──
CREATE OR REPLACE FUNCTION public.update_booking_totals()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  b uuid;
BEGIN
  FOREACH b IN ARRAY ARRAY[
    CASE WHEN TG_OP <> 'DELETE' THEN NEW.booking_id END,
    CASE WHEN TG_OP <> 'INSERT' THEN OLD.booking_id END
  ] LOOP
    CONTINUE WHEN b IS NULL;
    UPDATE public.bp_bookings bk
       SET total_collected = s.paid,
           balance_due     = COALESCE(bk.plot_total_price, 0) - s.paid,
           updated_at      = now()
      FROM (SELECT COALESCE(SUM(amount), 0) AS paid
              FROM public.bp_payments
             WHERE booking_id = b AND verification_status = 'verified') s
     WHERE bk.id = b;
  END LOOP;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_update_booking_totals ON public.bp_payments;
CREATE TRIGGER trg_update_booking_totals
  AFTER INSERT OR DELETE OR UPDATE ON public.bp_payments
  FOR EACH ROW EXECUTE FUNCTION public.update_booking_totals();

-- Bring every booking's stored totals in line once.
UPDATE public.bp_bookings bk
   SET total_collected = COALESCE(s.paid, 0),
       balance_due     = COALESCE(bk.plot_total_price, 0) - COALESCE(s.paid, 0)
  FROM (SELECT b.id, (SELECT SUM(p.amount) FROM public.bp_payments p
                       WHERE p.booking_id = b.id AND p.verification_status = 'verified') AS paid
          FROM public.bp_bookings b) s
 WHERE s.id = bk.id
   AND (bk.total_collected IS DISTINCT FROM COALESCE(s.paid, 0)
     OR bk.balance_due IS DISTINCT FROM COALESCE(bk.plot_total_price, 0) - COALESCE(s.paid, 0));

-- Close the EMI plan of any booking that is already cancelled.
UPDATE public.emi_schedules s SET status = 'closed'
  FROM public.bp_bookings b
 WHERE b.id = s.booking_id AND b.stage = 'cancelled' AND s.status IS DISTINCT FROM 'closed';
