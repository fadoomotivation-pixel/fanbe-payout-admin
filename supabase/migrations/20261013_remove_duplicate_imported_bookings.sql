-- Remove the bookings the import made twice and three times.
--
-- Admin: "Ha duplicate hatao".
--
-- WHAT HAPPENED. The Import button stayed on screen after a run, still reading
-- "Import 20 bookings" and still enabled. Manisha pressed it three times
-- because the window would not close, and each press imported the whole sheet
-- again. 45 entries from the old register became 99 bookings: 37 old ids have
-- copies, 53 rows are copies.
--
-- WHY THIS IS SAFE TO RUN. Checked against the live data first, not assumed:
-- the rows being removed carry 0 payments, 0 commission rows, 0 EMI schedules,
-- 0 upline rows, 0 receipts and 0 ledger entries. Nothing in the call-centre
-- CRM points at them either - 0 rows in calls. No money has moved against a
-- single one of them.
--
-- WHICH COPY IS KEPT, AND WHY IT IS NOT SIMPLY THE OLDEST. Manisha has been
-- working on the NEWEST copy: all 50 PDC cheques for TR-448 sit on CR-0942,
-- the third copy, entered on 13 Oct. Keeping the oldest would have thrown her
-- day away. So the keeper is the copy with work attached to it - cheques,
-- payments, plots, uplines, EMI, receipts - and only where nothing is attached
-- to any copy does it fall back to the oldest. For TR-448 that keeps CR-0942.
--
-- THE CUSTOMERS GO TOO. Each duplicate booking created its own customer row,
-- 53 of them, and not one is used by a booking we are keeping. They are
-- deleted only when nothing at all still points at them - no booking, no
-- payment, no cheque, no ledger, no call, no broker, no EMI schedule.
--
-- IT IS REVERSIBLE. Every deleted row is copied into schema backup_20261013
-- first. If anything looks wrong afterwards the rows can be read straight back
-- out of backup_20261013.dup_bookings and .dup_customers.
--
-- The whole thing is one transaction: it either all happens or none of it does.
--
-- RE-RUNNABLE. This first used a TEMP table to hold the list of copies, which
-- only exists for one transaction - so running the file a second time, or
-- running part of it with text selected in the editor, failed with
-- 'relation "_dupes" does not exist'. The list is now a real table,
-- backup_20261013.dup_plan, which doubles as the record of exactly what was
-- removed and why. Running this again on clean data now does nothing at all.
--
-- Plain ASCII, short lines, no long rules. A banner of repeated punctuation has
-- already cost us one failed paste on a phone.

BEGIN;

-- Refuse to run anywhere but the payout database. This script was once pasted
-- into the other Supabase project on this account and applied there perfectly.
DO $guard$
BEGIN
  IF to_regprocedure('public.is_staff()') IS NULL
     OR to_regclass('public.bp_bookings') IS NULL THEN
    RAISE EXCEPTION '%',
      'Wrong Supabase project: public.is_staff() or public.bp_bookings is '
      || 'missing here. Run this in Fanbe-CRM, project ref '
      || 'mfgjzkaabyltscgrkhdz. Nothing was changed.';
  END IF;
END
$guard$;

CREATE SCHEMA IF NOT EXISTS backup_20261013;

-- The copies to remove: everything that is not the keeper for its old id.
-- A real table, not a temp one: it must survive to the next statement, and it
-- is worth keeping as the record of what was taken out.
CREATE TABLE IF NOT EXISTS backup_20261013.dup_plan AS
WITH work AS (
  SELECT b.id, b.booking_no, b.legacy_booking_no, b.customer_id, b.created_at,
         (SELECT count(*) FROM public.bp_pdc_cheques      c WHERE c.booking_id = b.id)
       + (SELECT count(*) FROM public.bp_payments         p WHERE p.booking_id = b.id)
       + (SELECT count(*) FROM public.bp_booking_plots    y WHERE y.booking_id = b.id)
       + (SELECT count(*) FROM public.bp_booking_brokers  x WHERE x.booking_id = b.id)
       + (SELECT count(*) FROM public.bp_emi_schedule     e WHERE e.booking_id = b.id)
       + (SELECT count(*) FROM public.bp_booking_receipts r WHERE r.booking_id = b.id)
         AS attached
    FROM public.bp_bookings b
   WHERE b.legacy_booking_no IS NOT NULL
),
ranked AS (
  SELECT w.*,
         row_number() OVER (PARTITION BY legacy_booking_no
                            ORDER BY attached DESC, created_at, booking_no) AS rn
    FROM work w
)
SELECT id, booking_no, legacy_booking_no, customer_id, attached
  FROM ranked
 WHERE rn > 1;

-- Nothing attached may be lost. If a copy being removed still carries a cheque
-- or a payment, stop and change nothing rather than quietly delete it.
DO $check$
DECLARE n bigint;
BEGIN
  SELECT coalesce(sum(attached), 0) INTO n FROM backup_20261013.dup_plan;
  IF n > 0 THEN
    RAISE EXCEPTION '%',
      'Refusing to continue: ' || n || ' attached rows (cheques, payments, '
      || 'plots, uplines, EMI or receipts) hang off copies marked for removal. '
      || 'Nothing was changed.';
  END IF;
END
$check$;

CREATE TABLE IF NOT EXISTS backup_20261013.dup_bookings AS
  SELECT b.* FROM public.bp_bookings b
   WHERE b.id IN (SELECT id FROM backup_20261013.dup_plan);

CREATE TABLE IF NOT EXISTS backup_20261013.dup_customers AS
  SELECT c.* FROM public.bp_customers c
   WHERE c.id IN (SELECT customer_id FROM backup_20261013.dup_plan WHERE customer_id IS NOT NULL)
     AND NOT EXISTS (
       SELECT 1 FROM public.bp_bookings b
        WHERE b.customer_id = c.id
          AND b.id NOT IN (SELECT id FROM backup_20261013.dup_plan));

DELETE FROM public.bp_bookings WHERE id IN (SELECT id FROM backup_20261013.dup_plan);

DELETE FROM public.bp_customers c
 WHERE c.id IN (SELECT id FROM backup_20261013.dup_customers)
   AND NOT EXISTS (SELECT 1 FROM public.bp_bookings        b WHERE b.customer_id = c.id)
   AND NOT EXISTS (SELECT 1 FROM public.bp_payments        p WHERE p.customer_id = c.id)
   AND NOT EXISTS (SELECT 1 FROM public.bp_pdc_cheques     d WHERE d.customer_id = c.id)
   AND NOT EXISTS (SELECT 1 FROM public.bp_customer_ledger l WHERE l.customer_id = c.id)
   AND NOT EXISTS (SELECT 1 FROM public.calls              k WHERE k.customer_id = c.id)
   AND NOT EXISTS (SELECT 1 FROM public.brokers           br WHERE br.customer_id = c.id)
   AND NOT EXISTS (SELECT 1 FROM public.emi_schedules      e WHERE e.customer_id = c.id);

COMMIT;

-- After running, these should read 45 bookings, 0 duplicated old ids, and the
-- 50 cheques still on CR-0942:
--
--   SELECT count(*) FROM public.bp_bookings;
--   SELECT count(*) FROM (SELECT legacy_booking_no FROM public.bp_bookings
--                          WHERE legacy_booking_no IS NOT NULL
--                          GROUP BY 1 HAVING count(*) > 1) d;
--   SELECT count(*) FROM public.bp_pdc_cheques c
--     JOIN public.bp_bookings b ON b.id = c.booking_id
--    WHERE b.booking_no = 'CR-0942';
--
-- To undo:
--   INSERT INTO public.bp_customers SELECT * FROM backup_20261013.dup_customers;
--   INSERT INTO public.bp_bookings  SELECT * FROM backup_20261013.dup_bookings;
