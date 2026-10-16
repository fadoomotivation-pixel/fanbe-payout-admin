-- Two things, both about money.
--
-- 1. LET A TEAM SPLIT BE DEEPER THAN THREE PEOPLE.
--
-- bp_booking_brokers.position carries CHECK (position >= 1 AND position <= 3), from when
-- the split was "the broker plus up to two helpers". Yesterday's team commission walks the
-- whole sponsor chain, and the chain the office actually asked for is four deep:
--
--   PRAGYA sold it (position 1), SHASHI (2), ALOK (3), VAIDEHI (4)
--
-- Position 4 is refused by that check. Postgres rejects the INSERT, and because the rows
-- go in as one statement the WHOLE team is lost -- the booking saves, the form says the
-- split could not be recorded, and VAIDEHI, ALOK and SHASHI are paid nothing. Verified
-- against this database: an insert at position 4 comes back check_violation.
--
-- So the ceiling moves to 15, which is not a guess: it is the safety cap
-- recompute_booking_payouts() already uses on its own walk up the sponsors, so the split
-- can now be exactly as deep as the engine is willing to climb, and no deeper.
--
-- The lower bound stays at 1. Position 1 is the broker who sold it, and the engine reads
-- `level = position - 1`, so a position of 0 would file the seller as an upline.
--
--
-- 2. KEEP A HANDOVER FROM PAYING TWO PEOPLE FOR ONE SHARE.
--
-- Manisha: "Koi agent chod k chala gya aur uska customer hum kisi aur ko assign krke...
-- krde." Handing a booking over moves bp_bookings.broker_id, and on a traditional split
-- it must move the bp_booking_brokers row too -- the engine pays those rows and ignores
-- the booking's own broker entirely, so moving only the booking would leave the agent who
-- left still earning.
--
-- UNIQUE (booking_id, broker_id) means that when the new agent is ALREADY on the booking,
-- the old row cannot simply be repointed at them. The app merges instead: the two
-- percentages are added into the row the new agent already has, and the old row is
-- deleted. The booking pays exactly what it paid before; one person now holds both
-- shares, which is what a handover means. That merge can push a single row over 100,
-- which the commission_pct check would refuse -- and refusing is correct, because a
-- booking paying more than 100% of every instalment is a mistake, not a handover. The app
-- checks for it first and names the booking rather than letting the save fail.
--
-- Nothing here changes a single existing row. Both are constraint changes only.
--
-- Plain ASCII, short lines. Safe to run more than once.

BEGIN;

-- Refuse to run anywhere but the payout database.
DO $guard$
BEGIN
  IF to_regprocedure('public.is_staff()') IS NULL
     OR to_regclass('public.bp_booking_brokers') IS NULL THEN
    RAISE EXCEPTION '%',
      'Wrong Supabase project: public.is_staff() or public.bp_booking_brokers is missing '
      || 'here. Run this in Fanbe-CRM, project ref mfgjzkaabyltscgrkhdz. '
      || 'Nothing was changed.';
  END IF;
END
$guard$;

-- Widen the depth. Dropped and recreated rather than altered because a CHECK cannot be
-- edited in place; IF EXISTS so a re-run is harmless.
ALTER TABLE public.bp_booking_brokers
  DROP CONSTRAINT IF EXISTS bp_booking_brokers_position_check;

ALTER TABLE public.bp_booking_brokers
  ADD CONSTRAINT bp_booking_brokers_position_check
  CHECK (position >= 1 AND position <= 15);

COMMENT ON COLUMN public.bp_booking_brokers.position IS
  'Where this broker sits on the sale. 1 is the broker who sold it; 2 and up are the team '
  'above them, in order. Capped at 15 to match the sponsor walk in '
  'recompute_booking_payouts(), which reads level = position - 1.';

COMMIT;

-- After running, a four-deep team saves. To check the ceiling moved:
--
--   SELECT pg_get_constraintdef(oid)
--     FROM pg_constraint
--    WHERE conname = 'bp_booking_brokers_position_check';
--   -- expect: CHECK (position >= 1 AND position <= 15)
--
-- And to see a saved team on a booking:
--
--   SELECT bb.position, br.name, bb.commission_pct
--     FROM bp_booking_brokers bb
--     JOIN brokers br ON br.id = bb.broker_id
--    WHERE bb.booking_id = '<booking id>'
--    ORDER BY bb.position;
