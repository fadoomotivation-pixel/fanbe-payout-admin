-- The PIN behind the privacy lock.
--
-- Admin: "agar 15 min se system nahi use hua ... broker ne kya kamaya or
-- broker ka number blur ho jae ... ek pin dalne ka option aye to blur hat
-- jae ... normal employee galti se data na chura le laptop se."
--
-- WHAT THIS IS, PLAINLY. The blur itself is a style, and a style is not
-- security: anyone who opens the browser's dev tools, or calls the REST API
-- with the anon key, still sees the numbers. What it does stop is the thing
-- that actually happens in an office - a laptop left open, someone walking
-- past, a photo of the broker list and what each one earns. For an affiliate
-- network that list IS the business, so it is worth locking the screen even
-- though it is not worth calling it encryption.
--
-- WHY THE PIN LIVES HERE AND NOT IN THE APP. A PIN written into the
-- JavaScript is readable by exactly the person it is meant to stop - "view
-- source" is enough. So it is stored hashed, in a table with no RLS policies
-- at all and no grants to anon or authenticated, and only these SECURITY
-- DEFINER functions can reach it. The browser sends a guess and gets back
-- true or false; the PIN itself never leaves the server.
--
-- A four-digit PIN is 10,000 guesses, which a script finishes in seconds, so
-- verify_privacy_pin() throttles: five wrong tries and it refuses everyone
-- for a minute. That turns a seconds-long attack into a days-long one, which
-- is the most a short PIN can honestly give.
--
-- Seeded with 1947 because that is what admin asked for. It is also a date
-- every person in India would guess first, so set_privacy_pin() exists and
-- the app offers "Change PIN".
--
-- Plain ASCII, short lines, no long rules or box-drawing. A banner of repeated
-- punctuation has already cost us one failed paste on a phone: the leading
-- "--" was dropped in transit and Postgres read the rest as an operator.
--
-- Safe to run more than once. Deletes nothing.

BEGIN;

CREATE TABLE IF NOT EXISTS public.app_security (
  key        text PRIMARY KEY,
  value      text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- RLS on with NO policies: PostgREST can reach the table but every row is
-- invisible, and the revokes below mean the API cannot even ask. Only the
-- functions underneath, which run as the owner, can read or write it.
ALTER TABLE public.app_security ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.app_security FROM PUBLIC, anon, authenticated;

-- pgcrypto lives in the extensions schema here, so crypt() and gen_salt()
-- must be qualified: a SECURITY DEFINER function with search_path set to
-- 'public' would not find them otherwise.
INSERT INTO public.app_security (key, value)
VALUES ('privacy_pin', extensions.crypt('1947', extensions.gen_salt('bf')))
ON CONFLICT (key) DO NOTHING;

-- Check a guess.
CREATE OR REPLACE FUNCTION public.verify_privacy_pin(p_pin text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_hash  text;
  v_fails int;
  v_until timestamptz;
BEGIN
  -- Office staff only. A broker login cannot even rattle the handle.
  IF NOT public.is_staff() THEN
    RAISE EXCEPTION 'Only office staff can unlock the screen.';
  END IF;

  SELECT value::int INTO v_fails
    FROM public.app_security WHERE key = 'pin_fail_count';
  SELECT value::timestamptz INTO v_until
    FROM public.app_security WHERE key = 'pin_blocked_until';

  IF v_until IS NOT NULL AND v_until > now() THEN
    RAISE EXCEPTION 'Too many wrong PINs. Try again in % seconds.',
      greatest(1, ceil(extract(epoch FROM (v_until - now())))::int);
  END IF;

  SELECT value INTO v_hash
    FROM public.app_security WHERE key = 'privacy_pin';
  IF v_hash IS NULL THEN
    -- No PIN set yet: do not lock the office out of its own screens.
    RETURN true;
  END IF;

  IF extensions.crypt(coalesce(p_pin, ''), v_hash) = v_hash THEN
    DELETE FROM public.app_security
     WHERE key IN ('pin_fail_count', 'pin_blocked_until');
    RETURN true;
  END IF;

  v_fails := coalesce(v_fails, 0) + 1;
  INSERT INTO public.app_security (key, value, updated_at)
  VALUES ('pin_fail_count', v_fails::text, now())
  ON CONFLICT (key) DO UPDATE
    SET value = excluded.value, updated_at = now();

  IF v_fails >= 5 THEN
    INSERT INTO public.app_security (key, value, updated_at)
    VALUES ('pin_blocked_until',
            (now() + interval '60 seconds')::text, now())
    ON CONFLICT (key) DO UPDATE
      SET value = excluded.value, updated_at = now();
    DELETE FROM public.app_security WHERE key = 'pin_fail_count';
  END IF;

  RETURN false;
END;
$fn$;

-- Change it.
CREATE OR REPLACE FUNCTION public.set_privacy_pin(p_current text, p_new text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE v_hash text;
BEGIN
  IF NOT public.is_staff() THEN
    RAISE EXCEPTION 'Only office staff can change the PIN.';
  END IF;
  IF p_new IS NULL OR p_new !~ '^[0-9]{4,8}$' THEN
    RAISE EXCEPTION 'The PIN must be 4 to 8 digits.';
  END IF;

  SELECT value INTO v_hash
    FROM public.app_security WHERE key = 'privacy_pin';
  -- Knowing the old PIN is required, so an unattended unlocked screen cannot
  -- be used to quietly set a new one and lock the office out.
  IF v_hash IS NOT NULL
     AND extensions.crypt(coalesce(p_current, ''), v_hash) <> v_hash THEN
    RAISE EXCEPTION 'The current PIN is wrong.';
  END IF;

  INSERT INTO public.app_security (key, value, updated_at)
  VALUES ('privacy_pin',
          extensions.crypt(p_new, extensions.gen_salt('bf')), now())
  ON CONFLICT (key) DO UPDATE
    SET value = excluded.value, updated_at = now();
  DELETE FROM public.app_security
   WHERE key IN ('pin_fail_count', 'pin_blocked_until');
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.verify_privacy_pin(text)
  FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.set_privacy_pin(text, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.verify_privacy_pin(text)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_privacy_pin(text, text)
  TO authenticated;

COMMIT;

-- After running:
--   SELECT public.verify_privacy_pin('1947');  -- true for an office login
--   SELECT public.verify_privacy_pin('0000');  -- false
--   SELECT * FROM public.app_security;         -- permission denied
