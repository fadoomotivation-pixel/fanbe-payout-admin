-- Admin: "multiple plots select karne ka option do -- abhi sirf single plot select kar
-- paa rahe hain, agar kisi ne do plot liye hain to uska option nahi hai."
--
-- bp_bookings.plot_id holds exactly one plot, so a customer buying two plots needed two
-- separate bookings (two IDs, split payments, split commission).  This adds a join table
-- so one booking can carry as many plots as the customer actually bought.
--
-- bp_bookings.plot_id is deliberately KEPT and always points at position 1.  Every
-- existing read path (bookings list, payouts, reports, receipts, printTemplates) joins
-- through it, so leaving it populated means nothing downstream has to change at once --
-- the extra plots simply live alongside it.
--
-- Shape note: surrogate uuid PK + UNIQUE(booking_id, plot_id) mirrors bp_booking_brokers,
-- which sits between bp_bookings and brokers in exactly the same way.  Direct
-- `brokers(...)` embeds off bp_bookings still resolve with that table in place, so the
-- existing `bp_plots(...)` embeds stay unambiguous with this one in place too.

CREATE TABLE IF NOT EXISTS public.bp_booking_plots (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id  uuid NOT NULL REFERENCES public.bp_bookings(id) ON DELETE CASCADE,
  plot_id     uuid NOT NULL REFERENCES public.bp_plots(id),
  position    integer NOT NULL DEFAULT 1 CHECK (position >= 1),
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (booking_id, plot_id)
);

CREATE INDEX IF NOT EXISTS idx_bp_booking_plots_booking ON public.bp_booking_plots(booking_id);
CREATE INDEX IF NOT EXISTS idx_bp_booking_plots_plot    ON public.bp_booking_plots(plot_id);

ALTER TABLE public.bp_booking_plots ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_select ON public.bp_booking_plots;
DROP POLICY IF EXISTS p_insert ON public.bp_booking_plots;
DROP POLICY IF EXISTS p_update ON public.bp_booking_plots;
DROP POLICY IF EXISTS p_delete ON public.bp_booking_plots;
CREATE POLICY p_select ON public.bp_booking_plots FOR SELECT TO authenticated USING (true);
CREATE POLICY p_insert ON public.bp_booking_plots FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY p_update ON public.bp_booking_plots FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY p_delete ON public.bp_booking_plots FOR DELETE TO authenticated USING (true);

-- Backfill: every existing booking's single plot becomes its position-1 row, so the new
-- table is the complete picture from day one and the UI never has to fall back.
INSERT INTO public.bp_booking_plots (booking_id, plot_id, position)
SELECT b.id, b.plot_id, 1
  FROM public.bp_bookings b
 WHERE b.plot_id IS NOT NULL
ON CONFLICT (booking_id, plot_id) DO NOTHING;
