-- Admin: "traditional me ID lag rahi thi import kar ke, MLM me kaise lag gayi?
-- arvind kumar CR se hai, abcd FNB05074-7 se kaise ho gaya?"
--
-- What happened: the old-bookings importer matched customers on phone alone.  The sheet
-- carried the placeholder 9999999999 on several rows, and one existing customer already
-- had that number — so eight different buyers were all attached to that single customer
-- record.  That customer is also an MLM broker, so sync_customer_code_with_broker() had
-- rewritten their customer_code to the broker code FNB05074, and generate_booking_no()
-- derives booking_no from the customer's code — hence FNB05074-2 … FNB05074-9 on
-- bookings that were meant to be plain imported history.
--
-- The ID was the visible symptom; the merge was the actual damage.  Eight separate sales
-- shared one customer, so that customer's history, balances and the broker's own record
-- were all wrong.
--
-- The importer is fixed separately (phone must be a real number AND the name must agree
-- before an existing customer is reused).  This migration repairs what already landed.
--
-- Scope is deliberately narrow and auditable: only bookings that are BOTH imported
-- (legacy_booking_no is set) AND carrying an FNB-derived number.  Nothing else is
-- touched.
--
-- The names from those sheet rows were never written to the database — the importer
-- reused the existing customer and discarded them — so they cannot be recovered here.
-- Each booking gets its own customer named after its old register number, so admin can
-- match them line by line against the sheet and correct the names and phones.  Leaving
-- them merged would be worse: eight buyers under one identity, on a real broker's record.

DO $$
DECLARE
  r        record;
  v_cust   uuid;
  v_code   text;
BEGIN
  FOR r IN
    SELECT b.id, b.legacy_booking_no, b.booking_no
      FROM public.bp_bookings b
     WHERE b.legacy_booking_no IS NOT NULL
       AND b.booking_no ~ '^FNB'
     ORDER BY b.created_at
  LOOP
    -- Phone is left empty on purpose.  Writing the placeholder back would let a future
    -- import merge these together all over again; blank never matches anything.
    INSERT INTO public.bp_customers (name, phone)
    VALUES ('NAME MISSING — old booking ' || r.legacy_booking_no, '')
    RETURNING id, customer_code INTO v_cust, v_code;

    UPDATE public.bp_bookings
       SET customer_id = v_cust,
           booking_no  = v_code,
           updated_at  = now()
     WHERE id = r.id;

    -- Any receipt written by the import belongs to the booking's new owner too, or the
    -- payment would still read against the broker's customer record.
    UPDATE public.bp_payments
       SET customer_id = v_cust
     WHERE booking_id = r.id;
  END LOOP;
END $$;
