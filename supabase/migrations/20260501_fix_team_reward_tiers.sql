-- ─────────────────────────────────────────────────────────────────────────────
-- Fix: Team Reward Tiers — correct unit thresholds per Fanbe Group Business Plan
--
-- PDF Rules:
--   1 Unit = 50 Sq Yards
--   Rewards given ONLY when each member's plot payment reaches 50%
--   Max 33% of any single team's business counted toward team rewards
--   Direct Team Bonanza valid for 1 month only
-- ─────────────────────────────────────────────────────────────────────────────

-- Wipe old seed data and re-seed with correct values
TRUNCATE team_reward_tiers RESTART IDENTITY CASCADE;

INSERT INTO team_reward_tiers
  (tier_name, required_units, required_sq_yards, reward_description, reward_value_inr, reward_type, max_team_pct, min_payment_pct, badge_color, is_active)
VALUES
  ('Mini Laptop',          50,     2500,   'Mini Laptop',                      35000,       'gift',  33, 50, '#6366f1', true),
  ('55" LED TV',           110,    5500,   '55 Inch LED TV',                   60000,       'gift',  33, 50, '#8b5cf6', true),
  ('Royal Enfield Bullet', 210,    10500,  'Royal Enfield Bullet (Ex-Showroom)',220000,      'gift',  33, 50, '#f59e0b', true),
  ('Maruti Suzuki Alto',   410,    20500,  'Maruti Suzuki Alto (Ex-Showroom)', 500000,       'gift',  33, 50, '#10b981', true),
  ('Maruti Suzuki Brezza', 810,    40500,  'Maruti Suzuki Brezza (Ex-Showroom)',1200000,     'gift',  33, 50, '#ef4444', true),
  ('Farm House 35L',       5000,   250000, 'Farm House worth Rs. 35 Lakhs',    3500000,      'gift',  33, 50, '#0ea5e9', true),
  ('Farm House 1Cr',       12000,  600000, 'Farm House worth Rs. 1 Crore',     10000000,     'gift',  33, 50, '#f97316', true);

-- Add new columns if they don't exist yet
ALTER TABLE team_reward_tiers
  ADD COLUMN IF NOT EXISTS required_units       integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS required_sq_yards    integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS max_team_pct         numeric(5,2) NOT NULL DEFAULT 33,
  ADD COLUMN IF NOT EXISTS min_payment_pct      numeric(5,2) NOT NULL DEFAULT 50,
  ADD COLUMN IF NOT EXISTS reward_value_inr     bigint  NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS reward_description   text;

-- broker_reward_claims: add payment_gate_met flag
ALTER TABLE broker_reward_claims
  ADD COLUMN IF NOT EXISTS payment_gate_met     boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS qualifying_sq_yards  integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS capped_sq_yards      integer NOT NULL DEFAULT 0;

COMMENT ON COLUMN team_reward_tiers.required_units     IS '1 unit = 50 sq yards (per Fanbe Business Plan)';
COMMENT ON COLUMN team_reward_tiers.max_team_pct       IS 'Max 33% of any single team business counted (PDF rule)';
COMMENT ON COLUMN team_reward_tiers.min_payment_pct    IS 'Reward paid only when each plot payment >= 50% (PDF rule)';
COMMENT ON COLUMN broker_reward_claims.payment_gate_met IS 'True only when all members plot payments >= 50%';
