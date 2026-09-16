-- CRITICAL: the whole database was readable AND writable without logging in.
--
-- Reported as "kisi ko admin.fanbegroup.com diya, use admin access khul gaya bina login
-- id password ke".  The login page and the route guard were never the problem — they work.
-- The problem is that they were the ONLY thing in the way, and they run in the browser,
-- where they protect nothing.
--
-- Supabase apps talk to PostgREST directly with the anon key, and that key is printed in
-- the public JavaScript bundle of the site — anyone can read it with View Source.  What
-- actually decides who may read a row is row-level security.  Ours said "true".
--
-- Measured on live data as the `anon` role (i.e. no login at all, straight from the
-- public key):
--
--     bp_customers    836 rows readable   -- names, phones, PAN, Aadhaar, addresses
--     bp_bookings     862 rows readable
--     brokers          66 rows readable
--     profiles         21 rows readable   -- staff logins, roles, permissions
--
-- and writes, tested in a rolled-back transaction:
--
--     bp_customers UPDATE = ALLOWED
--     bp_bookings  DELETE = ALLOWED
--     brokers      UPDATE = ALLOWED
--
-- So the whole customer book could be downloaded, and every booking deleted, by anyone
-- who had ever been sent the link.  Three tables had RLS switched off entirely.
--
-- The cause is a set of policies written as `USING (true)` and attached to PUBLIC — which
-- in Postgres means every role, `anon` included.  Several are even named `admin_all_*` or
-- "Service role full access", so they read like they were restricted to admins.  They were
-- not restricted to anything.  (service_role bypasses RLS in Supabase anyway, so those
-- policies were never doing the job their name claims.)

-- ── 1. No anonymous writes.  Anywhere. ──────────────────────────────
-- Belt as well as braces: even if a permissive policy is ever added again by mistake, the
-- table privilege is gone, so an anonymous write cannot land.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON ALL TABLES IN SCHEMA public FROM anon;

-- And for tables created from here on, so this cannot quietly come back.
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLES FROM anon;

-- ── 2. Drop the permissive PUBLIC / anon policies ───────────────────
-- Every one of these was `USING (true)`.  Each table keeps its existing
-- *_authenticated_* policies, so a signed-in member of staff sees no change at all.

-- This app's money and customer data
DROP POLICY IF EXISTS admin_all_bp_bookings           ON public.bp_bookings;
DROP POLICY IF EXISTS admin_all_bp_customers          ON public.bp_customers;
DROP POLICY IF EXISTS admin_all_bp_payments           ON public.bp_payments;
DROP POLICY IF EXISTS admin_all_bp_payouts            ON public.bp_payout_transactions;
DROP POLICY IF EXISTS admin_all_bp_plots              ON public.bp_plots;
DROP POLICY IF EXISTS admin_all_bp_projects           ON public.bp_projects;
DROP POLICY IF EXISTS admin_all_bp_broker_bank        ON public.bp_broker_bank;
DROP POLICY IF EXISTS admin_all_bp_broker_kyc         ON public.bp_broker_kyc;
DROP POLICY IF EXISTS admin_all_bp_customer_ledger    ON public.bp_customer_ledger;
DROP POLICY IF EXISTS admin_all_bp_commission_rules   ON public.bp_commission_rules;
DROP POLICY IF EXISTS admin_all_bp_notifications      ON public.bp_notifications;
DROP POLICY IF EXISTS admin_all_bp_plot_hold_log      ON public.bp_plot_hold_log;
DROP POLICY IF EXISTS admin_all_bp_settings           ON public.bp_settings;
DROP POLICY IF EXISTS admin_all_bp_audit_log          ON public.bp_audit_log;

-- The broker directory was readable, insertable AND updatable by the public.
DROP POLICY IF EXISTS brokers_public_select           ON public.brokers;
DROP POLICY IF EXISTS brokers_public_insert           ON public.brokers;
DROP POLICY IF EXISTS brokers_public_update           ON public.brokers;
DROP POLICY IF EXISTS payouts_anon_all                ON public.broker_payouts;
DROP POLICY IF EXISTS sales_anon_all                  ON public.broker_sales;
DROP POLICY IF EXISTS rank_rules_read_all             ON public.broker_rank_rules;
DROP POLICY IF EXISTS broker_terms_select             ON public.broker_terms;
DROP POLICY IF EXISTS broker_bonanza_direct_select    ON public.broker_bonanza_direct;
DROP POLICY IF EXISTS broker_bonanza_team_select      ON public.broker_bonanza_team;

-- The lead/CRM side of the same project, open in exactly the same way.
DROP POLICY IF EXISTS "Allow all access to bookings"    ON public.bookings;
DROP POLICY IF EXISTS "Allow all access to calls"       ON public.calls;
DROP POLICY IF EXISTS "Allow all access to leads"       ON public.leads;
DROP POLICY IF EXISTS "Allow all access to site_visits" ON public.site_visits;
DROP POLICY IF EXISTS "Allow all access to tasks"       ON public.tasks;

-- Named for the service role, attached to PUBLIC.  service_role bypasses RLS, so dropping
-- these takes nothing away from a server-side job — it only closes them to the public.
DROP POLICY IF EXISTS "Service role full access"                        ON public.hr_attendance;
DROP POLICY IF EXISTS "Service role full access"                        ON public.hr_documents;
DROP POLICY IF EXISTS "Service role full access"                        ON public.hr_employees;
DROP POLICY IF EXISTS "Service role full access"                        ON public.hr_holidays;
DROP POLICY IF EXISTS "Service role full access"                        ON public.hr_leaves;
DROP POLICY IF EXISTS "Service role full access"                        ON public.hr_payroll;
DROP POLICY IF EXISTS "Allow service role full access to employee_leads" ON public.employee_leads;

-- Staff profiles: roles, permissions and phone numbers were world-readable.
DROP POLICY IF EXISTS "Allow username to email lookup for login" ON public.profiles;
DROP POLICY IF EXISTS "Super admin can read all profiles"        ON public.profiles;

-- ── 3. Username -> email login, without handing over the staff list ─
-- The other app signs in by username, which needs one lookup before a session exists.
-- The policy stays, but the COLUMN privileges are cut down to the three fields that
-- lookup actually needs, so role, permissions, phone, department and metrics are no
-- longer reachable without signing in.
REVOKE SELECT ON public.profiles FROM anon;
GRANT  SELECT (id, username, email) ON public.profiles TO anon;

-- ── 4. Three tables had RLS switched off completely ─────────────────
ALTER TABLE public.payout_cycles     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.closure_audit     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.team_reward_tiers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS payout_cycles_authenticated ON public.payout_cycles;
CREATE POLICY payout_cycles_authenticated ON public.payout_cycles
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS team_reward_tiers_authenticated ON public.team_reward_tiers;
CREATE POLICY team_reward_tiers_authenticated ON public.team_reward_tiers
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- closure_audit is a trail of who closed a payout cycle.  Readable so the page can show
-- it; never editable from the app, the same rule bp_activity_log follows.
DROP POLICY IF EXISTS closure_audit_read ON public.closure_audit;
CREATE POLICY closure_audit_read ON public.closure_audit
  FOR SELECT TO authenticated USING (true);
REVOKE INSERT, UPDATE, DELETE ON public.closure_audit FROM authenticated;

-- ── 5. What stays public, deliberately ──────────────────────────────
-- project_content and project_documents keep their public READ policy: that is the
-- marketing site's project pages and brochures, meant to be seen without signing in.
-- They hold no personal data, and after step 1 the public can no longer write to them.
