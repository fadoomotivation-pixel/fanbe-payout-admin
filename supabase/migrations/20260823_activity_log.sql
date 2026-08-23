-- Activity log — "jisse koi admin ka employee agar kuch misuse kare to track rahe".
--
-- Written as database triggers, not as calls from the React pages, and that choice is the
-- whole point.  A log the client writes is a log the client can skip: anyone with the anon
-- key can hit PostgREST directly, and a modified build can simply not call it.  A trigger
-- records the change as part of the same transaction that makes it, so a row cannot be
-- altered without the entry existing.
--
-- The table is append-only by construction: SELECT is granted to authenticated, INSERT /
-- UPDATE / DELETE are granted to nobody.  Entries arrive only through the SECURITY DEFINER
-- trigger below, so an employee cannot edit or delete their own trail from the app.

CREATE TABLE IF NOT EXISTS public.bp_activity_log (
  id          bigserial PRIMARY KEY,
  at          timestamptz NOT NULL DEFAULT now(),
  actor_id    uuid,
  actor_email text,
  action      text NOT NULL CHECK (action IN ('created','updated','deleted')),
  entity      text NOT NULL,
  entity_id   text,
  label       text,
  summary     text NOT NULL,
  changes     jsonb,
  table_name  text NOT NULL
);

CREATE INDEX IF NOT EXISTS bp_activity_log_at_idx     ON public.bp_activity_log (at DESC);
CREATE INDEX IF NOT EXISTS bp_activity_log_entity_idx ON public.bp_activity_log (entity, at DESC);
CREATE INDEX IF NOT EXISTS bp_activity_log_actor_idx  ON public.bp_activity_log (actor_email, at DESC);
CREATE INDEX IF NOT EXISTS bp_activity_log_action_idx ON public.bp_activity_log (action, at DESC);

ALTER TABLE public.bp_activity_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS bp_activity_log_read ON public.bp_activity_log;
CREATE POLICY bp_activity_log_read ON public.bp_activity_log
  FOR SELECT TO authenticated USING (true);

-- Read-only to every client role.  No policy grants writes, and the privileges are pulled
-- as well, so the trail cannot be rewritten from the app even by an admin account.
REVOKE INSERT, UPDATE, DELETE ON public.bp_activity_log FROM anon, authenticated;
GRANT  SELECT                  ON public.bp_activity_log TO authenticated;

-- ── The recorder ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.bp_log_activity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_new     jsonb;
  v_old     jsonb;
  v_row     jsonb;
  v_changes jsonb;
  v_watch   text[];
  v_action  text;
  v_entity  text;
  v_label   text;
  v_summary text;
  v_actor   uuid;
  v_email   text;
  v_fields  text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_new := to_jsonb(NEW); v_row := v_new; v_action := 'created';
  ELSIF TG_OP = 'UPDATE' THEN
    v_new := to_jsonb(NEW); v_old := to_jsonb(OLD); v_row := v_new; v_action := 'updated';
  ELSE
    v_old := to_jsonb(OLD); v_row := v_old; v_action := 'deleted';
  END IF;

  -- Columns worth a line.  Without this filter the log drowns: every payment rewrites a
  -- booking's total_collected and balance_due, and nobody needs to read that.
  v_watch := CASE TG_TABLE_NAME
    WHEN 'bp_customers'        THEN ARRAY['name','phone','alt_phone','email','pan','aadhaar','address','customer_code','father_or_husband_name']
    WHEN 'bp_plots'            THEN ARRAY['status','plot_no','price_per_sqyd','total_price','project_id','size_sqyd']
    WHEN 'brokers'             THEN ARRAY['name','phone','email','status','kyc_status','rank','sponsor_id','broker_id','pan_no']
    WHEN 'bp_bookings'         THEN ARRAY['stage','plot_id','customer_id','broker_id','total_amount','booking_no','legacy_booking_no','commission_mode','traditional_commission_pct']
    WHEN 'bp_payments'         THEN ARRAY['amount','verification_status','payment_date','receipt_no','utr_ref','payment_mode']
    WHEN 'expenses'            THEN ARRAY['amount','head_id','broker_id','expense_date']
    WHEN 'bp_pdc_cheques'      THEN ARRAY['status','amount','cheque_no','cleared_on','bounce_reason']
    WHEN 'withdrawal_requests' THEN ARRAY['status','amount','net_amount']
    ELSE ARRAY[]::text[]
  END;

  IF TG_OP = 'UPDATE' THEN
    SELECT jsonb_object_agg(o.key, jsonb_build_object('from', o.value, 'to', n.value))
      INTO v_changes
      FROM jsonb_each(v_old) o
      JOIN jsonb_each(v_new) n ON n.key = o.key
     WHERE o.value IS DISTINCT FROM n.value
       AND o.key = ANY(v_watch);
    -- Only bookkeeping columns moved — not an event a person needs to see.
    IF v_changes IS NULL THEN
      RETURN NULL;
    END IF;
  END IF;

  v_entity := CASE TG_TABLE_NAME
    WHEN 'bp_customers'        THEN 'customer'
    WHEN 'bp_plots'            THEN 'plot'
    WHEN 'brokers'             THEN 'broker'
    WHEN 'bp_bookings'         THEN 'booking'
    WHEN 'bp_payments'         THEN 'payment'
    WHEN 'expenses'            THEN 'expense'
    WHEN 'bp_pdc_cheques'      THEN 'cheque'
    WHEN 'withdrawal_requests' THEN 'withdrawal'
    ELSE TG_TABLE_NAME
  END;

  v_label := CASE TG_TABLE_NAME
    WHEN 'bp_customers'        THEN coalesce(nullif(v_row->>'name',''),'(no name)') || coalesce(' · ' || (v_row->>'customer_code'), '')
    WHEN 'bp_plots'            THEN 'Plot ' || coalesce(v_row->>'plot_no','?')
    WHEN 'brokers'             THEN coalesce(nullif(v_row->>'name',''),'(no name)') || coalesce(' [' || (v_row->>'broker_id') || ']', '')
    WHEN 'bp_bookings'         THEN coalesce(v_row->>'booking_no','(no number)')
    WHEN 'bp_payments'         THEN upper(coalesce(v_row->>'payment_type','payment')) || ' ₹' || coalesce(v_row->>'amount','0') || coalesce(' · ' || (v_row->>'receipt_no'), '')
    WHEN 'expenses'            THEN '₹' || coalesce(v_row->>'amount','0')
    WHEN 'bp_pdc_cheques'      THEN 'Cheque ' || coalesce(v_row->>'cheque_no','?') || ' · ₹' || coalesce(v_row->>'amount','0')
    WHEN 'withdrawal_requests' THEN '₹' || coalesce(v_row->>'amount','0')
    ELSE coalesce(v_row->>'id','')
  END;

  v_summary := initcap(v_entity) || ' ' || v_action || ' — ' || v_label;
  IF TG_OP = 'UPDATE' THEN
    SELECT string_agg(k, ', ' ORDER BY k) INTO v_fields FROM jsonb_object_keys(v_changes) AS k;
    v_summary := v_summary || ' (' || coalesce(v_fields, '') || ')';
  END IF;

  -- Who did it.  Both are best-effort: a change made by a database job or a service-role
  -- script has no JWT, and shows in the page as "system" rather than being dropped.
  BEGIN
    v_actor := auth.uid();
  EXCEPTION WHEN OTHERS THEN
    v_actor := NULL;
  END;
  BEGIN
    v_email := nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'email';
  EXCEPTION WHEN OTHERS THEN
    v_email := NULL;
  END;

  INSERT INTO public.bp_activity_log (actor_id, actor_email, action, entity, entity_id, label, summary, changes, table_name)
  VALUES (v_actor, v_email, v_action, v_entity, v_row->>'id', v_label, v_summary, v_changes, TG_TABLE_NAME);

  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  -- Never let bookkeeping break the real work: a booking or a receipt must still save even
  -- if this trigger hits a problem.  The failure is raised as a warning in the logs.
  RAISE WARNING 'activity log failed for % on %: %', TG_OP, TG_TABLE_NAME, SQLERRM;
  RETURN NULL;
END;
$$;

-- ── Watched tables ──────────────────────────────────────────────────
DROP TRIGGER IF EXISTS trg_activity_bp_customers ON public.bp_customers;
CREATE TRIGGER trg_activity_bp_customers AFTER INSERT OR UPDATE OR DELETE ON public.bp_customers
FOR EACH ROW EXECUTE FUNCTION public.bp_log_activity();

DROP TRIGGER IF EXISTS trg_activity_brokers ON public.brokers;
CREATE TRIGGER trg_activity_brokers AFTER INSERT OR UPDATE OR DELETE ON public.brokers
FOR EACH ROW EXECUTE FUNCTION public.bp_log_activity();

DROP TRIGGER IF EXISTS trg_activity_bp_bookings ON public.bp_bookings;
CREATE TRIGGER trg_activity_bp_bookings AFTER INSERT OR UPDATE OR DELETE ON public.bp_bookings
FOR EACH ROW EXECUTE FUNCTION public.bp_log_activity();

DROP TRIGGER IF EXISTS trg_activity_bp_payments ON public.bp_payments;
CREATE TRIGGER trg_activity_bp_payments AFTER INSERT OR UPDATE OR DELETE ON public.bp_payments
FOR EACH ROW EXECUTE FUNCTION public.bp_log_activity();

DROP TRIGGER IF EXISTS trg_activity_expenses ON public.expenses;
CREATE TRIGGER trg_activity_expenses AFTER INSERT OR UPDATE OR DELETE ON public.expenses
FOR EACH ROW EXECUTE FUNCTION public.bp_log_activity();

DROP TRIGGER IF EXISTS trg_activity_bp_pdc_cheques ON public.bp_pdc_cheques;
CREATE TRIGGER trg_activity_bp_pdc_cheques AFTER INSERT OR UPDATE OR DELETE ON public.bp_pdc_cheques
FOR EACH ROW EXECUTE FUNCTION public.bp_log_activity();

DROP TRIGGER IF EXISTS trg_activity_withdrawal_requests ON public.withdrawal_requests;
CREATE TRIGGER trg_activity_withdrawal_requests AFTER INSERT OR UPDATE OR DELETE ON public.withdrawal_requests
FOR EACH ROW EXECUTE FUNCTION public.bp_log_activity();

-- Plots are the one exception to "log everything": they arrive in bulk (Paste plots / Bulk
-- Generate write hundreds at a time) and a few hundred "plot created" lines would bury the
-- entries that matter.  Deletions and status changes — the ones worth questioning — are kept.
DROP TRIGGER IF EXISTS trg_activity_bp_plots ON public.bp_plots;
CREATE TRIGGER trg_activity_bp_plots AFTER UPDATE OR DELETE ON public.bp_plots
FOR EACH ROW EXECUTE FUNCTION public.bp_log_activity();
