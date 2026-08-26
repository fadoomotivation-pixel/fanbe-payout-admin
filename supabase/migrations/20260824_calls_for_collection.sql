-- The collection app records what a customer said when chased for an EMI.  That is the
-- same shape as the existing `calls` table — status, notes, objection, next follow-up —
-- which was only ever wired to sales leads (lead_id, lead_name, project_name).  Extending
-- it keeps ONE call history per person instead of a second table doing the same job in
-- parallel, which is how two screens end up disagreeing about when someone was last rung.
--
-- lead_id is already nullable (ON DELETE SET NULL), so a collection call simply carries a
-- booking instead of a lead.  Nothing about the existing 6,040 sales-call rows changes.
ALTER TABLE public.calls
  ADD COLUMN IF NOT EXISTS booking_id      uuid REFERENCES public.bp_bookings(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS customer_id     uuid REFERENCES public.bp_customers(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS promised_amount numeric,
  ADD COLUMN IF NOT EXISTS promised_date   date;

-- The caller's queue is "who do I ring today": overdue EMI, plus anyone who promised today.
CREATE INDEX IF NOT EXISTS calls_booking_idx  ON public.calls (booking_id, created_at DESC);
CREATE INDEX IF NOT EXISTS calls_customer_idx ON public.calls (customer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS calls_followup_idx ON public.calls (next_followup_date)
  WHERE next_followup_date IS NOT NULL;

-- Deliberately NOT added to bp_activity_log.  bp_log_activity has no field list for this
-- table, so it would record every call as a bare id, and a caller makes dozens a day —
-- burying the payment and booking entries the audit trail exists for.  The calls table is
-- itself the record of what was said.
