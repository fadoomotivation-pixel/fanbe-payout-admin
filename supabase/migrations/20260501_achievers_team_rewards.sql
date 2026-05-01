-- ============================================================
-- Migration: Achievers Club + Team Rewards support
-- Date: 2026-05-01
-- ============================================================

-- 1. Ensure commission_ranks has all required columns
ALTER TABLE commission_ranks
  ADD COLUMN IF NOT EXISTS badge_color TEXT NOT NULL DEFAULT '#01696f',
  ADD COLUMN IF NOT EXISTS is_active   BOOLEAN NOT NULL DEFAULT true;

-- 2. broker_incomes — tracks per-broker income earned per booking
CREATE TABLE IF NOT EXISTS broker_incomes (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  broker_id   UUID NOT NULL REFERENCES brokers(id) ON DELETE CASCADE,
  booking_id  UUID REFERENCES bookings(id) ON DELETE SET NULL,
  income_type TEXT NOT NULL CHECK (income_type IN ('income1','income2','income3','reward','adjustment')),
  amount      NUMERIC(12,2) NOT NULL DEFAULT 0,
  note        TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_broker_incomes_broker_id   ON broker_incomes(broker_id);
CREATE INDEX IF NOT EXISTS idx_broker_incomes_booking_id  ON broker_incomes(booking_id);
CREATE INDEX IF NOT EXISTS idx_broker_incomes_created_at  ON broker_incomes(created_at DESC);

-- 3. team_reward_tiers — milestone definitions for team rewards
CREATE TABLE IF NOT EXISTS team_reward_tiers (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tier_name              TEXT NOT NULL,
  required_direct        INT  NOT NULL DEFAULT 0,          -- min direct team members
  required_team_business NUMERIC(14,2) NOT NULL DEFAULT 0, -- min cumulative team booking value
  reward_amount          NUMERIC(12,2) NOT NULL DEFAULT 0,
  reward_type            TEXT NOT NULL DEFAULT 'cash'
                           CHECK (reward_type IN ('cash','gift','trip')),
  badge_color            TEXT NOT NULL DEFAULT '#7a39bb',
  is_active              BOOLEAN NOT NULL DEFAULT true,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 4. broker_reward_claims — tracks which tiers each broker has claimed
CREATE TABLE IF NOT EXISTS broker_reward_claims (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  broker_id  UUID NOT NULL REFERENCES brokers(id) ON DELETE CASCADE,
  tier_id    UUID NOT NULL REFERENCES team_reward_tiers(id) ON DELETE CASCADE,
  status     TEXT NOT NULL DEFAULT 'pending'
               CHECK (status IN ('pending','approved','rejected','paid')),
  claimed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  paid_at    TIMESTAMPTZ,
  note       TEXT,
  UNIQUE (broker_id, tier_id)  -- one claim per tier per broker
);

CREATE INDEX IF NOT EXISTS idx_broker_reward_claims_broker  ON broker_reward_claims(broker_id);
CREATE INDEX IF NOT EXISTS idx_broker_reward_claims_tier    ON broker_reward_claims(tier_id);
CREATE INDEX IF NOT EXISTS idx_broker_reward_claims_status  ON broker_reward_claims(status);

-- 5. Seed default reward tiers (idempotent)
INSERT INTO team_reward_tiers (tier_name, required_direct, required_team_business, reward_amount, reward_type, badge_color)
SELECT * FROM (VALUES
  ('Silver Starter',  2,   500000,  5000,  'cash', '#9e9e9e'),
  ('Gold Builder',    5,  2000000, 25000,  'cash', '#d4a017'),
  ('Diamond Leader', 10,  5000000, 75000,  'cash', '#00bcd4'),
  ('Platinum Club',  20, 10000000,150000, 'gift', '#7a39bb'),
  ('Crown Achiever', 50, 25000000,500000, 'trip', '#e91e63')
) AS v(tier_name, required_direct, required_team_business, reward_amount, reward_type, badge_color)
WHERE NOT EXISTS (SELECT 1 FROM team_reward_tiers LIMIT 1);

-- 6. RLS policies
ALTER TABLE broker_incomes        ENABLE ROW LEVEL SECURITY;
ALTER TABLE team_reward_tiers     ENABLE ROW LEVEL SECURITY;
ALTER TABLE broker_reward_claims  ENABLE ROW LEVEL SECURITY;

-- Admin full access
CREATE POLICY "admin_all_broker_incomes"       ON broker_incomes        FOR ALL TO authenticated USING (auth.jwt() ->> 'role' = 'admin');
CREATE POLICY "admin_all_team_reward_tiers"    ON team_reward_tiers     FOR ALL TO authenticated USING (auth.jwt() ->> 'role' = 'admin');
CREATE POLICY "admin_all_broker_reward_claims" ON broker_reward_claims  FOR ALL TO authenticated USING (auth.jwt() ->> 'role' = 'admin');

-- Brokers read their own records
CREATE POLICY "broker_read_own_incomes"  ON broker_incomes       FOR SELECT TO authenticated
  USING (broker_id IN (SELECT id FROM brokers WHERE user_id = auth.uid()));
CREATE POLICY "broker_read_reward_tiers" ON team_reward_tiers    FOR SELECT TO authenticated USING (is_active = true);
CREATE POLICY "broker_read_own_claims"   ON broker_reward_claims FOR SELECT TO authenticated
  USING (broker_id IN (SELECT id FROM brokers WHERE user_id = auth.uid()));
