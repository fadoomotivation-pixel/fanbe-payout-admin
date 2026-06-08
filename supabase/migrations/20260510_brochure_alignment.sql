-- ─────────────────────────────────────────────────────────────────────────────
-- Your Company — Brochure Alignment (May 2026)
-- Aligns commission_ranks, achievers_club_config, payout_terms with the
-- official Business Plan brochure (15 ranks · achievers club · team rewards
-- terms).
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. commission_ranks: add min_directs + rank-order alias, fix rank-1 name
alter table commission_ranks
  add column if not exists min_directs int not null default 0;

-- Rename Rank-1 from "Executive" to "Post-Executive" (brochure name)
update commission_ranks
   set rank_name   = 'Post-Executive',
       min_directs = 1
 where level = 1;

-- Ensure no other rank carries a min_directs value
update commission_ranks set min_directs = 0 where level <> 1;

-- Re-state the 15 brochure rows with correct values, keyed on level
-- (rank_name has a unique constraint, so we update by level).
do $$
declare
  r record;
  data jsonb := '[
    {"level":1, "rank_name":"Post-Executive",        "commission_pct":5.0,  "min_sq_yards":100,  "max_sq_yards":499,  "qtype":"sq_yards", "sub_rank_lvl":null,"sub_rank_count":null,"min_directs":1},
    {"level":2, "rank_name":"Senior Executive",      "commission_pct":5.5,  "min_sq_yards":500,  "max_sq_yards":749,  "qtype":"sq_yards", "sub_rank_lvl":null,"sub_rank_count":null,"min_directs":0},
    {"level":3, "rank_name":"Sales Officer",         "commission_pct":6.0,  "min_sq_yards":750,  "max_sq_yards":1249, "qtype":"sq_yards", "sub_rank_lvl":null,"sub_rank_count":null,"min_directs":0},
    {"level":4, "rank_name":"Senior Sales Officer",  "commission_pct":6.5,  "min_sq_yards":1250, "max_sq_yards":1999, "qtype":"sq_yards", "sub_rank_lvl":null,"sub_rank_count":null,"min_directs":0},
    {"level":5, "rank_name":"Team Manager",          "commission_pct":7.0,  "min_sq_yards":2000, "max_sq_yards":null, "qtype":"sq_yards", "sub_rank_lvl":null,"sub_rank_count":null,"min_directs":0},
    {"level":6, "rank_name":"Senior Team Manager",   "commission_pct":7.5,  "min_sq_yards":0,    "max_sq_yards":null, "qtype":"sub_ranks","sub_rank_lvl":4,   "sub_rank_count":3,    "min_directs":0},
    {"level":7, "rank_name":"Assistant Sales Manager","commission_pct":8.0, "min_sq_yards":0,    "max_sq_yards":null, "qtype":"sub_ranks","sub_rank_lvl":5,   "sub_rank_count":3,    "min_directs":0},
    {"level":8, "rank_name":"Sales Manager",         "commission_pct":8.5,  "min_sq_yards":0,    "max_sq_yards":null, "qtype":"sub_ranks","sub_rank_lvl":6,   "sub_rank_count":3,    "min_directs":0},
    {"level":9, "rank_name":"Senior Sales Manager",  "commission_pct":9.0,  "min_sq_yards":0,    "max_sq_yards":null, "qtype":"sub_ranks","sub_rank_lvl":7,   "sub_rank_count":3,    "min_directs":0},
    {"level":10,"rank_name":"Assistant Gen Manager", "commission_pct":9.5,  "min_sq_yards":0,    "max_sq_yards":null, "qtype":"sub_ranks","sub_rank_lvl":8,   "sub_rank_count":3,    "min_directs":0},
    {"level":11,"rank_name":"Gen Manager",           "commission_pct":10.0, "min_sq_yards":0,    "max_sq_yards":null, "qtype":"sub_ranks","sub_rank_lvl":9,   "sub_rank_count":3,    "min_directs":0},
    {"level":12,"rank_name":"Senior GM",             "commission_pct":10.5, "min_sq_yards":0,    "max_sq_yards":null, "qtype":"sub_ranks","sub_rank_lvl":10,  "sub_rank_count":3,    "min_directs":0},
    {"level":13,"rank_name":"Zonal Manager",         "commission_pct":11.0, "min_sq_yards":0,    "max_sq_yards":null, "qtype":"sub_ranks","sub_rank_lvl":11,  "sub_rank_count":3,    "min_directs":0},
    {"level":14,"rank_name":"Vice President",        "commission_pct":11.5, "min_sq_yards":0,    "max_sq_yards":null, "qtype":"sub_ranks","sub_rank_lvl":12,  "sub_rank_count":3,    "min_directs":0},
    {"level":15,"rank_name":"President",             "commission_pct":12.0, "min_sq_yards":0,    "max_sq_yards":null, "qtype":"sub_ranks","sub_rank_lvl":13,  "sub_rank_count":3,    "min_directs":0}
  ]'::jsonb;
begin
  for r in select * from jsonb_to_recordset(data) as x(
      level int, rank_name text, commission_pct numeric, min_sq_yards numeric,
      max_sq_yards numeric, qtype text, sub_rank_lvl int, sub_rank_count int,
      min_directs int)
  loop
    update commission_ranks
       set rank_name               = r.rank_name,
           commission_pct          = r.commission_pct,
           min_sq_yards            = r.min_sq_yards,
           max_sq_yards            = r.max_sq_yards,
           rank_qualification_type = r.qtype,
           required_sub_rank_level = r.sub_rank_lvl,
           required_sub_rank_count = r.sub_rank_count,
           min_directs             = r.min_directs,
           active                  = true
     where level = r.level;
  end loop;
end$$;

comment on column commission_ranks.min_directs is
  'Minimum direct downline brokers required (Rank-1 Post-Executive = 1 per brochure)';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Achievers Club Income — config table
--    Per brochure: 3000 sq yds team business x 3 consecutive months,
--                  Rs.100 per sq yd of fresh sale per month,
--                  total pool ÷ achievers (equal split),
--                  payout in 3 monthly installments.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists achievers_club_config (
  id                            int  primary key default 1,
  target_sq_yards               int  not null default 3000,
  consecutive_months            int  not null default 3,
  allocation_per_sq_yard_inr    numeric(10,2) not null default 100,
  payout_installments           int  not null default 3,
  description                   text default
    'Maintain 3000 Sq Yards team business for 3 consecutive months. ' ||
    'Pool: Rs.100 per sq yard of fresh monthly sales (with full booking). ' ||
    'Pool ÷ achievers = equal share. Paid in 3 monthly installments.',
  updated_at                    timestamptz not null default now(),
  constraint achievers_club_config_singleton check (id = 1)
);

insert into achievers_club_config (id) values (1) on conflict do nothing;

-- Per-month achiever roster (computed by payout engine)
create table if not exists achievers_club_periods (
  id                  uuid primary key default gen_random_uuid(),
  period_month        date not null,                 -- first day of the calendar month
  total_fresh_sq_yds  int  not null default 0,
  total_pool_inr      numeric(14,2) not null default 0,
  achiever_count      int  not null default 0,
  per_achiever_inr    numeric(14,2) not null default 0,
  closed              boolean not null default false,
  created_at          timestamptz not null default now(),
  unique (period_month)
);

create table if not exists achievers_club_payouts (
  id            uuid primary key default gen_random_uuid(),
  period_id     uuid not null references achievers_club_periods(id) on delete cascade,
  broker_id     uuid not null references brokers(id) on delete cascade,
  total_amount  numeric(14,2) not null default 0,
  installments  int not null default 3,
  paid_installments int not null default 0,
  status        text not null default 'pending'
                  check (status in ('pending','partial','completed','cancelled')),
  created_at    timestamptz not null default now(),
  unique (period_id, broker_id)
);

create index if not exists idx_achievers_club_payouts_broker on achievers_club_payouts(broker_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Payout Terms — single editable config row (brochure "Important Terms")
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists payout_terms_config (
  id                          int primary key default 1,
  differential_basis          boolean not null default true,
  closing_frequency           text not null default 'daily'
                                check (closing_frequency in ('daily','weekly','monthly')),
  distribution_frequency      text not null default 'monthly'
                                check (distribution_frequency in ('daily','weekly','monthly')),
  block_equal_or_super_seeded boolean not null default true,
  require_booking_amount      boolean not null default true,
  payout_on_deposited_only    boolean not null default true,
  installment_grace_days      int  not null default 90,
  notes                       text,
  updated_at                  timestamptz not null default now(),
  constraint payout_terms_config_singleton check (id = 1)
);

insert into payout_terms_config (id, notes) values
  (1,
   'Payout on differentials. Daily close, monthly distribution. ' ||
   'No payout on equal-rank or super-seeded teams. ' ||
   'Sale counted only when booking amount or more is deposited. ' ||
   'Payout calculated on deposited amount. ' ||
   '90-day grace period for instalment deposits; irregular deposits cause payout lapsation.')
on conflict do nothing;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. RLS
-- ─────────────────────────────────────────────────────────────────────────────

alter table achievers_club_config   enable row level security;
alter table achievers_club_periods  enable row level security;
alter table achievers_club_payouts  enable row level security;
alter table payout_terms_config     enable row level security;

drop policy if exists admin_all_achievers_club_config  on achievers_club_config;
drop policy if exists admin_all_achievers_club_periods on achievers_club_periods;
drop policy if exists admin_all_achievers_club_payouts on achievers_club_payouts;
drop policy if exists admin_all_payout_terms_config    on payout_terms_config;

create policy admin_all_achievers_club_config  on achievers_club_config  for all to authenticated using (true) with check (true);
create policy admin_all_achievers_club_periods on achievers_club_periods for all to authenticated using (true) with check (true);
create policy admin_all_achievers_club_payouts on achievers_club_payouts for all to authenticated using (true) with check (true);
create policy admin_all_payout_terms_config    on payout_terms_config    for all to authenticated using (true) with check (true);
