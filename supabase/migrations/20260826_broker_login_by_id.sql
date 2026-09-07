-- Broker login by ID number.
--
-- Admin's ask: "make userid system with broker login like FNB05120 RAM KISHAN SHARMA his
-- id will be 5120 and make broker password their own mobile number".
--
-- Brokers already have an identity everyone uses on paper -- the broker id, FNB05120 --
-- but the login form only accepted a phone number or the synthetic auto-xxxx@example.com
-- email that nobody can recall.  This resolves ANY of the three to the one email Supabase
-- Auth actually signs in with, so the broker can type whatever they remember.
--
-- One function, one place.  broker_email_for_phone() is kept as a one-line delegate rather
-- than a second copy of the matching rules, so the phone path and the id path can never
-- drift apart.

CREATE OR REPLACE FUNCTION public.broker_email_for_login(p_login text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_in     text;
  v_digits text;
  v_email  text;
  v_hits   int;
BEGIN
  v_in := btrim(coalesce(p_login, ''));
  IF v_in = '' THEN RETURN NULL; END IF;

  -- An email is taken at face value; the sign-in call verifies the password anyway.
  IF position('@' in v_in) > 0 THEN
    RETURN lower(v_in);
  END IF;

  v_digits := regexp_replace(v_in, '[^0-9]', '', 'g');
  IF char_length(v_digits) < 3 THEN RETURN NULL; END IF;

  -- Broker id number first: "5120", "05120" and the whole "FNB05120" all resolve to the
  -- same broker, because only the digits are compared and leading zeros are dropped from
  -- both sides.
  SELECT count(*), max(b.email) INTO v_hits, v_email
    FROM public.brokers b
   WHERE b.status = 'active'
     AND b.email IS NOT NULL AND b.email <> ''
     -- A staff account that also has a broker row (admin@fanbegroup.com is one) must not
     -- be reachable through the broker portal: signing in there would hand a staff login
     -- to whoever knows the id number.
     AND NOT EXISTS (SELECT 1 FROM public.app_users u WHERE lower(u.email) = lower(b.email))
     AND ltrim(regexp_replace(coalesce(b.broker_id, ''), '[^0-9]', '', 'g'), '0')
         = ltrim(v_digits, '0');
  IF v_hits = 1 THEN RETURN v_email; END IF;

  -- Otherwise treat it as a phone, matching on the suffix so "+91 98765-43210",
  -- "919876543210" and "9876543210" all land on the same broker.
  IF char_length(v_digits) >= 6 THEN
    SELECT count(*), max(b.email) INTO v_hits, v_email
      FROM public.brokers b
     WHERE b.status = 'active'
       AND b.email IS NOT NULL AND b.email <> ''
       AND NOT EXISTS (SELECT 1 FROM public.app_users u WHERE lower(u.email) = lower(b.email))
       AND regexp_replace(coalesce(b.phone, ''), '[^0-9]', '', 'g') LIKE '%' || v_digits;
    IF v_hits = 1 THEN RETURN v_email; END IF;
  END IF;

  -- More than one match, or none: return nothing rather than guess.  Answering only on an
  -- exact, unique match is also what stops this being used to walk the broker directory.
  RETURN NULL;
END;
$$;

-- Existing callers keep working, against a single implementation.
CREATE OR REPLACE FUNCTION public.broker_email_for_phone(p_phone text)
RETURNS text
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT public.broker_email_for_login(p_phone);
$$;

GRANT EXECUTE ON FUNCTION public.broker_email_for_login(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.broker_email_for_phone(text) TO anon, authenticated;
