-- The TeamRewards page was reading a table that never existed, so it always showed
-- "No reward tiers configured yet."  Create it with the default tier slabs from the
-- Sunrise Business Plan PDF so the page renders meaningfully out of the box; admin can
-- edit / disable later via direct DB or a future admin form.
CREATE TABLE IF NOT EXISTS public.team_reward_tiers (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tier_name          text    NOT NULL,
  required_units     integer NOT NULL,
  required_sq_yards  integer NOT NULL,
  reward_description text,
  reward_value_inr   numeric NOT NULL DEFAULT 0,
  reward_type        text    NOT NULL DEFAULT 'cash' CHECK (reward_type IN ('cash','gift','trip')),
  max_team_pct       integer NOT NULL DEFAULT 33,
  min_payment_pct    integer NOT NULL DEFAULT 50,
  badge_color        text    NOT NULL DEFAULT '#6366F1',
  is_active          boolean NOT NULL DEFAULT true,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.team_reward_tiers (tier_name, required_units, required_sq_yards, reward_description, reward_value_inr, reward_type, badge_color)
VALUES
  ('Bronze · 20 Units',   20,   1000, 'Cash bonus on milestone',                  25000,    'cash', '#A16207'),
  ('Silver · 50 Units',   50,   2500, 'Gold coin (10g) + cash',                   75000,    'gift', '#94A3B8'),
  ('Gold · 100 Units',    100,  5000, 'International trip for two',               200000,   'trip', '#EAB308'),
  ('Platinum · 250 Units',250, 12500, 'Two-wheeler (base model, ex-showroom)',    150000,   'gift', '#A78BFA'),
  ('Diamond · 500 Units', 500, 25000, 'Compact car (base model, ex-showroom)',    600000,   'gift', '#06B6D4')
ON CONFLICT DO NOTHING;

NOTIFY pgrst, 'reload schema';
