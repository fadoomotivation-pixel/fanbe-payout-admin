-- Start Affiliate (MLM) broker codes at FNB05000.
--
-- Admin: "Ha mlm 5000 se shuru kro."
--
-- WHY THIS IS A ONE-TIME WINDOW. broker_id_seq had already run to 5143 -- almost
-- certainly from brokers created and deleted during setup, because a sequence never goes
-- backwards on its own. There is not one Affiliate broker in the system today, so the
-- first real code would have been FNB05144. Once a single broker exists this cannot be
-- put right without renumbering people who are already carrying their codes around, so
-- it is being settled while the count is still zero.
--
-- WHAT IT DOES. Sets the sequence so the very next Affiliate broker gets exactly
-- FNB05000, then 5001, 5002 and so on. assign_broker_id() builds the code as
-- 'FNB0' || nextval('broker_id_seq'), so the sequence has to hand back 5000 next --
-- setval(..., 5000, false) does that, where the `false` means "5000 has not been used
-- yet". Using setval(..., 4999, true) would be the same thing said the other way round.
--
-- THE GUARD IS THE POINT. If any Affiliate broker already exists, this refuses outright
-- rather than resetting into a range that is in use -- which would eventually mint a
-- duplicate code, and broker_id is UNIQUE, so the collision would surface as a failed
-- import days later with nothing explaining it.
--
-- sync_broker_id_sequences() will not undo this. It only moves a sequence when it finds
-- a matching code in the table (GREATEST of the highest code and the current value), and
-- with no FNB0 brokers it leaves this alone. After the first few are created it will
-- simply agree with them.
--
-- Traditional is untouched: TR820 is the highest, the sequence sits at 820, the next is
-- TR821, and that is correct.
--
-- Safe to run more than once while the Affiliate side is still empty.

BEGIN;

DO $guard$
DECLARE
  v_count   integer;
  v_highest text;
BEGIN
  IF to_regprocedure('public.is_staff()') IS NULL
     OR to_regclass('public.brokers') IS NULL THEN
    RAISE EXCEPTION '%',
      'Wrong Supabase project: public.is_staff() or public.brokers is missing here. '
      || 'Run this in Fanbe-CRM, project ref mfgjzkaabyltscgrkhdz. Nothing was changed.';
  END IF;

  SELECT count(*), max(broker_id) INTO v_count, v_highest
    FROM public.brokers WHERE broker_id ~ '^FNB0[0-9]+$';

  IF v_count > 0 THEN
    RAISE EXCEPTION '%',
      'STOPPED, nothing changed. ' || v_count || ' Affiliate broker(s) already exist, the '
      || 'highest being ' || v_highest || '. Resetting the counter now would hand out a code '
      || 'that is already taken, and broker_id is UNIQUE, so the clash would only show up '
      || 'later as a failed save. Renumber those brokers first, or leave the counter alone.';
  END IF;

  -- The next nextval() returns exactly 5000.
  PERFORM setval('broker_id_seq', 5000, false);
  RAISE NOTICE 'Done. The next Affiliate broker will be FNB05000.';
END
$guard$;

COMMIT;

-- Check it without consuming a number:
--
--   SELECT last_value, is_called FROM broker_id_seq;
--   -- expect last_value = 5000, is_called = false
--
-- After the first broker is created:
--
--   SELECT broker_id, name FROM brokers WHERE broker_id ~ '^FNB0' ORDER BY broker_id;
--   -- expect FNB05000 first
