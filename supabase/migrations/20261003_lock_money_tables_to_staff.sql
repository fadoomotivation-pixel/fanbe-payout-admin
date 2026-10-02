-- CRITICAL: a broker login could pay itself.
--
-- Every broker signs in as the Postgres role `authenticated`, and these five tables each
-- had one policy — USING(true) / CHECK(true) for `authenticated` — so a broker, using the
-- anon key printed in the site's JS (the route guard and the UI run in the browser and stop
-- nobody), could go straight to the REST API and:
--
--   - insert a withdrawal_requests row with status='approved' and then pay themselves;
--   - edit payout_distributions.net_payout to inflate their own commission;
--   - change app_settings.payout_config (the TDS / admin % the whole payout runs on);
--   - update their own brokers row: rank, kyc_status='approved', tds_applicable;
--   - insert an app_users row for their own auth id and become staff.
--
-- Reproduced on live data as a broker's JWT: all five were ALLOWED.  Nothing was found to
-- have actually happened (commission rows, booking totals, receipts and EMIs all reconcile
-- — checked before this change), but the door was open.
--
-- The fix draws the line the app assumes but never enforced: STAFF (an active app_users
-- row) runs the business; a BROKER may read their own money and ask for a withdrawal, and
-- nothing more.  Staff behaviour is unchanged.

-- ── Who is staff ────────────────────────────────────────────────────
-- SECURITY DEFINER so it can read app_users regardless of the caller's own RLS.  STABLE so
-- the planner calls it once per statement, not once per row.
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

-- ── app_users: staff only ───────────────────────────────────────────
-- Closes self-promotion.  A broker can neither read the staff list nor add themselves to it.
DROP POLICY IF EXISTS auth_all ON public.app_users;
CREATE POLICY app_users_staff_all ON public.app_users
  FOR ALL TO authenticated USING (public.is_staff()) WITH CHECK (public.is_staff());

-- ── app_settings: everyone reads, only staff writes ─────────────────
-- The broker portal reads payout_config to show a broker their own net-of-TDS figure, so
-- read stays open to signed-in users; only staff may change the numbers the payout runs on.
DROP POLICY IF EXISTS auth_all ON public.app_settings;
CREATE POLICY app_settings_read  ON public.app_settings
  FOR SELECT TO authenticated USING (true);
CREATE POLICY app_settings_write ON public.app_settings
  FOR ALL TO authenticated USING (public.is_staff()) WITH CHECK (public.is_staff());

-- ── payout_distributions: read own, write staff only ────────────────
-- A broker sees the commission credited to them (the portal already filters to their id);
-- the rows themselves are written only by the SECURITY DEFINER recompute functions (owned
-- by the table owner, so RLS does not stand in their way) and by staff on the payout pages.
DROP POLICY IF EXISTS auth_all ON public.payout_distributions;
CREATE POLICY payout_distributions_read ON public.payout_distributions
  FOR SELECT TO authenticated USING (true);
CREATE POLICY payout_distributions_write ON public.payout_distributions
  FOR ALL TO authenticated USING (public.is_staff()) WITH CHECK (public.is_staff());

-- ── withdrawal_requests: broker may only ASK ────────────────────────
-- A broker can create a request for their own id, and it must start life as 'pending'.
-- Approving, marking paid, changing the amount or the net — every step that moves money —
-- is staff only.  A broker cannot read another broker's requests.
DROP POLICY IF EXISTS auth_all ON public.withdrawal_requests;
CREATE POLICY withdrawal_requests_staff_all ON public.withdrawal_requests
  FOR ALL TO authenticated USING (public.is_staff()) WITH CHECK (public.is_staff());
CREATE POLICY withdrawal_requests_broker_read ON public.withdrawal_requests
  FOR SELECT TO authenticated
  USING (broker_id IN (SELECT id FROM public.brokers WHERE auth_user_id = auth.uid()));
CREATE POLICY withdrawal_requests_broker_insert ON public.withdrawal_requests
  FOR INSERT TO authenticated
  WITH CHECK (
    status = 'pending'
    AND broker_id IN (SELECT id FROM public.brokers WHERE auth_user_id = auth.uid())
  );
-- Deliberately no broker UPDATE / DELETE policy: a request, once made, is the office's to act on.

-- ── brokers: staff do anything; a broker edits only safe fields of their own row ──
-- RLS keeps a broker to their own row.  A column guard keeps that edit to contact and bank
-- details — the fields that decide money (rank, KYC, status, sponsor, the auth link, …) can
-- only be moved by staff.  Column-level rules cannot be written in a policy, so a trigger
-- enforces them; it is the real lock, the policy just scopes the row.
DROP POLICY IF EXISTS brokers_authenticated_update ON public.brokers;
DROP POLICY IF EXISTS brokers_authenticated_delete ON public.brokers;
DROP POLICY IF EXISTS brokers_authenticated_insert ON public.brokers;

CREATE POLICY brokers_update ON public.brokers
  FOR UPDATE TO authenticated
  USING (public.is_staff() OR auth_user_id = auth.uid())
  WITH CHECK (public.is_staff() OR auth_user_id = auth.uid());
CREATE POLICY brokers_insert ON public.brokers
  FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY brokers_delete ON public.brokers
  FOR DELETE TO authenticated USING (public.is_staff());

CREATE OR REPLACE FUNCTION public.brokers_guard_non_staff()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- Staff and the service role write freely.  is_staff() covers a logged-in staff member;
  -- auth.uid() being NULL covers the SECURITY DEFINER recompute jobs and server scripts.
  IF auth.uid() IS NULL OR public.is_staff() THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    -- A broker may create a downline broker, but not hand it authority: no login link, KYC
    -- starts unproven, rank is not locked.  Rank/status are left as given (the client uses
    -- the base rank); everything that unlocks money is forced.
    NEW.auth_user_id   := NULL;
    NEW.kyc_status     := 'pending';
    NEW.kyc_reviewed_at := NULL;
    NEW.kyc_reviewed_by := NULL;
    NEW.rank_locked    := false;
    NEW.tds_applicable := COALESCE(NEW.tds_applicable, false);
    RETURN NEW;
  END IF;

  -- UPDATE by a broker on their own row: protected columns snap back to their old values.
  NEW.broker_id       := OLD.broker_id;
  NEW.auth_user_id    := OLD.auth_user_id;
  NEW.rank            := OLD.rank;
  NEW.rank_locked     := OLD.rank_locked;
  NEW.status          := OLD.status;
  NEW.kyc_status      := OLD.kyc_status;
  NEW.kyc_reviewed_at := OLD.kyc_reviewed_at;
  NEW.kyc_reviewed_by := OLD.kyc_reviewed_by;
  NEW.tds_applicable  := OLD.tds_applicable;
  NEW.sponsor_id      := OLD.sponsor_id;
  NEW.parent_id       := OLD.parent_id;
  NEW.customer_id     := OLD.customer_id;
  NEW.broker_type     := OLD.broker_type;
  NEW.password_hash   := OLD.password_hash;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_brokers_guard_non_staff ON public.brokers;
CREATE TRIGGER trg_brokers_guard_non_staff
BEFORE INSERT OR UPDATE ON public.brokers
FOR EACH ROW EXECUTE FUNCTION public.brokers_guard_non_staff();
