-- ═══════════════════════════════════════════════════════════════════════════
-- YOUR COMPANY — DEEP INDIAN DUMMY SEED for live bp_* tables
-- Goal: every nav page shows realistic data so admin can walk the workflow:
--   Inquiry → Member → Customer → Booking → Payment → Payout → Withdrawal
--
-- Each block is wrapped in DO $$ EXCEPTION WHEN OTHERS so that if a column
-- happens to differ on a deployment, the rest of the seed still applies.
-- All inserts use stable UUIDs + ON CONFLICT DO NOTHING (idempotent).
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── 1. bp_projects (live booking-flow projects) ────────────────────────
DO $do$ BEGIN
  insert into bp_projects (id, name, project_code) values
    ('aaaaaaa1-0000-0000-0000-000000000001','Brijvatika Awasiya Yojana',  'BVY-FBD'),
    ('aaaaaaa1-0000-0000-0000-000000000002','Green Valley Heights',         'GV-GGN'),
    ('aaaaaaa1-0000-0000-0000-000000000003','Royal Residency Park',      'RR-NDA'),
    ('aaaaaaa1-0000-0000-0000-000000000004','Sunrise City Township',         'SC-FBD'),
    ('aaaaaaa1-0000-0000-0000-000000000005','Yamuna Heights Phase 2',     'YH2-NDA')
  on conflict (id) do nothing;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'bp_projects skipped: %', sqlerrm; END $do$;

-- ─── 2. bp_plots ────────────────────────────────────────────────────────
DO $do$ BEGIN
  insert into bp_plots (id, project_id, plot_no, size_sqyd) values
    ('bbbbbbb1-0000-0000-0000-000000000001','aaaaaaa1-0000-0000-0000-000000000001','E-354',54),
    ('bbbbbbb1-0000-0000-0000-000000000002','aaaaaaa1-0000-0000-0000-000000000001','E-355',60),
    ('bbbbbbb1-0000-0000-0000-000000000003','aaaaaaa1-0000-0000-0000-000000000001','F-101',75),
    ('bbbbbbb1-0000-0000-0000-000000000004','aaaaaaa1-0000-0000-0000-000000000002','GV-A101',100),
    ('bbbbbbb1-0000-0000-0000-000000000005','aaaaaaa1-0000-0000-0000-000000000002','GV-A102',150),
    ('bbbbbbb1-0000-0000-0000-000000000006','aaaaaaa1-0000-0000-0000-000000000002','GV-B201',200),
    ('bbbbbbb1-0000-0000-0000-000000000007','aaaaaaa1-0000-0000-0000-000000000003','RR-C101',200),
    ('bbbbbbb1-0000-0000-0000-000000000008','aaaaaaa1-0000-0000-0000-000000000003','RR-D202',250),
    ('bbbbbbb1-0000-0000-0000-000000000009','aaaaaaa1-0000-0000-0000-000000000004','SC-K01',300),
    ('bbbbbbb1-0000-0000-0000-000000000010','aaaaaaa1-0000-0000-0000-000000000005','YH-101',180),
    ('bbbbbbb1-0000-0000-0000-000000000011','aaaaaaa1-0000-0000-0000-000000000005','YH-102',220),
    ('bbbbbbb1-0000-0000-0000-000000000012','aaaaaaa1-0000-0000-0000-000000000003','RR-E301',400)
  on conflict (id) do nothing;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'bp_plots skipped: %', sqlerrm; END $do$;

-- ─── 3. bp_customers (with father / DOB / nominee) ──────────────────────
DO $do$ BEGIN
  insert into bp_customers
    (id, customer_code, name, phone, email, address, pan, father_or_husband_name, dob,
     nominee_name, nominee_relation, nominee_dob, nominee_father_name, nominee_address, nominee_pan)
  values
    ('ccccccc1-0000-0000-0000-000000000001','FNB-CR-001','Aditya Kumar',      '6206320133','aditya.k@email.com','S/o Mahendra Pandit, Ballabgarh, Faridabad','ADBPK1234A','Mahendra Pandit','1992-04-15','Sunita Kumar','Mother','1968-08-10','Late Ram Pandit','Ballabgarh, Faridabad','SUNPK0001Z'),
    ('ccccccc1-0000-0000-0000-000000000002','FNB-CR-002','Priya Sharma',      '9811100002','priya.s@email.com','H.No. 24, Sector 50, Noida','PRYPK0002B','Vikas Sharma','1990-03-22','Vikas Sharma','Husband','1985-12-01','Late Suresh Sharma','Sector 50, Noida','VKSPK0002Y'),
    ('ccccccc1-0000-0000-0000-000000000003','FNB-CR-003','Anil Gupta',        '9811100003','anil.g@email.com','DLF Phase 3, Gurugram','ABCAG0003C','Mahesh Gupta','1985-06-19','Pooja Gupta','Wife','1990-09-15','Suresh Bansal','DLF Phase 3, Gurugram','POOGK0003X'),
    ('ccccccc1-0000-0000-0000-000000000004','FNB-CR-004','Sneha Iyer',        '9811100004','sneha.i@email.com','Flat 304, Kothrud, Pune','SNEPI0004D','Ramesh Iyer','1991-02-28','Ramesh Iyer','Father','1958-12-01','Late Krishna Iyer','Kothrud, Pune','RAMPI0004W'),
    ('ccccccc1-0000-0000-0000-000000000005','FNB-CR-005','Deepak Jain',       '9811100005','deepak.j@email.com','Aliganj, Lucknow','DEPJN0005E','Mukesh Jain','1980-09-10','Aarav Jain','Son','2008-05-11','Deepak Jain','Aliganj, Lucknow','AARJN0005V'),
    ('ccccccc1-0000-0000-0000-000000000006','FNB-CR-006','Kavita Mehta',      '9811100006','kavita.m@email.com','Civil Lines, Agra','KVTPM0006F','Rahul Mehta','1989-03-22','Rahul Mehta','Husband','1985-01-05','Hari Mehta','Civil Lines, Agra','RHLMK0006U'),
    ('ccccccc1-0000-0000-0000-000000000007','FNB-CR-007','Suresh Yadav',      '9811100007','suresh.y@email.com','Shastri Nagar, Meerut','SRSYV0007G','Devendra Yadav','1983-12-12','Pinky Yadav','Wife','1987-06-25','Karan Yadav','Shastri Nagar, Meerut','PNKYK0007T'),
    ('ccccccc1-0000-0000-0000-000000000008','FNB-CR-008','Anjali Trivedi',    '9811100008','anjali.t@email.com','Sigra, Varanasi','ANJTV0008H','Ashok Trivedi','1990-07-04','Ashok Trivedi','Husband','1985-10-30','Ram Trivedi','Sigra, Varanasi','ASKTK0008S'),
    ('ccccccc1-0000-0000-0000-000000000009','FNB-CR-009','Mohit Saxena',      '9811100009','mohit.s@email.com','Krishna Nagar, Mathura','MHTSX0009I','Kishore Saxena','1987-05-17','Riya Saxena','Daughter','2014-08-20','Mohit Saxena','Krishna Nagar, Mathura','RIYSK0009R'),
    ('ccccccc1-0000-0000-0000-000000000010','FNB-CR-010','Reena Agarwal',     '9811100010','reena.a@email.com','Karol Bagh, Delhi','RNAGL0010J','Ramesh Agarwal','1986-10-08','Ramesh Agarwal','Husband','1982-04-14','Lala Agarwal','Karol Bagh, Delhi','RMSAK0010Q'),
    ('ccccccc1-0000-0000-0000-000000000011','FNB-CR-011','Karthik Reddy',     '9812200011','karthik.r@email.com','Banjara Hills, Hyderabad','KTRDY0011K','Suresh Reddy','1988-07-21','Lakshmi Reddy','Wife','1990-11-08','Krishna Rao','Banjara Hills, Hyderabad','LKSPM0011P'),
    ('ccccccc1-0000-0000-0000-000000000012','FNB-CR-012','Imran Sheikh',      '9812200012','imran.s@email.com','Worli, Mumbai','IMRSH0012L','Akhtar Sheikh','1984-04-30','Fatima Sheikh','Wife','1988-09-19','Yusuf Khan','Worli, Mumbai','FTMSH0012N')
  on conflict (id) do nothing;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'bp_customers skipped: %', sqlerrm; END $do$;

-- ─── 4. brokers — fill sponsor_id chain + bank/KYC where missing ────────
DO $do$ BEGIN
  -- Top of tree: B01. Then B02,B03 under B01; B04,B05 under B02; etc.
  update brokers set sponsor_id=null,                                                date_of_joining='2023-04-01', bank_name='HDFC Bank',  account_no='50200012345001', ifsc='HDFC0001234', account_holder=name, aadhaar_no='5612-0001-0001' where broker_id='FNB-001';
  update brokers set sponsor_id=(select id from brokers where broker_id='FNB-001'), date_of_joining='2023-06-12', bank_name='SBI',        account_no='39876511112002', ifsc='SBIN0012345', account_holder=name, aadhaar_no='5612-0001-0002' where broker_id='FNB-002';
  update brokers set sponsor_id=(select id from brokers where broker_id='FNB-002'), date_of_joining='2023-08-15', bank_name='ICICI Bank', account_no='628705003003',   ifsc='ICIC0006287', account_holder=name, aadhaar_no='5612-0001-0003' where broker_id='FNB-003';
  update brokers set sponsor_id=(select id from brokers where broker_id='FNB-003'), date_of_joining='2024-01-20', bank_name='HDFC Bank',  account_no='50200012004004', ifsc='HDFC0001234', account_holder=name, aadhaar_no='5612-0001-0004' where broker_id='FNB-004';
  update brokers set sponsor_id=(select id from brokers where broker_id='FNB-002'), date_of_joining='2024-02-10', bank_name='Axis Bank',  account_no='91201005005005', ifsc='UTIB0000123', account_holder=name, aadhaar_no='5612-0001-0005' where broker_id='FNB-005';
  update brokers set sponsor_id=(select id from brokers where broker_id='FNB-003'), date_of_joining='2024-04-05', bank_name='PNB',        account_no='01234560006006', ifsc='PUNB0012345', account_holder=name, aadhaar_no='5612-0001-0006' where broker_id='FNB-006';
  update brokers set sponsor_id=(select id from brokers where broker_id='FNB-004'), date_of_joining='2024-06-18', bank_name='Kotak',      account_no='07210007007007', ifsc='KKBK0000456', account_holder=name, aadhaar_no='5612-0001-0007' where broker_id='FNB-007';
  update brokers set sponsor_id=(select id from brokers where broker_id='FNB-005'), date_of_joining='2024-08-25', bank_name='SBI',        account_no='39876508008008', ifsc='SBIN0023456', account_holder=name, aadhaar_no='5612-0001-0008' where broker_id='FNB-008';
  update brokers set sponsor_id=(select id from brokers where broker_id='FNB-005'), date_of_joining='2024-10-02', bank_name='HDFC Bank',  account_no='50200099009009', ifsc='HDFC0009988', account_holder=name, aadhaar_no='5612-0001-0009' where broker_id='FNB-009';
  update brokers set sponsor_id=(select id from brokers where broker_id='FNB-006'), date_of_joining='2024-11-12', bank_name='IDBI',       account_no='12340010010010', ifsc='IBKL0001234', account_holder=name, aadhaar_no='5612-0001-0010' where broker_id='FNB-010';
  update brokers set sponsor_id=(select id from brokers where broker_id='FNB-006'), date_of_joining='2025-01-08', bank_name='BOB',        account_no='56780011011011', ifsc='BARB0VJBANK', account_holder=name, aadhaar_no='5612-0001-0011' where broker_id='FNB-011';
  update brokers set sponsor_id=(select id from brokers where broker_id='FNB-007'), date_of_joining='2025-02-22', bank_name='Canara',     account_no='78900012012012', ifsc='CNRB0001234', account_holder=name, aadhaar_no='5612-0001-0012' where broker_id='FNB-012';
  update brokers set sponsor_id=(select id from brokers where broker_id='FNB-007'), date_of_joining='2025-03-15', bank_name='ICICI Bank', account_no='62870013013013', ifsc='ICIC0006287', account_holder=name, aadhaar_no='5612-0001-0013' where broker_id='FNB-013';
  update brokers set sponsor_id=(select id from brokers where broker_id='FNB-008'), date_of_joining='2025-05-30', bank_name='HDFC Bank',  account_no='50200014014014', ifsc='HDFC0001234', account_holder=name, aadhaar_no='5612-0001-0014' where broker_id='FNB-014';
  update brokers set sponsor_id=(select id from brokers where broker_id='FNB-008'), date_of_joining='2025-09-18', bank_name='SBI',        account_no='39876515015015', ifsc='SBIN0012345', account_holder=name, aadhaar_no='5612-0001-0015' where broker_id='FNB-015';
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'brokers update skipped: %', sqlerrm; END $do$;

-- ─── 5. bp_bookings (full application form data) ────────────────────────
DO $do$ BEGIN
  insert into bp_bookings
    (id, booking_no, plot_id, customer_id, broker_id, project_id,
     stage, total_amount, booking_amount, discount_amount,
     scheme_name, application_date, booking_time, customer_bank_name,
     upline_broker_code, manager_signature_by, affidavit_accepted,
     notes, created_at)
  values
    ('ddddddd1-0000-0000-0000-000000000001','FBK-2026-001','bbbbbbb1-0000-0000-0000-000000000001','ccccccc1-0000-0000-0000-000000000001',(select id from brokers where broker_id='FNB-008'),'aaaaaaa1-0000-0000-0000-000000000001','booking_done',432000, 90000,0,'Brijvatika Awasiya Yojana','2026-04-27','11:30','HDFC Bank','FNB-008','Nidhi Sharma',true,'Plot E-354, 54sqy. Receipt #6301 issued.','2026-04-27 11:30:00'),
    ('ddddddd1-0000-0000-0000-000000000002','FBK-2026-002','bbbbbbb1-0000-0000-0000-000000000002','ccccccc1-0000-0000-0000-000000000002',(select id from brokers where broker_id='FNB-009'),'aaaaaaa1-0000-0000-0000-000000000001','booking_done',480000,135000,0,'Brijvatika Awasiya Yojana','2026-04-15','15:00','SBI','FNB-009','Nidhi Sharma',true,'Plot E-355, 60sqy.','2026-04-15 15:00:00'),
    ('ddddddd1-0000-0000-0000-000000000003','FBK-2026-003','bbbbbbb1-0000-0000-0000-000000000004','ccccccc1-0000-0000-0000-000000000003',(select id from brokers where broker_id='FNB-005'),'aaaaaaa1-0000-0000-0000-000000000002','booking_done',450000,180000,0,'Green Valley Awasiya Yojana','2026-03-08','10:15','ICICI Bank','FNB-005','Vikram Rao',true,'Premium plot in Phase 1.','2026-03-08 10:15:00'),
    ('ddddddd1-0000-0000-0000-000000000004','FBK-2026-004','bbbbbbb1-0000-0000-0000-000000000007','ccccccc1-0000-0000-0000-000000000004',(select id from brokers where broker_id='FNB-005'),'aaaaaaa1-0000-0000-0000-000000000003','booking_done',760000,152000,0,'Royal Residency Awasiya Yojana','2026-02-14','13:45','Axis Bank','FNB-005','Vikram Rao',true,'200 sqy plot.','2026-02-14 13:45:00'),
    ('ddddddd1-0000-0000-0000-000000000005','FBK-2026-005','bbbbbbb1-0000-0000-0000-000000000008','ccccccc1-0000-0000-0000-000000000005',(select id from brokers where broker_id='FNB-006'),'aaaaaaa1-0000-0000-0000-000000000003','booking_done',950000,190000,0,'Royal Residency Awasiya Yojana','2026-01-20','17:20','HDFC Bank','FNB-006','Nidhi Sharma',true,'250 sqy.','2026-01-20 17:20:00'),
    ('ddddddd1-0000-0000-0000-000000000006','FBK-2026-006','bbbbbbb1-0000-0000-0000-000000000012','ccccccc1-0000-0000-0000-000000000006',(select id from brokers where broker_id='FNB-003'),'aaaaaaa1-0000-0000-0000-000000000003','booking_done',1520000,304000,0,'Royal Residency Awasiya Yojana','2026-01-05','09:30','PNB','FNB-003','Vikram Rao',true,'400 sqy showcase plot.','2026-01-05 09:30:00'),
    ('ddddddd1-0000-0000-0000-000000000007','FBK-2026-007','bbbbbbb1-0000-0000-0000-000000000005','ccccccc1-0000-0000-0000-000000000007',(select id from brokers where broker_id='FNB-002'),'aaaaaaa1-0000-0000-0000-000000000002','token_received',675000,135000,0,'Green Valley Awasiya Yojana','2026-04-22','14:10','Kotak','FNB-002','Vikram Rao',true,'Token received, awaiting full booking.','2026-04-22 14:10:00'),
    ('ddddddd1-0000-0000-0000-000000000008','FBK-2026-008','bbbbbbb1-0000-0000-0000-000000000010','ccccccc1-0000-0000-0000-000000000008',(select id from brokers where broker_id='FNB-008'),'aaaaaaa1-0000-0000-0000-000000000005','negotiation',680000,0,0,'Yamuna Heights Phase 2','2026-04-25','11:00','HDFC Bank','FNB-008','Nidhi Sharma',true,'Customer negotiating discount.','2026-04-25 11:00:00'),
    ('ddddddd1-0000-0000-0000-000000000009','FBK-2026-009','bbbbbbb1-0000-0000-0000-000000000011','ccccccc1-0000-0000-0000-000000000009',(select id from brokers where broker_id='FNB-005'),'aaaaaaa1-0000-0000-0000-000000000005','site_visit',836000,0,0,'Yamuna Heights Phase 2','2026-04-28','16:30','ICICI Bank','FNB-005','Vikram Rao',true,'Site visit scheduled.','2026-04-28 16:30:00'),
    ('ddddddd1-0000-0000-0000-000000000010','FBK-2026-010','bbbbbbb1-0000-0000-0000-000000000009','ccccccc1-0000-0000-0000-000000000010',(select id from brokers where broker_id='FNB-001'),'aaaaaaa1-0000-0000-0000-000000000004','enquiry',1500000,0,0,'Sunrise City Township','2026-04-30','10:00','SBI','FNB-001','Nidhi Sharma',true,'Initial enquiry.','2026-04-30 10:00:00')
  on conflict (id) do nothing;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'bp_bookings skipped: %', sqlerrm; END $do$;

-- ─── 6. bp_payments — receipt #6301 mirrors physical chit ───────────────
DO $do$ BEGIN
  insert into bp_payments
    (id, booking_id, payment_type, amount, payment_mode, utr_ref, payment_date, received_by, verification_status, verified_at,
     receipt_no, drawn_on_bank, branch, instalment_no, rupees_in_words, sponsor_name, is_cash_adjustment, subject_to_realisation, notes)
  values
    -- Aditya Kumar / Brijvatika E-354 — exact replica of physical receipt #6301
    ('eeeeeee1-0000-0000-0000-000000000001','ddddddd1-0000-0000-0000-000000000001','token',          7000,'cash','CASH-ADJ-6301','2026-04-27','Nidhi Sharma','verified','2026-04-27 12:00:00','6301','Cash Adjustment','BIB/LBD',1,'Seven Thousand only','Alok / Sanjeet',true, false,'Cash adj inst — receipt printed'),
    ('eeeeeee1-0000-0000-0000-000000000002','ddddddd1-0000-0000-0000-000000000001','booking',       83000,'neft','NEFT2026042702','2026-04-27','Nidhi Sharma','verified','2026-04-27 13:30:00','6302','HDFC Bank',     'Sector 12 Gurugram',1,'Eighty Three Thousand only','Alok / Sanjeet',false,true, 'Booking amount balance'),
    ('eeeeeee1-0000-0000-0000-000000000003','ddddddd1-0000-0000-0000-000000000001','emi',           90000,'cheque','CHQ2026073101','2026-07-31','Nidhi Sharma','unverified',null,           '6303','HDFC Bank',     'Sector 12 Gurugram',2,'Ninety Thousand only',     'Alok / Sanjeet',false,true, 'Inst 2'),
    -- Priya Sharma / Brijvatika E-355
    ('eeeeeee1-0000-0000-0000-000000000004','ddddddd1-0000-0000-0000-000000000002','booking',      135000,'upi', 'UPI2026041504','2026-04-15','Vikram Rao','verified','2026-04-15 16:30:00','6304','SBI',           'Noida Sector 50',   1,'One Lakh Thirty Five Thousand only','Pooja Arora',false,true, 'Booking amount'),
    ('eeeeeee1-0000-0000-0000-000000000005','ddddddd1-0000-0000-0000-000000000002','emi',          135000,'neft','NEFT2026071505','2026-07-15','Vikram Rao','unverified',null,           '6305','SBI',           'Noida Sector 50',   2,'One Lakh Thirty Five Thousand only','Pooja Arora',false,true, 'Inst 2'),
    -- Anil Gupta / Green Valley A-101
    ('eeeeeee1-0000-0000-0000-000000000006','ddddddd1-0000-0000-0000-000000000003','booking',      180000,'neft','NEFT2026030806','2026-03-08','Nidhi Sharma','verified','2026-03-08 11:00:00','6306','ICICI Bank',    'MG Road Gurugram',  1,'One Lakh Eighty Thousand only',     'Anjana Mishra',false,true, 'Booking amount'),
    ('eeeeeee1-0000-0000-0000-000000000007','ddddddd1-0000-0000-0000-000000000003','emi',          180000,'rtgs','RTGS2026060807','2026-06-08','Nidhi Sharma','verified','2026-06-08 13:00:00','6307','ICICI Bank',    'MG Road Gurugram',  2,'One Lakh Eighty Thousand only',     'Anjana Mishra',false,true, 'Inst 2'),
    ('eeeeeee1-0000-0000-0000-000000000008','ddddddd1-0000-0000-0000-000000000003','emi',          180000,'cheque','CHQ2026091208','2026-09-12','Nidhi Sharma','unverified',null,           '6308','ICICI Bank',    'MG Road Gurugram',  3,'One Lakh Eighty Thousand only',     'Anjana Mishra',false,true, 'Inst 3'),
    -- Sneha Iyer / Royal Residency C-101
    ('eeeeeee1-0000-0000-0000-000000000009','ddddddd1-0000-0000-0000-000000000004','booking',      152000,'upi', 'UPI2026021409','2026-02-14','Vikram Rao','verified','2026-02-14 14:30:00','6309','Axis Bank',     'Faridabad NIT',     1,'One Lakh Fifty Two Thousand only',  'Manisha Dubey',false,true, 'Booking amount'),
    ('eeeeeee1-0000-0000-0000-000000000010','ddddddd1-0000-0000-0000-000000000004','emi',          152000,'neft','NEFT2026051410','2026-05-14','Vikram Rao','verified','2026-05-14 15:00:00','6310','Axis Bank',     'Faridabad NIT',     2,'One Lakh Fifty Two Thousand only',  'Manisha Dubey',false,true, 'Inst 2'),
    -- Deepak Jain / Royal Residency D-202
    ('eeeeeee1-0000-0000-0000-000000000011','ddddddd1-0000-0000-0000-000000000005','booking',      190000,'cheque','CHQ2026012011','2026-01-20','Nidhi Sharma','verified','2026-01-21 09:00:00','6311','HDFC Bank',     'Hazratganj Lucknow',1,'One Lakh Ninety Thousand only',     'Rohit Kesarwani',false,true,'Booking amount'),
    ('eeeeeee1-0000-0000-0000-000000000012','ddddddd1-0000-0000-0000-000000000005','emi',          190000,'neft','NEFT2026042012','2026-04-20','Nidhi Sharma','verified','2026-04-20 11:00:00','6312','HDFC Bank',     'Hazratganj Lucknow',2,'One Lakh Ninety Thousand only',     'Rohit Kesarwani',false,true,'Inst 2'),
    -- Kavita Mehta / RR-E301 (big plot)
    ('eeeeeee1-0000-0000-0000-000000000013','ddddddd1-0000-0000-0000-000000000006','booking',      304000,'rtgs','RTGS2026010513','2026-01-05','Vikram Rao','verified','2026-01-05 10:00:00','6313','PNB',           'Sanjay Place Agra', 1,'Three Lakh Four Thousand only',     'Seema Tiwari',false,true,  'Booking amount'),
    ('eeeeeee1-0000-0000-0000-000000000014','ddddddd1-0000-0000-0000-000000000006','emi',          304000,'rtgs','RTGS2026040514','2026-04-05','Vikram Rao','verified','2026-04-05 10:00:00','6314','PNB',           'Sanjay Place Agra', 2,'Three Lakh Four Thousand only',     'Seema Tiwari',false,true,  'Inst 2'),
    -- Suresh Yadav / Green Valley A-102 (token-only)
    ('eeeeeee1-0000-0000-0000-000000000015','ddddddd1-0000-0000-0000-000000000007','token',         50000,'upi', 'UPI2026042215','2026-04-22','Vikram Rao','verified','2026-04-22 14:30:00','6315','Kotak',         'Connaught Place',   0,'Fifty Thousand only',                'Sandeep Rawat',false,true,'Token money')
  on conflict (id) do nothing;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'bp_payments skipped: %', sqlerrm; END $do$;

-- Bump the receipt counter so next receipt continues from 6316
DO $do$ BEGIN
  perform setval('bp_payments_receipt_seq', 6316, false);
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'sequence skipped: %', sqlerrm; END $do$;

-- ─── 7. registry_members — backfill new fields on existing rows ─────────
DO $do$ BEGIN
  update registry_members set father_or_husband_name='Mahendra Pandit', dob='1992-04-15', nominee_name='Sunita Kumar', nominee_relation='Mother',  nominee_dob='1968-08-10', nominee_father_name='Late Ram Pandit', nominee_address='Ballabgarh, Faridabad', nominee_pan='SUNPK0001Z' where mobile='6206320133';
  update registry_members set father_or_husband_name='Bhanu Pratap',    dob='1991-07-12', nominee_name='Ravi Yadav',  nominee_relation='Husband', nominee_dob='1986-03-04', nominee_father_name='Suresh Yadav',     nominee_address='Sector 21, Faridabad',   nominee_pan='RVPYK0002Y' where member_code='MEM-002';
  update registry_members set father_or_husband_name='Rajesh Tripathi', dob='1983-09-08', nominee_name='Anita Tripathi', nominee_relation='Wife', nominee_dob='1986-12-19', nominee_father_name='Mohan Tripathi',   nominee_address='Aliganj, Lucknow',       nominee_pan='ANTRP0003Z' where member_code='MEM-003';
  update registry_members set father_or_husband_name='Suresh Iyer',     dob='1995-04-22', nominee_name='Suresh Iyer', nominee_relation='Father', nominee_dob='1962-08-12', nominee_father_name='Late Krishna Iyer',nominee_address='Kothrud, Pune',          nominee_pan='SRSIY0004W' where member_code='MEM-004';
  update registry_members set father_or_husband_name='Devendra Yadav',  dob='1986-11-30', nominee_name='Pinky Yadav', nominee_relation='Wife',   nominee_dob='1989-02-14', nominee_father_name='Karan Yadav',      nominee_address='Civil Lines, Agra',      nominee_pan='PNKYK0005V' where member_code='MEM-005';
  update registry_members set father_or_husband_name='Vasanth Narayanan',dob='1984-12-19', nominee_name='Sundar Narayanan', nominee_relation='Husband', nominee_dob='1981-06-25', nominee_father_name='Krishnan Iyer', nominee_address='T Nagar, Chennai',     nominee_pan='SNRYK0006U' where member_code='MEM-006';
  update registry_members set father_or_husband_name='Akhtar Sheikh',   dob='1985-08-15', nominee_name='Fatima Sheikh', nominee_relation='Wife', nominee_dob='1989-01-09', nominee_father_name='Yusuf Khan',       nominee_address='Banjara Hills, Hyderabad',nominee_pan='FTMSH0007T' where member_code='MEM-007';
  update registry_members set father_or_husband_name='Pradeep Kulkarni',dob='1996-03-10', nominee_name='Pradeep Kulkarni', nominee_relation='Father', nominee_dob='1965-11-20', nominee_father_name='Late Vinayak Kulkarni', nominee_address='Andheri East, Mumbai', nominee_pan='PRDKL0008S' where member_code='MEM-008';
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'registry_members backfill skipped: %', sqlerrm; END $do$;

-- ─── 8. inquiries — add a few more diverse leads ────────────────────────
DO $do$ BEGIN
  insert into inquiries (id, name, mobile, email, agent_code, source, status, notes, created_at) values
    ('q100-0014','Yashika Bansal',  '9812200014','yashika.b@email.com','FNB-002','website','new',       'Asked about Brijvatika 60sqy plot pricing.','2026-04-29 10:30:00'),
    ('q100-0015','Tariq Ansari',    '9812200015','tariq.a@email.com',  'FNB-006','social',  'contacted','Wants 3-plot bundle in Sunrise City.',      '2026-04-28 14:00:00'),
    ('q100-0016','Devika Rao',      '9812200016','devika.r@email.com', 'FNB-007','referral','qualified','Pre-approved home loan from HDFC.',          '2026-04-27 16:45:00'),
    ('q100-0017','Amitabh Joshi',   '9812200017',null,                 'FNB-013','walk_in', 'new',      'Walked in to Faridabad office.',             '2026-04-30 11:00:00'),
    ('q100-0018','Lakshmi Pillai',  '9812200018','lakshmi.p@email.com','FNB-008','website','converted', 'Converted to FBK-2026-001.',                 '2026-04-15 09:00:00')
  on conflict do nothing;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'inquiries skipped: %', sqlerrm; END $do$;

-- ═══════════════════════════════════════════════════════════════════════════
-- END
-- ═══════════════════════════════════════════════════════════════════════════
