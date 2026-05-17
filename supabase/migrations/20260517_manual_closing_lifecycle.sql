-- ─────────────────────────────────────────────────────────────────
--  Manual closing lifecycle: booking close → monthly cycle close → withdrawal close
--  with hard locks + reopen-with-reason and a unified closure_audit log.
-- ─────────────────────────────────────────────────────────────────

-- ── 1. Booking close / reopen ───────────────────────────────────
ALTER TABLE public.bp_bookings
  ADD COLUMN IF NOT EXISTS closed_at      timestamptz,
  ADD COLUMN IF NOT EXISTS closed_by      uuid,
  ADD COLUMN IF NOT EXISTS closure_notes  text,
  ADD COLUMN IF NOT EXISTS reopened_at    timestamptz,
  ADD COLUMN IF NOT EXISTS reopened_by    uuid,
  ADD COLUMN IF NOT EXISTS reopen_reason  text;

CREATE INDEX IF NOT EXISTS idx_bp_bookings_closed_at ON public.bp_bookings(closed_at);

-- ── 2. Withdrawal close / reopen ─────────────────────────────────
ALTER TABLE public.withdrawal_requests
  ADD COLUMN IF NOT EXISTS closed_at      timestamptz,
  ADD COLUMN IF NOT EXISTS closed_by      uuid,
  ADD COLUMN IF NOT EXISTS closure_notes  text,
  ADD COLUMN IF NOT EXISTS reopened_at    timestamptz,
  ADD COLUMN IF NOT EXISTS reopened_by    uuid,
  ADD COLUMN IF NOT EXISTS reopen_reason  text;

-- Loosen the original status check so we can accept 'closed' too.
DO $do$ BEGIN
  ALTER TABLE public.withdrawal_requests DROP CONSTRAINT IF EXISTS withdrawal_requests_status_check;
  ALTER TABLE public.withdrawal_requests
    ADD CONSTRAINT withdrawal_requests_status_check
    CHECK (status IN ('pending','approved','rejected','paid','closed'));
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'withdrawal status check skipped: %', sqlerrm; END $do$;

CREATE INDEX IF NOT EXISTS idx_withdrawal_requests_closed_at ON public.withdrawal_requests(closed_at);

-- ── 3. Payout cycle (monthly close) ──────────────────────────────
CREATE TABLE IF NOT EXISTS public.payout_cycles (
  id              uuid primary key default gen_random_uuid(),
  period_label    text not null,
  period_start    date not null,
  period_end      date not null,
  status          text not null default 'open' check (status in ('open','closed','settled','reopened')),

  -- Snapshotted totals frozen at the moment of close.
  total_bookings        integer       default 0,
  total_brokers         integer       default 0,
  total_gross           numeric(14,2) default 0,
  total_tds             numeric(14,2) default 0,
  total_admin           numeric(14,2) default 0,
  total_net             numeric(14,2) default 0,

  -- Audit fields
  closed_at      timestamptz,
  closed_by      uuid,
  closure_notes  text,
  reopened_at    timestamptz,
  reopened_by    uuid,
  reopen_reason  text,

  created_at     timestamptz default now(),
  updated_at     timestamptz default now(),
  UNIQUE (period_start, period_end)
);

CREATE INDEX IF NOT EXISTS idx_payout_cycles_period ON public.payout_cycles(period_start, period_end);
CREATE INDEX IF NOT EXISTS idx_payout_cycles_status ON public.payout_cycles(status);

-- ── 4. Link existing payout tables to a cycle ────────────────────
ALTER TABLE public.payout_distributions
  ADD COLUMN IF NOT EXISTS cycle_id uuid REFERENCES public.payout_cycles(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_payout_distributions_cycle ON public.payout_distributions(cycle_id);

-- bp_payout_transactions is created by the app (no migration defines it); add column defensively.
DO $do$ BEGIN
  ALTER TABLE public.bp_payout_transactions
    ADD COLUMN IF NOT EXISTS cycle_id uuid;
  -- FK is best-effort; skip if the column type doesn't match.
  BEGIN
    ALTER TABLE public.bp_payout_transactions
      ADD CONSTRAINT bp_payout_transactions_cycle_fkey
      FOREIGN KEY (cycle_id) REFERENCES public.payout_cycles(id) ON DELETE SET NULL;
  EXCEPTION WHEN duplicate_object OR undefined_table THEN NULL; END;
EXCEPTION WHEN undefined_table THEN
  RAISE NOTICE 'bp_payout_transactions not yet present, skipping cycle_id link';
END $do$;

-- ── 5. Unified closure audit log ────────────────────────────────
CREATE TABLE IF NOT EXISTS public.closure_audit (
  id            uuid primary key default gen_random_uuid(),
  entity_type   text not null check (entity_type in ('booking','cycle','withdrawal')),
  entity_id     uuid not null,
  action        text not null check (action in ('closed','reopened')),
  performed_by  uuid,
  performed_at  timestamptz default now(),
  reason        text,
  metadata      jsonb
);

CREATE INDEX IF NOT EXISTS idx_closure_audit_entity ON public.closure_audit(entity_type, entity_id, performed_at DESC);
CREATE INDEX IF NOT EXISTS idx_closure_audit_performed_at ON public.closure_audit(performed_at DESC);
