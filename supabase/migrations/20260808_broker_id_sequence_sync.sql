-- Admin: "traditional broker ki id lagani hai jo purane broker hain, wo Excel se aa
-- jayein -- ek ek karke bohot time lagega."
--
-- Bulk-importing legacy brokers means supplying broker_id values that already exist on
-- paper.  assign_broker_id() only fills a blank broker_id, so those survive the insert
-- untouched -- but the SEQUENCES behind the auto-generated ids know nothing about them.
--
-- Live example: traditional brokers run TR805..TR813 and broker_id_tr_seq sits at 813.
-- Import TR814..TR900 from Excel and the next broker created through the UI draws 814,
-- which is now taken -- brokers_broker_id_key blows up, and it blows up for whoever
-- adds the NEXT broker, not for the person who did the import.  Classic delayed-blast
-- bug.
--
-- This function pushes each sequence past the highest id actually on the table.  The
-- importer calls it after every run, so the sequences can never fall behind.
--
--   TR<n>    -> broker_id_tr_seq   (traditional)
--   FNB0<n>  -> broker_id_seq      (MLM; 'FNB0' || n, so FNB05092 means n = 5092)
--
-- Ids that don't match those shapes (a legacy code like "AGENT-42") are ignored: they
-- never come out of a sequence, so they can't collide with one.

CREATE OR REPLACE FUNCTION public.sync_broker_id_sequences()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_max_tr  bigint;
  v_max_fnb bigint;
BEGIN
  SELECT max((substring(broker_id from '^TR([0-9]+)$'))::bigint)
    INTO v_max_tr
    FROM public.brokers
   WHERE broker_id ~ '^TR[0-9]+$';

  SELECT max((substring(broker_id from '^FNB0([0-9]+)$'))::bigint)
    INTO v_max_fnb
    FROM public.brokers
   WHERE broker_id ~ '^FNB0[0-9]+$';

  -- GREATEST against the sequence's own value so we only ever move forward: a sequence
  -- that is already ahead (ids handed out but rows deleted) must not be rewound.
  IF v_max_tr IS NOT NULL THEN
    PERFORM setval('broker_id_tr_seq', GREATEST(v_max_tr, (SELECT last_value FROM broker_id_tr_seq)), true);
  END IF;

  IF v_max_fnb IS NOT NULL THEN
    PERFORM setval('broker_id_seq', GREATEST(v_max_fnb, (SELECT last_value FROM broker_id_seq)), true);
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.sync_broker_id_sequences() TO authenticated;

-- Bring both sequences in line with whatever is already on the table today.
SELECT public.sync_broker_id_sequences();
