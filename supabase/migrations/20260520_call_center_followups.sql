-- ── Call Center: follow-up tracking + daily reminder cron + views ───

-- 1. pg_cron for scheduled reminders
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- 2. Follow-up status on calls
ALTER TABLE public.calls
  ADD COLUMN IF NOT EXISTS followup_status        text DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS followup_completed_at  timestamptz,
  ADD COLUMN IF NOT EXISTS followup_completed_by  uuid,
  ADD COLUMN IF NOT EXISTS reminder_sent_at       timestamptz;

DO $do$ BEGIN
  ALTER TABLE public.calls DROP CONSTRAINT IF EXISTS calls_followup_status_check;
  ALTER TABLE public.calls
    ADD CONSTRAINT calls_followup_status_check
    CHECK (followup_status IN ('pending','done','missed','rescheduled'));
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'calls_followup_status_check skipped: %', sqlerrm; END $do$;

CREATE INDEX IF NOT EXISTS idx_calls_followup_due
  ON public.calls(next_followup_date, followup_status)
  WHERE followup_status = 'pending' AND next_followup_date IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_calls_employee_date
  ON public.calls(employee_id, call_date DESC);

-- 3. Reminder generator
CREATE OR REPLACE FUNCTION public.notify_due_followups()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
AS $fn$
DECLARE
  inserted_count integer := 0;
  r record;
BEGIN
  FOR r IN
    SELECT c.id, c.employee_id, c.employee_name, c.lead_name, c.lead_id,
           c.next_followup_date, c.phone, c.notes
    FROM public.calls c
    WHERE c.followup_status = 'pending'
      AND c.next_followup_date IS NOT NULL
      AND c.next_followup_date <= CURRENT_DATE
      AND (c.reminder_sent_at IS NULL OR c.reminder_sent_at < now() - interval '18 hours')
  LOOP
    INSERT INTO public.bp_notifications (type, title, message, entity_type, entity_id, is_read, created_at)
    VALUES (
      'followup_due',
      CASE WHEN r.next_followup_date < CURRENT_DATE
           THEN '⏰ Overdue follow-up · ' || COALESCE(r.lead_name,'lead')
           ELSE '📞 Follow-up today · ' || COALESCE(r.lead_name,'lead')
      END,
      'Tele-caller ' || COALESCE(r.employee_name,'—')
        || ' · scheduled for ' || to_char(r.next_followup_date, 'DD Mon YYYY')
        || COALESCE(' · ' || r.phone, '')
        || COALESCE(' · ' || left(r.notes, 80), ''),
      'call', r.id, false, now()
    );
    UPDATE public.calls SET reminder_sent_at = now() WHERE id = r.id;
    inserted_count := inserted_count + 1;
  END LOOP;
  RETURN inserted_count;
END $fn$;

-- 4. Daily run at 09:00 IST (03:30 UTC)
DO $do$ BEGIN PERFORM cron.unschedule('call-center-followup-reminders'); EXCEPTION WHEN OTHERS THEN NULL; END $do$;
SELECT cron.schedule('call-center-followup-reminders', '30 3 * * *', $$ SELECT public.notify_due_followups(); $$);

-- 5. Views for fast queries

CREATE OR REPLACE VIEW public.v_ghost_leads AS
SELECT
  l.id, l.full_name, l.name, l.phone, l.source, l.status,
  l.assigned_to, l.assigned_to_name, l.assigned_at, l.last_contact_date,
  l.project, l.budget, l.interest_level,
  MAX(c.call_date)            AS last_call_date,
  count(c.id)                 AS total_calls,
  CURRENT_DATE - COALESCE(MAX(c.call_date), l.assigned_at::date, l.created_at::date) AS days_since_contact
FROM public.leads l
LEFT JOIN public.calls c ON c.lead_id = l.id
WHERE COALESCE(l.is_archived, false) = false AND l.assigned_to IS NOT NULL
GROUP BY l.id;

CREATE OR REPLACE VIEW public.v_tele_caller_scorecard AS
SELECT
  c.employee_id,
  MAX(c.employee_name)                                                 AS employee_name,
  count(*)                                                             AS calls_30d,
  count(*) FILTER (WHERE c.call_date = CURRENT_DATE)                   AS calls_today,
  COALESCE(SUM(c.duration), 0)                                         AS total_seconds_30d,
  COALESCE(SUM(c.duration) FILTER (WHERE c.call_date = CURRENT_DATE), 0) AS seconds_today,
  count(*) FILTER (WHERE c.status ILIKE 'connected')                   AS connected_30d,
  count(*) FILTER (WHERE c.status NOT ILIKE 'connected' OR c.status IS NULL) AS not_connected_30d,
  count(DISTINCT c.lead_id)                                            AS unique_leads_30d,
  count(*) FILTER (WHERE c.next_followup_date <= CURRENT_DATE
                    AND c.followup_status = 'pending')                 AS overdue_followups,
  count(*) FILTER (WHERE c.next_followup_date = CURRENT_DATE
                    AND c.followup_status = 'pending')                 AS today_followups
FROM public.calls c
WHERE c.call_date >= CURRENT_DATE - INTERVAL '30 days'
  AND c.employee_id IS NOT NULL
GROUP BY c.employee_id;
