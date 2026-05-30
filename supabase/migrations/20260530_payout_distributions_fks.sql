-- BUG FIX: BrokerDashboard showed "Earned (distributed) ₹0" even though payout_distributions
-- had 20 rows totalling ₹22,872.48 for Fanbe Admin (FNB-05000).
--
-- Root cause: payout_distributions had NO foreign keys to bp_bookings / bp_payments / brokers.
-- The dashboard's PostgREST query
--   .select('*, bp_bookings(booking_no, bp_customers(name), bp_plots(plot_no))')
-- requires PostgREST to introspect a foreign-key relationship to build the embed.  Without an
-- FK, PostgREST returns an error which the client swallows as an empty array -> totalEarned = 0.
--
-- Fix: add the missing FK constraints + reload the PostgREST schema cache so embedded SELECTs
-- against payout_distributions resolve correctly across the entire app (BrokerDashboard,
-- Payouts page, BrokerStatement, future panels, etc.).
--
-- Orphan check already ran: zero orphan rows for booking_id / payment_id / beneficiary_broker_id.

ALTER TABLE public.payout_distributions
  ADD CONSTRAINT payout_distributions_booking_id_fkey
  FOREIGN KEY (booking_id) REFERENCES public.bp_bookings(id) ON DELETE CASCADE;

ALTER TABLE public.payout_distributions
  ADD CONSTRAINT payout_distributions_payment_id_fkey
  FOREIGN KEY (payment_id) REFERENCES public.bp_payments(id) ON DELETE CASCADE;

ALTER TABLE public.payout_distributions
  ADD CONSTRAINT payout_distributions_beneficiary_broker_id_fkey
  FOREIGN KEY (beneficiary_broker_id) REFERENCES public.brokers(id) ON DELETE CASCADE;

-- Tell PostgREST to refresh its schema cache so it picks up the new relationships immediately.
NOTIFY pgrst, 'reload schema';
