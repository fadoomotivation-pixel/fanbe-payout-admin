-- The same project is in the system twice, and so are its 538 plots.
--
--   SHREE KUNJBIHARI ENCLAVE   25 June   538 plots   <- keep
--   shree kunj bihari enclave  16 Aug    538 plots   <- remove
--
-- WHY IT MATTERS. Nothing has been sold out of either copy yet, so no money is wrong.
-- But while both exist, the same real plot can be sold twice -- once from each copy --
-- and guard_plot_not_double_sold() will not catch it, because it guards by plot_id and
-- the two copies have different ids. Inventory and Analytics are also counting 538 plots
-- that do not exist.
--
-- WHY THE JUNE COPY. They are the same 538 plots, checked rather than assumed. 487 plot
-- numbers match outright. The other 51 differ only by a suffix the August re-import
-- dropped: June has "P-10(L)", August has "P-10". Strip the "(L)" and the two sets are
-- identical - no plot is in one copy and not the other, and not one size differs. So the
-- June copy is the original AND the more detailed one, and deleting the August copy
-- loses nothing at all.
--
-- WHAT THIS DELETES. One bp_projects row. Its 538 plots go with it through the existing
-- ON DELETE CASCADE, as do any commission rules. bp_bookings.plot_id and
-- bp_booking_plots.plot_id do NOT cascade, so a plot that had been sold would block the
-- delete outright rather than take a booking with it -- and the check below refuses to
-- run at all if anything is attached, instead of relying on that.
--
-- IT IS REVERSIBLE. Everything removed is copied into backup_20261018 first, with the
-- original ids, so it can be put back with two INSERT ... SELECT statements.
--
-- Safe to run more than once: the second run finds nothing to do and says so.

BEGIN;

-- Right database, or nothing.
DO $guard$
BEGIN
  IF to_regprocedure('public.is_staff()') IS NULL
     OR to_regclass('public.bp_projects') IS NULL THEN
    RAISE EXCEPTION '%',
      'Wrong Supabase project: public.is_staff() or public.bp_projects is missing here. '
      || 'Run this in Fanbe-CRM, project ref mfgjzkaabyltscgrkhdz. Nothing was changed.';
  END IF;
END
$guard$;

CREATE SCHEMA IF NOT EXISTS backup_20261018;

-- The copy being removed, named by id so no amount of renaming can point this at the
-- wrong one.
CREATE TABLE IF NOT EXISTS backup_20261018.removed_project AS
  SELECT * FROM public.bp_projects
   WHERE id = 'ddcf6785-2d74-401c-b47b-bc6042784982';

CREATE TABLE IF NOT EXISTS backup_20261018.removed_plots AS
  SELECT * FROM public.bp_plots
   WHERE project_id = 'ddcf6785-2d74-401c-b47b-bc6042784982';

-- Refuse if anything at all is attached. Checked when the plan was made, checked again
-- here, because the two are not the same moment and a booking could have landed between.
DO $check$
DECLARE
  v_bookings  integer;
  v_bkplots   integer;
  v_holds     integer;
  v_sold      integer;
  v_keep      integer;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.bp_projects
                  WHERE id = 'ddcf6785-2d74-401c-b47b-bc6042784982') THEN
    RAISE NOTICE 'Nothing to do: the duplicate project is already gone.';
    RETURN;
  END IF;

  SELECT count(*) INTO v_bookings FROM public.bp_bookings b
   WHERE b.project_id = 'ddcf6785-2d74-401c-b47b-bc6042784982'
      OR b.plot_id IN (SELECT id FROM public.bp_plots
                        WHERE project_id = 'ddcf6785-2d74-401c-b47b-bc6042784982');

  SELECT count(*) INTO v_bkplots FROM public.bp_booking_plots bp
   WHERE bp.plot_id IN (SELECT id FROM public.bp_plots
                         WHERE project_id = 'ddcf6785-2d74-401c-b47b-bc6042784982');

  SELECT count(*) INTO v_holds FROM public.bp_plot_hold_log h
   WHERE h.plot_id IN (SELECT id FROM public.bp_plots
                        WHERE project_id = 'ddcf6785-2d74-401c-b47b-bc6042784982');

  SELECT count(*) INTO v_sold FROM public.bp_plots
   WHERE project_id = 'ddcf6785-2d74-401c-b47b-bc6042784982'
     AND COALESCE(status, 'available') <> 'available';

  IF v_bookings > 0 OR v_bkplots > 0 OR v_holds > 0 OR v_sold > 0 THEN
    RAISE EXCEPTION '%',
      'STOPPED, nothing deleted. Work has been attached to the duplicate project since '
      || 'this was planned: ' || v_bookings || ' booking(s), ' || v_bkplots
      || ' booking-plot row(s), ' || v_holds || ' hold(s), ' || v_sold
      || ' plot(s) no longer available. Those plots are now the real ones. Move that work '
      || 'to the June copy by hand first, or keep this copy and remove the other instead.';
  END IF;

  -- And the copy being kept must actually still be there, or this would leave the
  -- project with no plots at all.
  SELECT count(*) INTO v_keep FROM public.bp_plots
   WHERE project_id = '751561b2-969a-4ca4-9877-5a7456e0f304';
  IF v_keep < 538 THEN
    RAISE EXCEPTION '%',
      'STOPPED, nothing deleted. The copy being kept (SHREE KUNJBIHARI ENCLAVE, 25 June) '
      || 'has ' || v_keep || ' plots, not the 538 expected. Check it before removing the other.';
  END IF;

  DELETE FROM public.bp_projects WHERE id = 'ddcf6785-2d74-401c-b47b-bc6042784982';
  RAISE NOTICE 'Removed the duplicate project and its 538 plots. Backup in backup_20261018.';
END
$check$;

COMMIT;

-- ---------------------------------------------------------------------------
-- After running, this should show ONE project with 538 plots:
--
--   SELECT p.name, p.created_at, count(pl.id) AS plots
--     FROM bp_projects p
--     LEFT JOIN bp_plots pl ON pl.project_id = p.id
--    WHERE lower(replace(p.name,' ','')) LIKE '%kunjbihari%'
--    GROUP BY p.name, p.created_at;
--
-- And nothing should be left in the backup's way:
--
--   SELECT count(*) FROM backup_20261018.removed_plots;   -- 538, kept for safety
--
-- TO PUT IT BACK, if it ever turns out to be wrong:
--
--   INSERT INTO public.bp_projects SELECT * FROM backup_20261018.removed_project;
--   INSERT INTO public.bp_plots    SELECT * FROM backup_20261018.removed_plots;
--
-- Once everyone is happy, the backup can go:
--
--   DROP SCHEMA backup_20261018 CASCADE;
