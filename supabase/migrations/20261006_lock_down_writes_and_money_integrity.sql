-- ============================================================================
-- CRITICAL security + money-integrity pass.
--
-- Every broker signs in as the Postgres role `authenticated`, the same role the office
-- uses, and the anon key is printed in the site's JS.  The UI route guard runs in the
-- browser and stops nobody: anyone with any login can call the REST API directly.  So
-- every rule below has to live in the database.
--
-- 20261003 closed the five worst write holes and IS live — but only its policies landed;
-- the `brokers` column guard trigger it defines is NOT on the live table (checked), so a
-- broker could still edit their own rank, sponsor, KYC and TDS flag.  That, plus the rest
-- of the holes found in review, is what this migration closes:
--
--   1. Bank details, KYC, roles/permissions, reward tiers, payout terms, commission rules
--      and ~30 more tables accept writes from ANY logged-in user (policy `USING (true)`).
--   2. A broker can edit their own broker row (rank → higher commission; kyc_status →
--      'approved' unlocks payouts; sponsor_id → re-parent themselves under a bigger tree).
--   3. A broker can insert brokers.  Rank promotion counts downline brokers at or above a
--      rank level, is promote-only and never reverses — three fake high-rank children
--      promote the parent permanently.
--   4. pdc_clear_cheque() creates a VERIFIED payment (and so pays commission) and is
--      executable by any logged-in user.  recompute_all_payouts() rewrites every unpaid
--      commission row and nothing in the app calls it.
--   5. Commission already paid in a cycle could be wiped by deleting the payment, booking
--      or broker it hangs off.
--   6. Withdrawals were only ever checked against the wallet in the browser.
--   7. Cancelled bookings earn commission again on the next edit.
--   8. One plot could be sold twice; plot status never moved to 'booked' for the
--      multi-plot bookings that have been the norm since 20260806.
--   9. Brokers can read every customer's phone and PAN, and every other broker's bank
--      details and commission.
--  10. The `documents` bucket is public: every KYC scan is world-readable by URL.
--
-- Safe to run more than once: every statement is DROP ... IF EXISTS / CREATE OR REPLACE.
-- Deletes no data.  Does not touch the call-centre CRM that shares this database
-- (leads, calls, crm_*, hr_*, attendance, profiles, site_visits, tasks, employee_leads).
-- Commission MATH is unchanged — only who may write, and whether cancelled bookings earn.
-- ============================================================================
BEGIN;

-- ── Who is staff ────────────────────────────────────────────────────────────
-- SECURITY DEFINER so it reads app_users past that table's own RLS.  STABLE so the
-- planner calls it once per statement instead of once per row.
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

-- ── Which brokers is the caller allowed to see ──────────────────────────────
-- The signed-in broker plus everyone under them, however deep.  A broker's portal shows
-- their own money and their team's; it has no business reading the rest of the company.
--
-- Returned as an array from one SECURITY DEFINER call rather than a sub-select inside each
-- policy: the walk is done once per statement (STABLE), and reading `brokers` from inside
-- a policy ON `brokers` would otherwise recurse.
CREATE OR REPLACE FUNCTION public.my_broker_subtree()
RETURNS uuid[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  WITH RECURSIVE me AS (
    SELECT b.id FROM public.brokers b WHERE b.auth_user_id = auth.uid()
    UNION
    SELECT c.id FROM public.brokers c JOIN me ON c.sponsor_id = me.id
  )
  SELECT COALESCE(array_agg(id), ARRAY[]::uuid[]) FROM me;
$$;
REVOKE EXECUTE ON FUNCTION public.my_broker_subtree() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.my_broker_subtree() TO authenticated;

-- The caller's own broker row(s).  Used where "mine" must not stretch to the downline —
-- a broker uploads their OWN KYC, not their team's.
CREATE OR REPLACE FUNCTION public.my_broker_ids()
RETURNS uuid[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT COALESCE(array_agg(id), ARRAY[]::uuid[])
    FROM public.brokers WHERE auth_user_id = auth.uid();
$$;
REVOKE EXECUTE ON FUNCTION public.my_broker_ids() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.my_broker_ids() TO authenticated;


-- ════════════════════════════════════════════════════════════════════════════
-- 1.  Tables that accept writes from anyone → staff writes, reads unchanged
-- ════════════════════════════════════════════════════════════════════════════
-- Each of these had `FOR ALL USING (true) WITH CHECK (true)`, or the insert/update/delete
-- equivalents.  Only the office app writes them; nothing in the broker portal does
-- (verified against every .insert/.update/.delete call in src/).  Reading stays open so
-- the portal's rank slabs, project pages and notices keep working.
--
-- Several carry their old rules under the role `public` — which in Postgres means EVERY
-- role, so those grant the same write to any logged-in user by another name.  Rather than
-- guess at eight years of policy names, every existing policy on these tables is dropped
-- and replaced by exactly two.  That also makes this block safe to re-run.
--
-- The table list is written out rather than discovered by scanning for `true` policies:
-- it keeps the call-centre CRM (leads, calls, crm_*, hr_*, attendance, profiles,
-- site_visits, tasks, employee_leads) out of reach by construction.
DO $$
DECLARE t text; pol text; pols text[];
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'achievers_club_config','achievers_club_months','achievers_club_payouts',
    'achievers_club_periods','bp_booking_activity','bp_booking_plots',
    'bp_booking_receipts','bp_commission_rules','bp_customer_ledger',
    'bp_emi_installments','bp_emi_schedule','bp_members','bp_notifications',
    'bp_payment_queue','bp_plot_hold_log','bp_projects','bp_settings',
    'broker_bonanza_direct','broker_bonanza_team','broker_payouts','broker_rank_rules',
    'broker_rank_stats','broker_sales','broker_terms','expense_heads','news_events',
    'payout_terms_config','pending_payments','registry_members','sponsor_tree',
    'team_reward_tiers'
  ] LOOP
    -- Names are collected first: dropping policies while still reading pg_policies would
    -- be changing the catalog this loop is walking.
    SELECT COALESCE(array_agg(policyname), ARRAY[]::text[]) INTO pols
      FROM pg_policies WHERE schemaname = 'public' AND tablename = t;
    FOREACH pol IN ARRAY pols LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', pol, t);
    END LOOP;
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (true)',
      t || '_read_all', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL TO authenticated '
      'USING (public.is_staff()) WITH CHECK (public.is_staff())',
      t || '_staff_write', t);
  END LOOP;
END $$;

-- project_content and project_documents are the same story, minus one detail: 20260916
-- deliberately left them readable without a login, because that is what the public
-- website renders from.  So only the write side is taken away here.
DROP POLICY IF EXISTS project_content_authenticated_insert ON public.project_content;
DROP POLICY IF EXISTS project_content_authenticated_update ON public.project_content;
DROP POLICY IF EXISTS project_content_authenticated_delete ON public.project_content;
DROP POLICY IF EXISTS project_content_staff_write          ON public.project_content;
CREATE POLICY project_content_staff_write ON public.project_content
  FOR ALL TO authenticated USING (public.is_staff()) WITH CHECK (public.is_staff());

DROP POLICY IF EXISTS "Allow authenticated users full access" ON public.project_documents;
DROP POLICY IF EXISTS project_documents_staff_write          ON public.project_documents;
CREATE POLICY project_documents_staff_write ON public.project_documents
  FOR ALL TO authenticated USING (public.is_staff()) WITH CHECK (public.is_staff());


-- ════════════════════════════════════════════════════════════════════════════
-- 2.  Bank details, roles and permissions → staff only, including READ
-- ════════════════════════════════════════════════════════════════════════════
-- Account numbers and the permission table are not something a broker should be able to
-- read, let alone rewrite.  `role_permissions` is what the office UI reads to decide who
-- may do what, so a broker who can edit it can hand themselves the office.
DROP POLICY IF EXISTS auth_all                 ON public.company_bank_accounts;
DROP POLICY IF EXISTS company_bank_accounts_staff ON public.company_bank_accounts;
CREATE POLICY company_bank_accounts_staff ON public.company_bank_accounts
  FOR ALL TO authenticated USING (public.is_staff()) WITH CHECK (public.is_staff());

DROP POLICY IF EXISTS auth_all      ON public.roles;
DROP POLICY IF EXISTS roles_staff   ON public.roles;
CREATE POLICY roles_staff ON public.roles
  FOR ALL TO authenticated USING (public.is_staff()) WITH CHECK (public.is_staff());

DROP POLICY IF EXISTS auth_all                   ON public.role_permissions;
DROP POLICY IF EXISTS role_permissions_staff     ON public.role_permissions;
CREATE POLICY role_permissions_staff ON public.role_permissions
  FOR ALL TO authenticated USING (public.is_staff()) WITH CHECK (public.is_staff());

-- A broker's bank row: theirs to read, the office's to write.
DROP POLICY IF EXISTS bp_broker_bank_authenticated_select ON public.bp_broker_bank;
DROP POLICY IF EXISTS bp_broker_bank_authenticated_insert ON public.bp_broker_bank;
DROP POLICY IF EXISTS bp_broker_bank_authenticated_update ON public.bp_broker_bank;
DROP POLICY IF EXISTS bp_broker_bank_authenticated_delete ON public.bp_broker_bank;
DROP POLICY IF EXISTS bp_broker_bank_read_own              ON public.bp_broker_bank;
DROP POLICY IF EXISTS bp_broker_bank_staff                 ON public.bp_broker_bank;
CREATE POLICY bp_broker_bank_staff ON public.bp_broker_bank
  FOR ALL TO authenticated USING (public.is_staff()) WITH CHECK (public.is_staff());
CREATE POLICY bp_broker_bank_read_own ON public.bp_broker_bank
  FOR SELECT TO authenticated USING (broker_id = ANY (public.my_broker_ids()));


-- ════════════════════════════════════════════════════════════════════════════
-- 3.  KYC — a broker may submit their own, only the office may verify
-- ════════════════════════════════════════════════════════════════════════════
-- The portal's upload writes a bp_broker_kyc row for the broker themselves.  Everything
-- else — verifying, editing, deleting, reading someone else's — is the office's.
DROP POLICY IF EXISTS bp_broker_kyc_authenticated_select ON public.bp_broker_kyc;
DROP POLICY IF EXISTS bp_broker_kyc_authenticated_insert ON public.bp_broker_kyc;
DROP POLICY IF EXISTS bp_broker_kyc_authenticated_update ON public.bp_broker_kyc;
DROP POLICY IF EXISTS bp_broker_kyc_authenticated_delete ON public.bp_broker_kyc;
DROP POLICY IF EXISTS bp_broker_kyc_staff      ON public.bp_broker_kyc;
DROP POLICY IF EXISTS bp_broker_kyc_read_own   ON public.bp_broker_kyc;
DROP POLICY IF EXISTS bp_broker_kyc_insert_own ON public.bp_broker_kyc;
CREATE POLICY bp_broker_kyc_staff ON public.bp_broker_kyc
  FOR ALL TO authenticated USING (public.is_staff()) WITH CHECK (public.is_staff());
CREATE POLICY bp_broker_kyc_read_own ON public.bp_broker_kyc
  FOR SELECT TO authenticated USING (broker_id = ANY (public.my_broker_ids()));
-- `verified = false` in the CHECK is the point: a broker can hand in a document, not mark
-- it accepted.  No UPDATE or DELETE policy — once submitted it is the office's record.
CREATE POLICY bp_broker_kyc_insert_own ON public.bp_broker_kyc
  FOR INSERT TO authenticated
  WITH CHECK (broker_id = ANY (public.my_broker_ids()) AND COALESCE(verified, false) = false);


-- ════════════════════════════════════════════════════════════════════════════
-- 4.  The audit trail cannot be edited or deleted by anyone
-- ════════════════════════════════════════════════════════════════════════════
-- A log that the person being logged can delete is not a log.  Inserts stay open to
-- signed-in users because the activity triggers run as the caller; there is deliberately
-- no UPDATE and no DELETE policy, so neither is possible through the API at all.
DROP POLICY IF EXISTS bp_audit_log_authenticated_select ON public.bp_audit_log;
DROP POLICY IF EXISTS bp_audit_log_authenticated_insert ON public.bp_audit_log;
DROP POLICY IF EXISTS bp_audit_log_authenticated_update ON public.bp_audit_log;
DROP POLICY IF EXISTS bp_audit_log_authenticated_delete ON public.bp_audit_log;
DROP POLICY IF EXISTS bp_audit_log_read   ON public.bp_audit_log;
DROP POLICY IF EXISTS bp_audit_log_append ON public.bp_audit_log;
CREATE POLICY bp_audit_log_read   ON public.bp_audit_log
  FOR SELECT TO authenticated USING (public.is_staff());
CREATE POLICY bp_audit_log_append ON public.bp_audit_log
  FOR INSERT TO authenticated WITH CHECK (true);


-- ════════════════════════════════════════════════════════════════════════════
-- 5.  brokers — the column guard 20261003 defined but never got onto the table
-- ════════════════════════════════════════════════════════════════════════════
-- RLS can scope a broker to their own ROW but cannot say "these COLUMNS are off limits",
-- so the column rules are a trigger.  The trigger is the real lock; the policies below
-- only decide which rows are in reach.
DROP POLICY IF EXISTS brokers_authenticated_update ON public.brokers;
DROP POLICY IF EXISTS brokers_authenticated_delete ON public.brokers;
DROP POLICY IF EXISTS brokers_authenticated_insert ON public.brokers;
DROP POLICY IF EXISTS brokers_authenticated_select ON public.brokers;
DROP POLICY IF EXISTS brokers_update ON public.brokers;
DROP POLICY IF EXISTS brokers_insert ON public.brokers;
DROP POLICY IF EXISTS brokers_delete ON public.brokers;
DROP POLICY IF EXISTS brokers_select ON public.brokers;

-- Read: the office sees everyone; a broker sees themselves and their own downline.  This
-- is what stops one broker reading every other broker's account number and PAN.
CREATE POLICY brokers_select ON public.brokers
  FOR SELECT TO authenticated
  USING (public.is_staff() OR id = ANY (public.my_broker_subtree()));
CREATE POLICY brokers_update ON public.brokers
  FOR UPDATE TO authenticated
  USING      (public.is_staff() OR auth_user_id = auth.uid())
  WITH CHECK (public.is_staff() OR auth_user_id = auth.uid());
CREATE POLICY brokers_insert ON public.brokers
  FOR INSERT TO authenticated WITH CHECK (true);   -- the trigger decides what it may contain
CREATE POLICY brokers_delete ON public.brokers
  FOR DELETE TO authenticated USING (public.is_staff());

CREATE OR REPLACE FUNCTION public.brokers_guard_non_staff()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_me        uuid;
  v_base_rank text;
BEGIN
  -- Staff write freely.  auth.uid() IS NULL covers the SECURITY DEFINER recompute jobs,
  -- the import scripts and anything run from the SQL editor.
  IF auth.uid() IS NULL OR public.is_staff() THEN
    RETURN NEW;
  END IF;

  SELECT id INTO v_me FROM public.brokers WHERE auth_user_id = auth.uid() LIMIT 1;

  IF TG_OP = 'INSERT' THEN
    -- A broker may add someone to their own team (the portal's "promote customer to
    -- broker"), but may not hand that person authority or a rank.
    --
    -- Rank is forced to the lowest active slab, and this is the whole point: promotion
    -- counts downline brokers at or above a rank level, only ever goes up, and never
    -- reverses.  Left free, three invented children at a high rank would permanently
    -- promote their parent and raise the commission on every future payment.
    IF v_me IS NULL THEN
      RAISE EXCEPTION 'Only the office can add brokers.';
    END IF;
    SELECT rank_name INTO v_base_rank
      FROM public.commission_ranks WHERE active IS TRUE ORDER BY level ASC LIMIT 1;

    NEW.sponsor_id      := v_me;      -- always under the broker creating them
    NEW.parent_id       := v_me;
    NEW.rank            := v_base_rank;
    NEW.rank_locked     := false;
    NEW.auth_user_id    := NULL;      -- no login
    NEW.password_hash   := NULL;
    NEW.kyc_status      := 'pending';
    NEW.kyc_reviewed_at := NULL;
    NEW.kyc_reviewed_by := NULL;
    NEW.tds_applicable  := COALESCE(NEW.tds_applicable, false);
    RETURN NEW;
  END IF;

  -- UPDATE on their own row: contact and bank details are theirs to fix; every column
  -- that decides money or identity snaps back to what it was.
  NEW.broker_id       := OLD.broker_id;
  NEW.auth_user_id    := OLD.auth_user_id;
  NEW.rank            := OLD.rank;
  NEW.rank_locked     := OLD.rank_locked;
  NEW.status          := OLD.status;
  NEW.kyc_reviewed_at := OLD.kyc_reviewed_at;
  NEW.kyc_reviewed_by := OLD.kyc_reviewed_by;
  NEW.tds_applicable  := OLD.tds_applicable;
  NEW.sponsor_id      := OLD.sponsor_id;
  NEW.parent_id       := OLD.parent_id;
  NEW.customer_id     := OLD.customer_id;
  NEW.broker_type     := OLD.broker_type;
  NEW.password_hash   := OLD.password_hash;

  -- One exception, because the portal depends on it: a broker whose KYC was REJECTED may
  -- put it back to 'pending' when they re-upload.  Nothing else about kyc_status moves —
  -- 'approved' is what unlocks withdrawals and only the office may set it.
  IF NOT (OLD.kyc_status = 'rejected' AND NEW.kyc_status = 'pending') THEN
    NEW.kyc_status := OLD.kyc_status;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_brokers_guard_non_staff ON public.brokers;
CREATE TRIGGER trg_brokers_guard_non_staff
BEFORE INSERT OR UPDATE ON public.brokers
FOR EACH ROW EXECUTE FUNCTION public.brokers_guard_non_staff();


-- ════════════════════════════════════════════════════════════════════════════
-- 6.  Customers, bookings, payments, commission → the office, or your own team
-- ════════════════════════════════════════════════════════════════════════════
-- These all read `USING (true)`: any broker could pull every customer's phone, PAN and
-- address, every payment in the company, and every other broker's commission.  Writes
-- were already staff-only (20261003); this is the read half.
DROP POLICY IF EXISTS bp_bookings_authenticated_select ON public.bp_bookings;
DROP POLICY IF EXISTS bp_bookings_select               ON public.bp_bookings;
CREATE POLICY bp_bookings_select ON public.bp_bookings
  FOR SELECT TO authenticated
  USING (public.is_staff() OR broker_id = ANY (public.my_broker_subtree()));

DROP POLICY IF EXISTS bp_customers_authenticated_select ON public.bp_customers;
DROP POLICY IF EXISTS bp_customers_select               ON public.bp_customers;
CREATE POLICY bp_customers_select ON public.bp_customers
  FOR SELECT TO authenticated
  USING (
    public.is_staff()
    OR EXISTS (
      SELECT 1 FROM public.bp_bookings bk
       WHERE bk.customer_id = bp_customers.id
         AND bk.broker_id = ANY (public.my_broker_subtree())
    )
  );

DROP POLICY IF EXISTS bp_payments_authenticated_select ON public.bp_payments;
DROP POLICY IF EXISTS bp_payments_select               ON public.bp_payments;
CREATE POLICY bp_payments_select ON public.bp_payments
  FOR SELECT TO authenticated
  USING (
    public.is_staff()
    OR EXISTS (
      SELECT 1 FROM public.bp_bookings bk
       WHERE bk.id = bp_payments.booking_id
         AND bk.broker_id = ANY (public.my_broker_subtree())
    )
  );

DROP POLICY IF EXISTS payout_distributions_read   ON public.payout_distributions;
DROP POLICY IF EXISTS payout_distributions_select ON public.payout_distributions;
CREATE POLICY payout_distributions_select ON public.payout_distributions
  FOR SELECT TO authenticated
  USING (public.is_staff() OR beneficiary_broker_id = ANY (public.my_broker_subtree()));

DROP POLICY IF EXISTS bp_payout_transactions_authenticated_select ON public.bp_payout_transactions;
DROP POLICY IF EXISTS bp_payout_transactions_select               ON public.bp_payout_transactions;
CREATE POLICY bp_payout_transactions_select ON public.bp_payout_transactions
  FOR SELECT TO authenticated
  USING (public.is_staff() OR broker_id = ANY (public.my_broker_subtree()));

-- Spend is the office's book.  A broker sees only the advances booked against them,
-- which the portal subtracts from what they can withdraw.
DROP POLICY IF EXISTS expenses_read   ON public.expenses;
DROP POLICY IF EXISTS expenses_select ON public.expenses;
CREATE POLICY expenses_select ON public.expenses
  FOR SELECT TO authenticated
  USING (public.is_staff() OR broker_id = ANY (public.my_broker_ids()));

-- EMI rows follow the booking they belong to.
DROP POLICY IF EXISTS emi_schedules_read   ON public.emi_schedules;
DROP POLICY IF EXISTS emi_schedules_select ON public.emi_schedules;
CREATE POLICY emi_schedules_select ON public.emi_schedules
  FOR SELECT TO authenticated
  USING (
    public.is_staff()
    OR EXISTS (
      SELECT 1 FROM public.bp_bookings bk
       WHERE bk.id = emi_schedules.booking_id
         AND bk.broker_id = ANY (public.my_broker_subtree())
    )
  );

DROP POLICY IF EXISTS emi_installments_read   ON public.emi_installments;
DROP POLICY IF EXISTS emi_installments_select ON public.emi_installments;
CREATE POLICY emi_installments_select ON public.emi_installments
  FOR SELECT TO authenticated
  USING (
    public.is_staff()
    OR EXISTS (
      SELECT 1 FROM public.emi_schedules s
       JOIN public.bp_bookings bk ON bk.id = s.booking_id
       WHERE s.id = emi_installments.schedule_id
         AND bk.broker_id = ANY (public.my_broker_subtree())
    )
  );

-- Cheques and the booking-broker split sit inside a booking; same rule, and the office
-- is the only one that writes them (already true).
DROP POLICY IF EXISTS p_select            ON public.bp_pdc_cheques;
DROP POLICY IF EXISTS bp_pdc_cheques_select ON public.bp_pdc_cheques;
CREATE POLICY bp_pdc_cheques_select ON public.bp_pdc_cheques
  FOR SELECT TO authenticated
  USING (
    public.is_staff()
    OR EXISTS (
      SELECT 1 FROM public.bp_bookings bk
       WHERE bk.id = bp_pdc_cheques.booking_id
         AND bk.broker_id = ANY (public.my_broker_subtree())
    )
  );


-- ════════════════════════════════════════════════════════════════════════════
-- 7.  Functions that move money check who is calling
-- ════════════════════════════════════════════════════════════════════════════
-- These are SECURITY DEFINER, so EXECUTE is the only gate — and `authenticated` needs it,
-- because that is the role the office signs in as too.  The check therefore has to be
-- inside the function.  Revoking instead would lock out the staff pages that call them
-- (PdcCheques.tsx, Bookings.tsx).

-- Creates a VERIFIED payment, which credits commission down the whole upline.
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

-- Same gate on the other side of the cheque.
CREATE OR REPLACE FUNCTION public.pdc_bounce_cheque(p_cheque_id uuid, p_reason text DEFAULT NULL::text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.is_staff() THEN
    RAISE EXCEPTION 'Only office staff can bounce a cheque.';
  END IF;
  UPDATE public.bp_pdc_cheques
     SET status = 'bounced', bounce_reason = p_reason, cleared_on = NULL
   WHERE id = p_cheque_id;
END;
$function$;

-- Rebuilds every unpaid commission row in the company.  Nothing in the app calls it (the
-- app recomputes one booking at a time), and the review found it rebuilds wrongly.  A
-- function that only exists to be called by mistake is deleted, not guarded.
DROP FUNCTION IF EXISTS public.recompute_all_payouts();


-- ════════════════════════════════════════════════════════════════════════════
-- 8.  Cancelled bookings earn nothing
-- ════════════════════════════════════════════════════════════════════════════
-- recompute_booking_payouts() clears a booking's unpaid commission rows and rebuilds them
-- from its verified payments — with no test for whether the booking is still alive.  So a
-- cancelled booking's commission came back the next time anything touched it.
--
-- The only change is the stage lookup and the early return below the DELETE.  Every line
-- of the rate, differential, TDS and admin arithmetic is byte-for-byte what is live now.
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
  -- Staff-only, same reasoning as the cheque functions: this is SECURITY DEFINER and
  -- `authenticated` must keep EXECUTE for the office, so the check belongs inside.  A NULL
  -- auth.uid() is the service role, a migration or a trigger fired by one, and passes.
  IF auth.uid() IS NOT NULL AND NOT public.is_staff() THEN
    RAISE EXCEPTION 'Only office staff can recompute commission.';
  END IF;

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

  -- A cancelled sale earns nobody anything.  Rows already paid out in a cycle keep their
  -- cycle_id and are left alone above — recovering those is an office decision, not a
  -- silent one.
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

    -- Look up direct broker's pct AND broker_type up front -- the type stamps the
    -- whole cascade and is what we compare each upline step against.
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


-- ════════════════════════════════════════════════════════════════════════════
-- 9.  Commission that has been paid is final
-- ════════════════════════════════════════════════════════════════════════════
-- A payout_distributions row with a cycle_id is money that has left the company.  It was
-- still possible to wipe it — by deleting the payment, booking or broker it hangs off
-- (the foreign keys cascade), or by clearing cycle_id and "reopening" the cycle, after
-- which the same commission could be paid a second time.
--
-- This is the trigger that says no.  It fires regardless of who is calling, staff
-- included: there is no screen in the app whose job is to erase a paid receipt.
CREATE OR REPLACE FUNCTION public.guard_paid_commission()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.cycle_id IS NOT NULL THEN
      RAISE EXCEPTION
        'This commission was already paid out in a payout cycle. It cannot be deleted.';
    END IF;
    RETURN OLD;
  END IF;

  -- UPDATE: a paid row is frozen except for its own bookkeeping fields.
  IF OLD.cycle_id IS NOT NULL THEN
    IF NEW.cycle_id IS DISTINCT FROM OLD.cycle_id THEN
      RAISE EXCEPTION
        'This commission is locked to payout cycle %. Unlocking it would let the same money be paid twice.',
        OLD.cycle_id;
    END IF;
    IF NEW.net_payout   IS DISTINCT FROM OLD.net_payout
    OR NEW.gross_payout IS DISTINCT FROM OLD.gross_payout
    OR NEW.beneficiary_broker_id IS DISTINCT FROM OLD.beneficiary_broker_id
    OR NEW.payment_id   IS DISTINCT FROM OLD.payment_id
    OR NEW.booking_id   IS DISTINCT FROM OLD.booking_id THEN
      RAISE EXCEPTION
        'This commission was already paid out. Its amount and who it belongs to cannot be changed.';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_paid_commission ON public.payout_distributions;
CREATE TRIGGER trg_guard_paid_commission
BEFORE UPDATE OR DELETE ON public.payout_distributions
FOR EACH ROW EXECUTE FUNCTION public.guard_paid_commission();


-- ════════════════════════════════════════════════════════════════════════════
-- 10.  A withdrawal can never exceed the wallet
-- ════════════════════════════════════════════════════════════════════════════
-- Both screens checked this in the browser only, and the broker portal built its figure
-- from the last 20 withdrawals — so past the 20th, money already paid dropped out of the
-- sum and "Available" went UP.  The wallet is recomputed here, in full, on every insert.
--
-- earned  = commission credited to the broker
-- paid    = withdrawals paid/closed + payout-cycle transactions paid
-- pending = withdrawals and cycle transactions still in flight
-- advance = cash already handed over as an Advance expense
-- Mirrors src/lib/payoutEngine.ts loadBrokerWallets exactly; the two must not disagree.
CREATE OR REPLACE FUNCTION public.guard_withdrawal_within_wallet()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_earned  numeric := 0;
  v_paid    numeric := 0;
  v_pending numeric := 0;
  v_advance numeric := 0;
  v_avail   numeric := 0;
  v_want    numeric := 0;
BEGIN
  v_want := COALESCE(NEW.net_amount, NEW.amount, 0);
  IF v_want <= 0 THEN
    RAISE EXCEPTION 'A withdrawal must be for more than zero.';
  END IF;

  SELECT COALESCE(sum(net_payout), 0) INTO v_earned
    FROM public.payout_distributions WHERE beneficiary_broker_id = NEW.broker_id;

  SELECT COALESCE(sum(COALESCE(net_amount, amount, 0)), 0) INTO v_paid
    FROM public.withdrawal_requests
   WHERE broker_id = NEW.broker_id AND status IN ('paid', 'closed')
     AND (TG_OP = 'INSERT' OR id <> NEW.id);

  SELECT v_paid + COALESCE(sum(COALESCE(net_amount, amount, 0)), 0) INTO v_paid
    FROM public.bp_payout_transactions
   WHERE broker_id = NEW.broker_id AND status = 'paid';

  SELECT COALESCE(sum(COALESCE(net_amount, amount, 0)), 0) INTO v_pending
    FROM public.withdrawal_requests
   WHERE broker_id = NEW.broker_id AND status IN ('pending', 'approved')
     AND (TG_OP = 'INSERT' OR id <> NEW.id);

  SELECT v_pending + COALESCE(sum(COALESCE(net_amount, amount, 0)), 0) INTO v_pending
    FROM public.bp_payout_transactions
   WHERE broker_id = NEW.broker_id AND status IN ('pending', 'approved');

  SELECT COALESCE(sum(e.amount), 0) INTO v_advance
    FROM public.expenses e
    LEFT JOIN public.expense_heads h ON h.id = e.head_id
   WHERE e.broker_id = NEW.broker_id
     AND lower(trim(COALESCE(h.name, ''))) = 'advance';

  v_avail := v_earned - v_paid - v_pending - v_advance;

  IF v_want > v_avail THEN
    RAISE EXCEPTION
      'Withdrawal of % is more than this broker can take out (available %). Earned %, already paid %, in flight %, advances %.',
      round(v_want, 2), round(v_avail, 2), round(v_earned, 2), round(v_paid, 2),
      round(v_pending, 2), round(v_advance, 2);
  END IF;
  RETURN NEW;
END;
$$;

-- INSERT only, and on an UPDATE that raises the amount.  Marking an existing request paid
-- must never be blocked by its own pending amount — that money is already committed.
DROP TRIGGER IF EXISTS trg_guard_withdrawal_within_wallet ON public.withdrawal_requests;
CREATE TRIGGER trg_guard_withdrawal_within_wallet
BEFORE INSERT ON public.withdrawal_requests
FOR EACH ROW EXECUTE FUNCTION public.guard_withdrawal_within_wallet();

DROP TRIGGER IF EXISTS trg_guard_withdrawal_raise ON public.withdrawal_requests;
CREATE TRIGGER trg_guard_withdrawal_raise
BEFORE UPDATE ON public.withdrawal_requests
FOR EACH ROW
WHEN (COALESCE(NEW.net_amount, NEW.amount, 0) > COALESCE(OLD.net_amount, OLD.amount, 0))
EXECUTE FUNCTION public.guard_withdrawal_within_wallet();


-- ════════════════════════════════════════════════════════════════════════════
-- 11.  One plot, one live booking
-- ════════════════════════════════════════════════════════════════════════════
-- Nothing stopped the same plot being sold to two customers, and because bookings have
-- been able to hold several plots since 20260806 while sync_plot_status() only ever looked
-- at the single bp_bookings.plot_id, multi-plot sales never marked their plots as taken —
-- so they stayed on the "available" list for the next customer.
CREATE OR REPLACE FUNCTION public.plot_ids_of_booking(p_booking uuid)
RETURNS uuid[]
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $$
  SELECT COALESCE(array_agg(DISTINCT pid) FILTER (WHERE pid IS NOT NULL), ARRAY[]::uuid[])
  FROM (
    SELECT plot_id AS pid FROM public.bp_bookings     WHERE id = p_booking
    UNION
    SELECT plot_id AS pid FROM public.bp_booking_plots WHERE booking_id = p_booking
  ) s;
$$;

CREATE OR REPLACE FUNCTION public.guard_plot_not_double_sold()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE
  v_booking uuid;
  v_plots   uuid[];
  v_clash   record;
BEGIN
  -- One function, two tables, so each NEW.<column> is read in its own branch: plpgsql
  -- resolves a record field when the statement runs, and bp_bookings has no booking_id.
  IF TG_TABLE_NAME = 'bp_bookings' THEN
    v_booking := NEW.id;
  ELSE
    v_booking := NEW.booking_id;
  END IF;

  -- A dead booking releases its plots, so it can never clash with anything.
  IF EXISTS (SELECT 1 FROM public.bp_bookings WHERE id = v_booking AND stage = 'cancelled') THEN
    RETURN NEW;
  END IF;

  -- Everything the booking already holds, plus the plot this statement is adding (on an
  -- INSERT the new link row is not visible to plot_ids_of_booking yet).
  v_plots := public.plot_ids_of_booking(v_booking);
  IF NEW.plot_id IS NOT NULL THEN
    v_plots := array_append(v_plots, NEW.plot_id);
  END IF;
  IF COALESCE(array_length(v_plots, 1), 0) = 0 THEN
    RETURN NEW;
  END IF;

  SELECT bk.id, bk.booking_no, p.plot_no INTO v_clash
    FROM public.bp_bookings bk
    JOIN public.bp_plots p ON p.id = ANY (public.plot_ids_of_booking(bk.id))
   WHERE bk.id <> v_booking
     AND bk.stage <> 'cancelled'
     AND p.id = ANY (v_plots)
   LIMIT 1;

  IF FOUND THEN
    RAISE EXCEPTION
      'Plot % is already sold on booking %. Cancel that booking first, or pick another plot.',
      v_clash.plot_no, v_clash.booking_no;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_plot_double_sold_booking ON public.bp_bookings;
CREATE TRIGGER trg_guard_plot_double_sold_booking
AFTER INSERT OR UPDATE OF plot_id, stage ON public.bp_bookings
FOR EACH ROW EXECUTE FUNCTION public.guard_plot_not_double_sold();

DROP TRIGGER IF EXISTS trg_guard_plot_double_sold_link ON public.bp_booking_plots;
CREATE TRIGGER trg_guard_plot_double_sold_link
AFTER INSERT OR UPDATE OF plot_id ON public.bp_booking_plots
FOR EACH ROW EXECUTE FUNCTION public.guard_plot_not_double_sold();

-- Plot status now follows every plot on the booking, not just the first one.
CREATE OR REPLACE FUNCTION public.sync_plot_status()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  v_status text;
  v_plots  uuid[];
BEGIN
  v_status := CASE NEW.stage
    WHEN 'token'         THEN 'token'
    WHEN 'booking'       THEN 'booked'
    WHEN 'full_payment'  THEN 'booked'
    WHEN 'registry_done' THEN 'registry_done'
    WHEN 'cancelled'     THEN 'available'
    ELSE NULL
  END;
  IF v_status IS NULL THEN
    RETURN NEW;
  END IF;

  v_plots := public.plot_ids_of_booking(NEW.id);
  IF COALESCE(array_length(v_plots, 1), 0) = 0 THEN
    RETURN NEW;
  END IF;

  UPDATE public.bp_plots
     SET status = v_status, updated_at = now()
   WHERE id = ANY (v_plots);
  RETURN NEW;
END;
$function$;


-- ════════════════════════════════════════════════════════════════════════════
-- 12.  KYC scans stop being world-readable
-- ════════════════════════════════════════════════════════════════════════════
-- The `documents` bucket is public: anyone who learns a URL — no login at all — can open
-- an Aadhaar or PAN scan.  Private from here; the app reads them through short-lived
-- signed URLs instead (see src/lib/storage.ts).
--
-- `project-images` stays public on purpose: those are marketing images for the site.
-- `hr-documents` belongs to the call-centre CRM and is deliberately left alone.
-- `storage.objects` and `storage.buckets` are owned by `supabase_storage_admin`, and the
-- SQL editor runs as `postgres`, which is not a member of that role.  CREATE POLICY needs
-- ownership, not just privileges — so these statements raise insufficient_privilege, and
-- because this file is one transaction, they would roll back the ENTIRE migration.  (That
-- is exactly what happened on the first run: nothing applied.)
--
-- So the storage half runs inside its own guarded block.  If it is allowed, it applies; if
-- not, it says so and the other eleven sections still commit.  Turning the bucket private
-- is the part that actually matters — a private bucket stops serving /object/public/ at
-- all, whatever the policies say.
-- Its own block, so that making the bucket private sticks even if the policy half below
-- is refused.  An EXCEPTION handler rolls back everything done inside ITS block, so these
-- two must not share one.
DO $$
BEGIN
  UPDATE storage.buckets SET public = false WHERE id = 'documents';
  RAISE NOTICE 'Storage: documents bucket is now private.';
EXCEPTION
  WHEN insufficient_privilege THEN
    RAISE NOTICE 'Storage: could NOT make the documents bucket private. Do it in Dashboard > Storage > documents > Settings.';
END $$;

DO $$
BEGIN
  EXECUTE $q$DROP POLICY IF EXISTS "Public can view documents"                ON storage.objects$q$;
  EXECUTE $q$DROP POLICY IF EXISTS "Authenticated users can update documents" ON storage.objects$q$;
  EXECUTE $q$DROP POLICY IF EXISTS "Authenticated users can delete documents" ON storage.objects$q$;
  EXECUTE $q$DROP POLICY IF EXISTS "Authenticated users can upload documents" ON storage.objects$q$;
  EXECUTE $q$DROP POLICY IF EXISTS documents_staff_all   ON storage.objects$q$;
  EXECUTE $q$DROP POLICY IF EXISTS documents_broker_read ON storage.objects$q$;
  EXECUTE $q$DROP POLICY IF EXISTS documents_broker_add  ON storage.objects$q$;

  EXECUTE $q$
    CREATE POLICY documents_staff_all ON storage.objects
      FOR ALL TO authenticated
      USING      (bucket_id = 'documents' AND public.is_staff())
      WITH CHECK (bucket_id = 'documents' AND public.is_staff())
  $q$;

  -- A broker reaches only their own folder: documents/kyc/<their broker id>/...
  EXECUTE $q$
    CREATE POLICY documents_broker_read ON storage.objects
      FOR SELECT TO authenticated
      USING (bucket_id = 'documents'
             AND (storage.foldername(name))[1] = 'kyc'
             AND (storage.foldername(name))[2] = ANY (public.my_broker_ids()::text[]))
  $q$;

  EXECUTE $q$
    CREATE POLICY documents_broker_add ON storage.objects
      FOR INSERT TO authenticated
      WITH CHECK (bucket_id = 'documents'
                  AND (storage.foldername(name))[1] = 'kyc'
                  AND (storage.foldername(name))[2] = ANY (public.my_broker_ids()::text[]))
  $q$;

  RAISE NOTICE 'Storage: documents policies are in place.';
EXCEPTION
  WHEN insufficient_privilege THEN
    RAISE NOTICE 'Storage policies NOT changed: this login does not own storage.objects. %',
      'Finish in Dashboard > Storage > documents > make Private, then Policies: delete the public read policy and add staff-only + kyc/<broker id> rules.';
END $$;

COMMIT;

-- ============================================================================
-- After running, check the holes are shut:
--
--   SELECT tablename, policyname, cmd FROM pg_policies
--    WHERE schemaname='public' AND cmd <> 'SELECT'
--      AND COALESCE(qual,'true')='true' AND COALESCE(with_check,'true')='true'
--      AND tablename NOT IN ('leads','calls','attendance','profiles','site_visits',
--                            'tasks','employee_leads','crm_leads','crm_lead_interactions',
--                            'tickets','ticket_messages','ticket_sections','bp_audit_log',
--                            'brokers','inquiries','customers','bookings','plots','projects',
--                            'booking_emi_installments','lead_assignment_logs','closure_audit',
--                            'promotion_materials','bp_customer_receipt_seq','hr_attendance',
--                            'hr_documents','hr_employee_meta','hr_employees','hr_holidays',
--                            'hr_leaves','hr_payroll','news_events','project_content',
--                            'project_documents');
--   -- expect: 0 rows
--
--   SELECT tgname FROM pg_trigger WHERE tgrelid='public.brokers'::regclass
--     AND tgname='trg_brokers_guard_non_staff';            -- expect: 1 row
--   SELECT public.is_staff();                               -- expect: true for an office login
--
--   SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
--    WHERE n.nspname='public' AND p.proname IN ('my_broker_subtree','my_broker_ids',
--      'guard_paid_commission','guard_withdrawal_within_wallet','plot_ids_of_booking',
--      'guard_plot_not_double_sold');                      -- expect: 6
--
--   SELECT id, public FROM storage.buckets WHERE id='documents';  -- expect: public = false
--   SELECT policyname FROM pg_policies
--    WHERE schemaname='storage' AND tablename='objects' AND policyname LIKE 'documents_%';
--   -- expect: 3 rows.  0 rows means the NOTICE fired and the storage half has to be
--   -- finished in Dashboard > Storage > documents > Policies (the SQL editor runs as
--   -- `postgres`, which does not own storage.objects).  Everything else still applied.
-- ============================================================================
