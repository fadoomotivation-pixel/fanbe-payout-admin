-- broker_type distinguishes MLM brokers from traditional brokers.
ALTER TABLE public.brokers
  ADD COLUMN IF NOT EXISTS broker_type TEXT NOT NULL DEFAULT 'mlm'
    CHECK (broker_type IN ('mlm', 'traditional'));

COMMENT ON COLUMN public.brokers.broker_type IS
  'mlm = default, lives in sponsor tree and earns via differential cascade; traditional = standalone broker used only for non-MLM sales.';

CREATE INDEX IF NOT EXISTS idx_brokers_broker_type ON public.brokers(broker_type);
