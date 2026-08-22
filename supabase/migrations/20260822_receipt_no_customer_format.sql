-- Receipt number format: <First 2 letters of name><customer code number>/<receipt count>
-- Example: Mu780/1  (Mukesh, CR-0780, 1st receipt)

CREATE OR REPLACE FUNCTION public.generate_receipt_no(p_customer_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_name   text;
  v_code   text;
  v_prefix text;
  v_num    text;
  v_count  int;
BEGIN
  SELECT name, customer_code INTO v_name, v_code
  FROM public.bp_customers WHERE id = p_customer_id;

  IF v_name IS NULL THEN
    RETURN public.next_receipt_no();
  END IF;

  -- First 2 letters of name: uppercase first, lowercase second
  v_name := regexp_replace(v_name, '[^a-zA-Z]', '', 'g');
  v_prefix := upper(left(v_name, 1)) || lower(substring(v_name from 2 for 1));

  -- Numeric part of customer_code (CR-0072 → 72)
  v_num := ltrim(regexp_replace(coalesce(v_code, '0'), '[^0-9]', '', 'g'), '0');
  IF v_num = '' THEN v_num := '0'; END IF;

  -- Count existing receipts for this customer
  SELECT count(*) INTO v_count
  FROM public.bp_payments
  WHERE customer_id = p_customer_id
    AND receipt_no IS NOT NULL;

  RETURN v_prefix || v_num || '/' || (v_count + 1);
END;
$$;

GRANT EXECUTE ON FUNCTION public.generate_receipt_no(uuid) TO anon, authenticated, service_role;

-- Update pdc_clear_cheque to use the new format
CREATE OR REPLACE FUNCTION public.pdc_clear_cheque(p_cheque_id uuid, p_cleared_on date DEFAULT CURRENT_DATE)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  c          record;
  v_payment  uuid;
  v_receipt  text;
  v_sponsor  text;
BEGIN
  SELECT * INTO c FROM public.bp_pdc_cheques WHERE id = p_cheque_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Cheque not found';
  END IF;
  IF c.payment_id IS NOT NULL OR c.status = 'cleared' THEN
    RAISE EXCEPTION 'This cheque is already marked cleared -- no second payment was created.';
  END IF;
  IF c.status = 'cancelled' THEN
    RAISE EXCEPTION 'This cheque was cancelled. Re-enter it as a new cheque instead.';
  END IF;

  SELECT b.name INTO v_sponsor
    FROM public.bp_bookings bk
    LEFT JOIN public.brokers b ON b.id = bk.broker_id
   WHERE bk.id = c.booking_id;

  v_receipt := public.generate_receipt_no(c.customer_id);

  INSERT INTO public.bp_payments (
    booking_id, customer_id, payment_type, amount, payment_mode,
    cheque_no, bank_name, drawn_on_bank, branch,
    payment_date, verification_status, verified_at, receipt_no,
    subject_to_realisation, sponsor_name, notes
  ) VALUES (
    c.booking_id, c.customer_id, c.payment_type, c.amount, 'cheque',
    c.cheque_no, c.bank_name, c.bank_name, c.branch,
    p_cleared_on, 'verified', now(), v_receipt,
    false, v_sponsor,
    'Cleared PDC cheque ' || c.cheque_no
  )
  RETURNING id INTO v_payment;

  UPDATE public.bp_pdc_cheques
     SET status = 'cleared', cleared_on = p_cleared_on, payment_id = v_payment,
         bounce_reason = NULL
   WHERE id = c.id;

  RETURN v_payment;
END;
$$;
