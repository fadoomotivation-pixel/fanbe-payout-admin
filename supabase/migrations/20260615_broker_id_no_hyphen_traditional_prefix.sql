-- Broker ID format:
--   MLM         : FNB<seq>   (e.g. FNB05005, no hyphen)
--   Traditional : TR<seq>    (e.g. TR800,   no hyphen)
-- Two sequences so the namespaces don't fight.  FNB reuses the existing broker_id_seq;
-- a new broker_id_tr_seq starts at 800.

CREATE SEQUENCE IF NOT EXISTS broker_id_tr_seq START WITH 800;

CREATE OR REPLACE FUNCTION public.assign_broker_id()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  next_num bigint;
BEGIN
  IF NEW.broker_id IS NULL OR NEW.broker_id = '' THEN
    IF NEW.broker_type = 'traditional' THEN
      next_num := nextval('broker_id_tr_seq');
      NEW.broker_id := 'TR' || next_num::text;
    ELSE
      next_num := nextval('broker_id_seq');
      NEW.broker_id := 'FNB0' || next_num::text;
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

UPDATE public.brokers
   SET broker_id = replace(broker_id, '-', '')
 WHERE broker_id LIKE 'FNB-%';
