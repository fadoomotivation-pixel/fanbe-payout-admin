-- ─────────────────────────────────────────────────────────────────────────────
-- Fanbe Group — Achievers Club + Team Rewards DB Migration
-- ─────────────────────────────────────────────────────────────────────────────

-- ============================================================
-- 1. team_rewards table
--    Populated when a broker achieves a new rank.
--    Admin approves → marks paid.
-- ============================================================

create table if not exists team_rewards (
  id                   uuid primary key default gen_random_uuid(),
  broker_id            uuid not null,
  achieved_rank_level  int  not null,
  achieved_rank_name   text not null,
  reward_type          text not null default 'cash'
    check (reward_type in ('cash','gift','trip','certificate')),
  reward_amount        numeric(14,2) not null default 0,
  reward_description   text not null default '',
  achieved_at          timestamptz not null default now(),
  paid_at              timestamptz,
  status               text not null default 'pending'
    check (status in ('pending','approved','paid')),
  created_at           timestamptz default now()
);

create index if not exists idx_team_rewards_broker  on team_rewards(broker_id);
create index if not exists idx_team_rewards_rank    on team_rewards(achieved_rank_level);
create index if not exists idx_team_rewards_status  on team_rewards(status);

-- ============================================================
-- 2. RLS for team_rewards
-- ============================================================

alter table team_rewards enable row level security;

drop policy if exists "admin full access team_rewards" on team_rewards;
create policy "admin full access team_rewards"
  on team_rewards
  for all
  using (
    exists (
      select 1 from brokers b
      where b.id = auth.uid() and b.role in ('admin','super_admin')
    )
  );

drop policy if exists "broker read own rewards" on team_rewards;
create policy "broker read own rewards"
  on team_rewards
  for select
  using (broker_id = auth.uid());

-- ============================================================
-- 3. RLS for achievers_club_months + achievers_club_payouts
--    (tables created in payout_engine_v2 migration)
-- ============================================================

alter table achievers_club_months enable row level security;

drop policy if exists "admin full access achievers_months" on achievers_club_months;
create policy "admin full access achievers_months"
  on achievers_club_months
  for all
  using (
    exists (
      select 1 from brokers b
      where b.id = auth.uid() and b.role in ('admin','super_admin')
    )
  );

alter table achievers_club_payouts enable row level security;

drop policy if exists "admin full access achievers_payouts" on achievers_club_payouts;
create policy "admin full access achievers_payouts"
  on achievers_club_payouts
  for all
  using (
    exists (
      select 1 from brokers b
      where b.id = auth.uid() and b.role in ('admin','super_admin')
    )
  );

drop policy if exists "broker read own achiever payouts" on achievers_club_payouts;
create policy "broker read own achiever payouts"
  on achievers_club_payouts
  for select
  using (broker_id = auth.uid());

-- ============================================================
-- 4. Function: auto-insert team_reward row on rank upgrade
--    Called from application code after broker_rank_stats update,
--    OR can be triggered via Postgres trigger on broker_rank_stats.
--
--    Reward amounts match RANK_REWARD_CONFIG in TeamRewards.tsx.
-- ============================================================

create or replace function insert_rank_reward(
  p_broker_id    uuid,
  p_rank_level   int,
  p_rank_name    text
) returns void language plpgsql as $$
declare
  v_amount       numeric(14,2);
  v_reward_type  text;
  v_description  text;
begin
  -- Map rank level → reward config (mirrors RANK_REWARD_CONFIG in TS)
  case p_rank_level
    when 1  then v_amount := 0;       v_reward_type := 'certificate'; v_description := 'Welcome Certificate';
    when 2  then v_amount := 2500;    v_reward_type := 'gift';        v_description := 'Gift Voucher ₹2,500';
    when 3  then v_amount := 5000;    v_reward_type := 'cash';        v_description := 'Cash Reward ₹5,000';
    when 4  then v_amount := 10000;   v_reward_type := 'cash';        v_description := 'Cash Reward ₹10,000';
    when 5  then v_amount := 25000;   v_reward_type := 'gift';        v_description := 'Smart Watch / Gift ₹25,000';
    when 6  then v_amount := 50000;   v_reward_type := 'cash';        v_description := 'Cash Reward ₹50,000';
    when 7  then v_amount := 100000;  v_reward_type := 'cash';        v_description := 'Cash Reward ₹1,00,000';
    when 8  then v_amount := 150000;  v_reward_type := 'trip';        v_description := 'Domestic Trip Package';
    when 9  then v_amount := 200000;  v_reward_type := 'cash';        v_description := 'Cash Reward ₹2,00,000';
    when 10 then v_amount := 300000;  v_reward_type := 'trip';        v_description := 'International Trip Package';
    when 11 then v_amount := 500000;  v_reward_type := 'cash';        v_description := 'Cash Reward ₹5,00,000';
    when 12 then v_amount := 750000;  v_reward_type := 'gift';        v_description := 'Luxury Gift / Vehicle';
    when 13 then v_amount := 1000000; v_reward_type := 'cash';        v_description := 'Cash Reward ₹10,00,000';
    when 14 then v_amount := 1500000; v_reward_type := 'trip';        v_description := 'International Family Trip';
    when 15 then v_amount := 2500000; v_reward_type := 'cash';        v_description := 'Cash Reward ₹25,00,000';
    else
      v_amount := 0; v_reward_type := 'certificate'; v_description := 'Rank Achievement';
  end case;

  -- Avoid duplicate reward for same broker + rank
  insert into team_rewards (
    broker_id, achieved_rank_level, achieved_rank_name,
    reward_type, reward_amount, reward_description, status
  )
  values (
    p_broker_id, p_rank_level, p_rank_name,
    v_reward_type, v_amount, v_description, 'pending'
  )
  on conflict do nothing;
end;
$$;

-- ============================================================
-- 5. Trigger: fire insert_rank_reward when broker_rank_stats
--    current_rank_level increases
-- ============================================================

create or replace function trg_broker_rank_upgrade() returns trigger language plpgsql as $$
declare
  v_rank_name text;
begin
  -- Only fire on rank level increase
  if NEW.current_rank_level <= OLD.current_rank_level then
    return NEW;
  end if;

  -- Lookup rank name
  select rank_name into v_rank_name
  from commission_ranks
  where level = NEW.current_rank_level
  limit 1;

  perform insert_rank_reward(NEW.broker_id, NEW.current_rank_level, coalesce(v_rank_name, 'Unknown'));
  return NEW;
end;
$$;

drop trigger if exists trg_rank_upgrade on broker_rank_stats;
create trigger trg_rank_upgrade
  after update of current_rank_level on broker_rank_stats
  for each row
  execute function trg_broker_rank_upgrade();

-- ============================================================
-- 6. Function: generate_achievers_club_payouts(month_year)
--    After admin records sq yards for a month, call this to:
--    a) Compute qualifying brokers (those with personal_sq_yards > 0
--       in the given month — join via payout_distributions for month filter)
--    b) Update achievers_club_months with counts & per-achiever amount
--    c) Seed 3 instalment rows per qualifying broker
-- ============================================================

create or replace function generate_achievers_payouts(p_month_year text)
returns void language plpgsql as $$
declare
  v_month_id            uuid;
  v_total_pool          numeric(14,2);
  v_qualifying_count    int;
  v_per_achiever        numeric(14,2);
  v_instalment          numeric(14,2);
  v_broker              record;
begin
  -- Load the month record
  select id, total_pool
  into v_month_id, v_total_pool
  from achievers_club_months
  where month_year = p_month_year;

  if v_month_id is null then
    raise exception 'Month % not found in achievers_club_months', p_month_year;
  end if;

  -- Qualifying brokers: any broker with an approved payment this month
  -- (broker_rank_stats personal_sq_yards updated → payment_month extracted from booking/payment table)
  -- Using payout_distributions as proxy: brokers who received a 'direct' payout this month
  create temp table _qualifying_brokers on commit drop as
  select distinct beneficiary_broker_id as broker_id
  from payout_distributions
  where income_type = 'direct'
    and to_char(created_at, 'YYYY-MM') = p_month_year;

  select count(*) into v_qualifying_count from _qualifying_brokers;

  if v_qualifying_count = 0 then
    update achievers_club_months
    set qualifying_count = 0, per_achiever_amount = 0, monthly_instalment = 0, status = 'pending'
    where id = v_month_id;
    return;
  end if;

  v_per_achiever := round(v_total_pool / v_qualifying_count, 2);
  v_instalment   := round(v_per_achiever / 3, 2);

  -- Update month record
  update achievers_club_months
  set qualifying_count   = v_qualifying_count,
      per_achiever_amount = v_per_achiever,
      monthly_instalment  = v_instalment,
      status              = 'partial'
  where id = v_month_id;

  -- Seed 3 instalment rows per qualifying broker
  for v_broker in select broker_id from _qualifying_brokers loop
    for i in 1..3 loop
      insert into achievers_club_payouts
        (month_id, broker_id, instalment_no, amount, status)
      values
        (v_month_id, v_broker.broker_id, i, v_instalment, 'pending')
      on conflict (month_id, broker_id, instalment_no) do nothing;
    end loop;
  end loop;
end;
$$;

-- ============================================================
-- 7. Grant execute on helper functions to service role
-- ============================================================

grant execute on function insert_rank_reward(uuid, int, text)      to service_role;
grant execute on function generate_achievers_payouts(text)         to service_role;
