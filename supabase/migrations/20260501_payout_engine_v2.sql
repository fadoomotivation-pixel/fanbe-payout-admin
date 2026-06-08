-- ─────────────────────────────────────────────────────────────────────────────
-- Your Company — Payout Engine v2 Migration
-- Adds correct rank qualification fields (sq yards + sub-rank counts)
-- and broker rank stats tracking table.
-- ─────────────────────────────────────────────────────────────────────────────

-- ============================================================
-- 1. Drop & recreate commission_ranks with correct slab schema
-- ============================================================

-- Remove old seed data (wrong column structure)
delete from commission_ranks;

-- Add new columns for sq-yard-based qualification
alter table commission_ranks
  add column if not exists min_sq_yards         numeric(12,2) not null default 0,
  add column if not exists max_sq_yards         numeric(12,2),
  add column if not exists commission_pct        numeric(6,3) not null default 0,
  add column if not exists rank_qualification_type text not null default 'sq_yards'
    check (rank_qualification_type in ('sq_yards','sub_ranks')),
  add column if not exists required_sub_rank_level int,     -- which rank level is required (for rank 6+)
  add column if not exists required_sub_rank_count int;     -- how many of that sub-rank needed

-- Keep legacy columns (min_business, max_business, income_amount, income_pct)
-- for backward compatibility but they are no longer used by payoutEngine v2.

-- ============================================================
-- 2. Seed the 15 official ranks from Your Company Business Plan
-- ============================================================

insert into commission_ranks (
  rank_name, level,
  min_sq_yards, max_sq_yards,
  commission_pct,
  rank_qualification_type,
  required_sub_rank_level, required_sub_rank_count,
  -- legacy columns (kept for UI compatibility)
  min_business, max_business, income_amount, income_pct,
  active
) values
  -- Ranks 1–5: qualified by team sq yards sold
  ('Executive',               1,    100,   499,  5.0,  'sq_yards', null, null,       0,  500000, 5000, 1.0, true),
  ('Senior Executive',        2,    500,   749,  5.5,  'sq_yards', null, null,  500000, 1500000,15000, 1.5, true),
  ('Sales Officer',           3,    750,  1249,  6.0,  'sq_yards', null, null, 1500000, 3000000,40000, 2.0, true),
  ('Senior Sales Officer',    4,   1250,  1999,  6.5,  'sq_yards', null, null, 3000000, 5000000,75000, 2.5, true),
  ('Team Manager',            5,   2000,  null,  7.0,  'sq_yards', null, null, 5000000,10000000,150000,3.0, true),
  -- Ranks 6–15: qualified by having N brokers of a specific sub-rank in team
  ('Senior Team Manager',     6,      0,  null,  7.5,  'sub_ranks',    4,    3,10000000,25000000,400000,3.5, true),
  ('Assistant Sales Manager', 7,      0,  null,  8.0,  'sub_ranks',    5,    3,25000000,     null,1000000,4.0, true),
  ('Sales Manager',           8,      0,  null,  8.5,  'sub_ranks',    6,    3,       0,      null,      0, 0, true),
  ('Senior Sales Manager',    9,      0,  null,  9.0,  'sub_ranks',    7,    3,       0,      null,      0, 0, true),
  ('Assistant Gen Manager',  10,      0,  null,  9.5,  'sub_ranks',    8,    3,       0,      null,      0, 0, true),
  ('Gen Manager',            11,      0,  null, 10.0,  'sub_ranks',    9,    3,       0,      null,      0, 0, true),
  ('Senior GM',              12,      0,  null, 10.5,  'sub_ranks',   10,    3,       0,      null,      0, 0, true),
  ('Zonal Manager',          13,      0,  null, 11.0,  'sub_ranks',   11,    3,       0,      null,      0, 0, true),
  ('Vice President',         14,      0,  null, 11.5,  'sub_ranks',   12,    3,       0,      null,      0, 0, true),
  ('President',              15,      0,  null, 12.0,  'sub_ranks',   13,    3,       0,      null,      0, 0, true)
on conflict (rank_name) do update set
  level                    = excluded.level,
  min_sq_yards             = excluded.min_sq_yards,
  max_sq_yards             = excluded.max_sq_yards,
  commission_pct           = excluded.commission_pct,
  rank_qualification_type  = excluded.rank_qualification_type,
  required_sub_rank_level  = excluded.required_sub_rank_level,
  required_sub_rank_count  = excluded.required_sub_rank_count,
  active                   = excluded.active;

-- ============================================================
-- 3. Broker rank stats table
--    Tracks each broker's cumulative team sq yards and current rank level.
--    Updated via trigger or application logic when a payment is approved.
-- ============================================================

create table if not exists broker_rank_stats (
  broker_id              uuid primary key,
  current_rank_level     int  not null default 1,       -- FK to commission_ranks.level
  personal_sq_yards      numeric(12,2) not null default 0, -- this broker's own sales
  team_sq_yards          numeric(12,2) not null default 0, -- total team (self + downline)
  direct_count           int  not null default 0,          -- number of direct referrals
  updated_at             timestamptz default now()
);
create index if not exists idx_broker_rank_stats_rank on broker_rank_stats(current_rank_level);

-- ============================================================
-- 4. Add lapsed flag + differential tracking to payout_distributions
-- ============================================================

alter table payout_distributions
  add column if not exists upline_rank_pct    numeric(6,3) default 0,
  add column if not exists downline_rank_pct  numeric(6,3) default 0,
  add column if not exists differential_pct   numeric(6,3) default 0,
  add column if not exists lapsed             boolean default false;

-- Update income_type constraint to include 'direct' and 'differential'
alter table payout_distributions
  drop constraint if exists payout_distributions_income_type_check;
alter table payout_distributions
  add constraint payout_distributions_income_type_check
  check (income_type in ('direct','differential','income1','income2','income3'));

-- ============================================================
-- 5. Achievers Club monthly tracking table
-- ============================================================

create table if not exists achievers_club_months (
  id                    uuid primary key default gen_random_uuid(),
  month_year            text not null unique,               -- e.g. '2026-05'
  total_fresh_sq_yards  numeric(12,2) not null default 0,
  total_pool            numeric(14,2) not null default 0,   -- Rs.100 × sq yards
  qualifying_count      int  not null default 0,
  per_achiever_amount   numeric(14,2) not null default 0,
  monthly_instalment    numeric(14,2) not null default 0,   -- per_achiever / 3
  status                text default 'pending'
    check (status in ('pending','distributed','partial')),
  created_at            timestamptz default now()
);

create table if not exists achievers_club_payouts (
  id                    uuid primary key default gen_random_uuid(),
  month_id              uuid not null references achievers_club_months(id) on delete cascade,
  broker_id             uuid not null,
  instalment_no         int  not null check (instalment_no in (1,2,3)),
  amount                numeric(14,2) not null,
  status                text default 'pending'
    check (status in ('pending','paid')),
  paid_at               timestamptz,
  unique(month_id, broker_id, instalment_no)
);
create index if not exists idx_achievers_payouts_broker on achievers_club_payouts(broker_id);

-- ============================================================
-- 6. Update app_settings payout_config — remove flat income % fields,
--    add lapsation_grace_days
-- ============================================================

insert into app_settings(key, value) values
  ('payout_config', '{
    "admin_charge_pct": 10,
    "tds_pct": 5,
    "min_withdrawal": 1000,
    "max_levels": 15,
    "lapsation_grace_days": 90
  }'::jsonb)
on conflict (key) do update
  set value = '{
    "admin_charge_pct": 10,
    "tds_pct": 5,
    "min_withdrawal": 1000,
    "max_levels": 15,
    "lapsation_grace_days": 90
  }'::jsonb,
  updated_at = now();
