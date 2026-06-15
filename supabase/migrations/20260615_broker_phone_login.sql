CREATE OR REPLACE FUNCTION public.broker_email_for_phone(p_phone text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  normalised text;
  result text;
  hits     int;
BEGIN
  normalised := regexp_replace(COALESCE(p_phone, ''), '[^0-9]', '', 'g');
  IF char_length(normalised) < 6 THEN RETURN NULL; END IF;
  SELECT count(*), max(email) INTO hits, result
    FROM public.brokers
   WHERE status = 'active' AND email IS NOT NULL
     AND regexp_replace(COALESCE(phone, ''), '[^0-9]', '', 'g') LIKE '%' || normalised;
  IF hits = 1 THEN RETURN result; END IF;
  RETURN NULL;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.broker_email_for_phone(text) TO anon, authenticated;
