-- ═══════════════════════════════════════════════════════════════════════════
-- FANBE GROUP — WORKFLOW ALIGNMENT WITH PHYSICAL APPLICATION FORM & RECEIPT
-- Mirrors: आवासीय भू-खण्ड योजना आवेदन-पत्र  +  FANBE DEVELOPERS receipt #6301
-- Adds: nominee, father/husband, DOB on customers/bookings;
--       receipt detail fields on payments (drawn-on bank, branch, instalment no);
--       registry_members seed;  emi schedules + instalments seed;
--       more inquiries / withdrawals / expenses / announcements with Indian data.
-- Safe to re-run: all DDL is "if not exists" / "add column if not exists";
-- all DML uses fixed UUIDs with "on conflict do nothing".
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── 1. SCHEMA EXTENSIONS (idempotent) ───────────────────────────────────
alter table customers
  add column if not exists father_or_husband_name text,
  add column if not exists dob                    date,
  add column if not exists nominee_name           text,
  add column if not exists nominee_relation       text,
  add column if not exists nominee_dob            date,
  add column if not exists nominee_father_name    text,
  add column if not exists nominee_address        text,
  add column if not exists nominee_pan            text;

alter table bookings
  add column if not exists scheme_name            text,
  add column if not exists application_date       date,
  add column if not exists booking_time           time,
  add column if not exists customer_bank_name     text,
  add column if not exists upline_broker_code     text,
  add column if not exists manager_signature_by   text,
  add column if not exists affidavit_accepted     boolean default true;

alter table payments
  add column if not exists receipt_no             text,
  add column if not exists drawn_on_bank          text,
  add column if not exists branch                 text,
  add column if not exists instalment_no          int,
  add column if not exists rupees_in_words        text,
  add column if not exists sponsor_name           text,
  add column if not exists is_cash_adjustment     boolean default false,
  add column if not exists subject_to_realisation boolean default true;

-- ─── 2. REGISTRY MEMBERS (Members navigation — was empty) ───────────────
insert into registry_members
  (id, member_code, name, mobile, email, city, state, address, aadhaar, pan, marital_status, is_customer)
values
  ('r1000000-0000-0000-0000-000000000001','MEM-001','Aditya Kumar',     '6206320133','aditya.k@email.com',  'Ballabgarh','Haryana',      'S/o Mahendra Pandit, Ballabgarh, Faridabad','5612-3478-9001','ADBPK1234A','single', true),
  ('r1000000-0000-0000-0000-000000000002','MEM-002','Pooja Yadav',      '9810022002','pooja.y@email.com',   'Faridabad', 'Haryana',      'H.No. 45, Sector 21, Faridabad',           '5612-3478-9002','PJYPK5678B','married',true),
  ('r1000000-0000-0000-0000-000000000003','MEM-003','Manoj Tripathi',   '9810022003','manoj.t@email.com',   'Lucknow',   'Uttar Pradesh','12 Aliganj, Lucknow',                       '5612-3478-9003','MNTPP9012C','married',false),
  ('r1000000-0000-0000-0000-000000000004','MEM-004','Sneha Iyer',       '9810022004','sneha.i@email.com',   'Pune',      'Maharashtra',  'Flat 304, Kothrud, Pune',                  '5612-3478-9004','SNEPI3456D','single', false),
  ('r1000000-0000-0000-0000-000000000005','MEM-005','Bhupendra Yadav',  '9810022005','bhupi.y@email.com',   'Agra',      'Uttar Pradesh','Civil Lines, Agra',                        '5612-3478-9005','BHYPK7890E','married',false),
  ('r1000000-0000-0000-0000-000000000006','MEM-006','Lakshmi Narayanan','9810022006','lakshmi.n@email.com', 'Chennai',   'Tamil Nadu',   'T Nagar, Chennai',                          '5612-3478-9006','LXNPK2345F','married',true),
  ('r1000000-0000-0000-0000-000000000007','MEM-007','Imran Sheikh',     '9810022007','imran.s@email.com',   'Hyderabad', 'Telangana',    'Banjara Hills, Hyderabad',                  '5612-3478-9007','IMRPK6789G','married',false),
  ('r1000000-0000-0000-0000-000000000008','MEM-008','Neha Kulkarni',    '9810022008','neha.k@email.com',    'Mumbai',    'Maharashtra',  'Andheri East, Mumbai',                      '5612-3478-9008','NHKPK0123H','single', false)
on conflict (id) do nothing;

-- ─── 3. CUSTOMER ENRICHMENT (father/DOB/nominee) ─────────────────────────
update customers set
  father_or_husband_name = 'Mahendra Pandit',
  dob = '1992-04-15',
  nominee_name = 'Sunita Kumar',
  nominee_relation = 'Mother',
  nominee_dob = '1968-08-10',
  nominee_father_name = 'Late Ram Pandit',
  nominee_address = 'S/o Mahendra Pandit, Ballabgarh, Faridabad',
  nominee_pan = 'SUNPK0001Z'
where id = 'd1000000-0000-0000-0000-000000000001';

update customers set father_or_husband_name='Ramesh Verma',  dob='1988-11-02', nominee_name='Rohit Verma',   nominee_relation='Son',     nominee_dob='2012-03-21', nominee_father_name='Ramesh Verma',   nominee_address='Sector 50, Noida',           nominee_pan='ROHVK0002Y' where id='d1000000-0000-0000-0000-000000000002';
update customers set father_or_husband_name='Mahesh Gupta',  dob='1985-06-19', nominee_name='Pooja Gupta',   nominee_relation='Wife',    nominee_dob='1990-09-15', nominee_father_name='Suresh Bansal',  nominee_address='DLF Phase 3, Gurugram',       nominee_pan='POOGK0003X' where id='d1000000-0000-0000-0000-000000000003';
update customers set father_or_husband_name='Vikas Singh',   dob='1991-02-28', nominee_name='Vikas Singh',   nominee_relation='Husband', nominee_dob='1986-12-01', nominee_father_name='Bhanu Pratap',   nominee_address='Sector 16A, Faridabad',       nominee_pan='VKSPK0004W' where id='d1000000-0000-0000-0000-000000000004';
update customers set father_or_husband_name='Mukesh Jain',   dob='1980-09-10', nominee_name='Aarav Jain',    nominee_relation='Son',     nominee_dob='2008-05-11', nominee_father_name='Deepak Jain',    nominee_address='Aliganj, Lucknow',            nominee_pan='AARJN0005V' where id='d1000000-0000-0000-0000-000000000005';
update customers set father_or_husband_name='Rahul Mehta',   dob='1989-03-22', nominee_name='Rahul Mehta',   nominee_relation='Husband', nominee_dob='1985-01-05', nominee_father_name='Hari Mehta',     nominee_address='Civil Lines, Agra',           nominee_pan='RHLMK0006U' where id='d1000000-0000-0000-0000-000000000006';
update customers set father_or_husband_name='Devendra Yadav',dob='1983-12-12', nominee_name='Pinky Yadav',   nominee_relation='Wife',    nominee_dob='1987-06-25', nominee_father_name='Karan Yadav',    nominee_address='Shastri Nagar, Meerut',       nominee_pan='PNKYK0007T' where id='d1000000-0000-0000-0000-000000000007';
update customers set father_or_husband_name='Ashok Trivedi', dob='1990-07-04', nominee_name='Ashok Trivedi', nominee_relation='Husband', nominee_dob='1985-10-30', nominee_father_name='Ram Trivedi',    nominee_address='Sigra, Varanasi',             nominee_pan='ASKTK0008S' where id='d1000000-0000-0000-0000-000000000008';
update customers set father_or_husband_name='Kishore Saxena',dob='1987-05-17', nominee_name='Riya Saxena',   nominee_relation='Daughter',nominee_dob='2014-08-20', nominee_father_name='Mohit Saxena',   nominee_address='Krishna Nagar, Mathura',      nominee_pan='RIYSK0009R' where id='d1000000-0000-0000-0000-000000000009';
update customers set father_or_husband_name='Ramesh Agarwal',dob='1986-10-08', nominee_name='Ramesh Agarwal',nominee_relation='Husband', nominee_dob='1982-04-14', nominee_father_name='Lala Agarwal',   nominee_address='Karol Bagh, Delhi',           nominee_pan='RMSAK0010Q' where id='d1000000-0000-0000-0000-000000000010';

-- ─── 4. BOOKING ENRICHMENT (scheme name + upline + manager) ──────────────
update bookings set scheme_name='Brijvatika Awasiya Yojana', application_date=booked_at, booking_time='11:30', customer_bank_name='HDFC Bank',  upline_broker_code='FNB-008', manager_signature_by='Nidhi Sharma' where id='f1000000-0000-0000-0000-000000000001';
update bookings set scheme_name='Brijvatika Awasiya Yojana', application_date=booked_at, booking_time='15:00', customer_bank_name='SBI',        upline_broker_code='FNB-009', manager_signature_by='Nidhi Sharma' where id='f1000000-0000-0000-0000-000000000002';
update bookings set scheme_name='Green Valley Awasiya Yojana',application_date=booked_at, booking_time='10:15', customer_bank_name='ICICI Bank', upline_broker_code='FNB-005', manager_signature_by='Vikram Rao'   where id='f1000000-0000-0000-0000-000000000003';
update bookings set scheme_name='Royal Residency Awasiya Yojana',application_date=booked_at,booking_time='13:45',customer_bank_name='Axis Bank', upline_broker_code='FNB-005', manager_signature_by='Vikram Rao'   where id='f1000000-0000-0000-0000-000000000004';
update bookings set scheme_name='Royal Residency Awasiya Yojana',application_date=booked_at,booking_time='17:20',customer_bank_name='HDFC Bank', upline_broker_code='FNB-006', manager_signature_by='Nidhi Sharma' where id='f1000000-0000-0000-0000-000000000005';
update bookings set scheme_name='Royal Residency Awasiya Yojana',application_date=booked_at,booking_time='12:00',customer_bank_name='PNB',       upline_broker_code='FNB-003', manager_signature_by='Vikram Rao'   where id='f1000000-0000-0000-0000-000000000006';
update bookings set scheme_name='Green Valley Awasiya Yojana',application_date=booked_at,booking_time='09:30', customer_bank_name='SBI',        upline_broker_code='FNB-002', manager_signature_by='Nidhi Sharma' where id='f1000000-0000-0000-0000-000000000007';
update bookings set scheme_name='Royal Residency Awasiya Yojana',application_date=booked_at,booking_time='14:10',customer_bank_name='Kotak',     upline_broker_code='FNB-003', manager_signature_by='Vikram Rao'   where id='f1000000-0000-0000-0000-000000000008';
update bookings set scheme_name='Green Valley Awasiya Yojana',application_date=booked_at,booking_time='11:00', customer_bank_name='HDFC Bank',  upline_broker_code='FNB-008', manager_signature_by='Nidhi Sharma' where id='f1000000-0000-0000-0000-000000000009';
update bookings set scheme_name='Royal Residency Awasiya Yojana',application_date=booked_at,booking_time='16:30',customer_bank_name='ICICI Bank',upline_broker_code='FNB-005', manager_signature_by='Vikram Rao'   where id='f1000000-0000-0000-0000-000000000010';

-- ─── 5. PAYMENT RECEIPT-DETAIL ENRICHMENT (matches FANBE receipt #6301) ──
update payments set receipt_no='6301', drawn_on_bank='Cash Adjustment', branch='BIB/LBD', instalment_no=1, rupees_in_words='Ninety Thousand only',     sponsor_name='Alok / Sanjeet', is_cash_adjustment=true,  subject_to_realisation=false where id='g1000000-0000-0000-0000-000000000001';
update payments set receipt_no='6302', drawn_on_bank='HDFC Bank',       branch='Sector 12 Gurugram', instalment_no=2, rupees_in_words='Ninety Thousand only', sponsor_name='Alok / Sanjeet', subject_to_realisation=true  where id='g1000000-0000-0000-0000-000000000002';
update payments set receipt_no='6303', drawn_on_bank='HDFC Bank',       branch='Sector 12 Gurugram', instalment_no=3, rupees_in_words='Ninety Thousand only', sponsor_name='Alok / Sanjeet', subject_to_realisation=true  where id='g1000000-0000-0000-0000-000000000003';
update payments set receipt_no='6304', drawn_on_bank='SBI',             branch='Noida Sector 50',    instalment_no=1, rupees_in_words='One Lakh Thirty Five Thousand only', sponsor_name='Pooja Arora',  subject_to_realisation=true  where id='g1000000-0000-0000-0000-000000000004';
update payments set receipt_no='6305', drawn_on_bank='SBI',             branch='Noida Sector 50',    instalment_no=2, rupees_in_words='One Lakh Thirty Five Thousand only', sponsor_name='Pooja Arora',  subject_to_realisation=true  where id='g1000000-0000-0000-0000-000000000005';
update payments set receipt_no='6306', drawn_on_bank='ICICI Bank',      branch='MG Road Gurugram',   instalment_no=1, rupees_in_words='One Lakh Eighty Thousand only',     sponsor_name='Anjana Mishra',subject_to_realisation=true  where id='g1000000-0000-0000-0000-000000000006';
update payments set receipt_no='6307', drawn_on_bank='ICICI Bank',      branch='MG Road Gurugram',   instalment_no=2, rupees_in_words='One Lakh Eighty Thousand only',     sponsor_name='Anjana Mishra',subject_to_realisation=true  where id='g1000000-0000-0000-0000-000000000007';
update payments set receipt_no='6308', drawn_on_bank='ICICI Bank',      branch='MG Road Gurugram',   instalment_no=3, rupees_in_words='One Lakh Eighty Thousand only',     sponsor_name='Anjana Mishra',subject_to_realisation=true  where id='g1000000-0000-0000-0000-000000000008';
update payments set receipt_no='6309', drawn_on_bank='Axis Bank',       branch='Faridabad NIT',      instalment_no=1, rupees_in_words='One Lakh Fifty Two Thousand only',  sponsor_name='Manisha Dubey',subject_to_realisation=true  where id='g1000000-0000-0000-0000-000000000009';
update payments set receipt_no='6310', drawn_on_bank='Axis Bank',       branch='Faridabad NIT',      instalment_no=2, rupees_in_words='One Lakh Fifty Two Thousand only',  sponsor_name='Manisha Dubey',subject_to_realisation=true  where id='g1000000-0000-0000-0000-000000000010';
update payments set receipt_no='6311', drawn_on_bank='HDFC Bank',       branch='Hazratganj Lucknow', instalment_no=1, rupees_in_words='One Lakh Ninety Thousand only',     sponsor_name='Rohit Kesarwani',subject_to_realisation=true  where id='g1000000-0000-0000-0000-000000000011';
update payments set receipt_no='6312', drawn_on_bank='HDFC Bank',       branch='Hazratganj Lucknow', instalment_no=2, rupees_in_words='One Lakh Ninety Thousand only',     sponsor_name='Rohit Kesarwani',subject_to_realisation=true  where id='g1000000-0000-0000-0000-000000000012';
update payments set receipt_no='6313', drawn_on_bank='PNB',             branch='Sanjay Place Agra',  instalment_no=1, rupees_in_words='Two Lakh Twenty Eight Thousand only',sponsor_name='Seema Tiwari', subject_to_realisation=true  where id='g1000000-0000-0000-0000-000000000013';
update payments set receipt_no='6314', drawn_on_bank='SBI',             branch='Connaught Place',    instalment_no=1, rupees_in_words='Four Lakh Fifty Thousand only',     sponsor_name='Sandeep Rawat',subject_to_realisation=true  where id='g1000000-0000-0000-0000-000000000014';
update payments set receipt_no='6315', drawn_on_bank='SBI',             branch='Connaught Place',    instalment_no=2, rupees_in_words='Four Lakh Fifty Thousand only',     sponsor_name='Sandeep Rawat',subject_to_realisation=true  where id='g1000000-0000-0000-0000-000000000015';
update payments set receipt_no='6316', drawn_on_bank='Kotak',           branch='Sigra Varanasi',     instalment_no=1, rupees_in_words='Three Lakh Four Thousand only',     sponsor_name='Nisha Kapoor', subject_to_realisation=true  where id='g1000000-0000-0000-0000-000000000016';
update payments set receipt_no='6317', drawn_on_bank='Cash Adjustment', branch='BIB/LBD',            instalment_no=1, rupees_in_words='Ninety Thousand only',              sponsor_name='Deepak Chaudhary',is_cash_adjustment=true, subject_to_realisation=false where id='g1000000-0000-0000-0000-000000000017';
update payments set receipt_no='6318', drawn_on_bank='ICICI Bank',      branch='Mathura Highway',    instalment_no=1, rupees_in_words='One Lakh Ninety Thousand only',     sponsor_name='Aakash Pandey',subject_to_realisation=true  where id='g1000000-0000-0000-0000-000000000018';

-- ─── 6. EMI SCHEDULES & INSTALMENTS (matches receipt-style instalment chain) ─
insert into emi_schedules (id, booking_id, customer_id, frequency, start_date, num_installments, principal, total_payable, status)
values
  ('s1000000-0000-0000-0000-000000000001','f1000000-0000-0000-0000-000000000001','d1000000-0000-0000-0000-000000000001','quarterly','2025-07-10',5,360000,360000,'active'),
  ('s1000000-0000-0000-0000-000000000002','f1000000-0000-0000-0000-000000000002','d1000000-0000-0000-0000-000000000002','quarterly','2025-08-15',4,540000,540000,'active'),
  ('s1000000-0000-0000-0000-000000000003','f1000000-0000-0000-0000-000000000003','d1000000-0000-0000-0000-000000000003','quarterly','2025-09-01',4,720000,720000,'active'),
  ('s1000000-0000-0000-0000-000000000004','f1000000-0000-0000-0000-000000000004','d1000000-0000-0000-0000-000000000004','quarterly','2025-10-05',4,608000,608000,'active'),
  ('s1000000-0000-0000-0000-000000000005','f1000000-0000-0000-0000-000000000005','d1000000-0000-0000-0000-000000000005','quarterly','2025-11-20',4,760000,760000,'active'),
  ('s1000000-0000-0000-0000-000000000006','f1000000-0000-0000-0000-000000000006','d1000000-0000-0000-0000-000000000006','quarterly','2025-12-10',4,912000,912000,'active'),
  ('s1000000-0000-0000-0000-000000000007','f1000000-0000-0000-0000-000000000007','d1000000-0000-0000-0000-000000000007','quarterly','2026-01-05',4,1800000,1800000,'active'),
  ('s1000000-0000-0000-0000-000000000008','f1000000-0000-0000-0000-000000000008','d1000000-0000-0000-0000-000000000008','quarterly','2026-02-14',4,1216000,1216000,'active')
on conflict (id) do nothing;

insert into emi_installments (id, schedule_id, seq, due_date, amount, status, paid_amount, paid_at)
values
  ('t1000000-0000-0000-0000-000000000001','s1000000-0000-0000-0000-000000000001',1,'2025-10-10',90000,'paid',   90000,'2025-10-10'),
  ('t1000000-0000-0000-0000-000000000002','s1000000-0000-0000-0000-000000000001',2,'2026-01-10',90000,'paid',   90000,'2026-01-10'),
  ('t1000000-0000-0000-0000-000000000003','s1000000-0000-0000-0000-000000000001',3,'2026-04-10',90000,'overdue', 0, null),
  ('t1000000-0000-0000-0000-000000000004','s1000000-0000-0000-0000-000000000001',4,'2026-07-10',90000,'pending', 0, null),
  ('t1000000-0000-0000-0000-000000000005','s1000000-0000-0000-0000-000000000002',1,'2025-11-15',135000,'paid',  135000,'2025-11-15'),
  ('t1000000-0000-0000-0000-000000000006','s1000000-0000-0000-0000-000000000002',2,'2026-02-15',135000,'pending',     0,null),
  ('t1000000-0000-0000-0000-000000000007','s1000000-0000-0000-0000-000000000002',3,'2026-05-15',135000,'pending',     0,null),
  ('t1000000-0000-0000-0000-000000000008','s1000000-0000-0000-0000-000000000002',4,'2026-08-15',135000,'pending',     0,null),
  ('t1000000-0000-0000-0000-000000000009','s1000000-0000-0000-0000-000000000003',1,'2025-12-01',180000,'paid',  180000,'2025-12-01'),
  ('t1000000-0000-0000-0000-000000000010','s1000000-0000-0000-0000-000000000003',2,'2026-03-01',180000,'paid',  180000,'2026-03-01'),
  ('t1000000-0000-0000-0000-000000000011','s1000000-0000-0000-0000-000000000003',3,'2026-06-01',180000,'pending',     0,null),
  ('t1000000-0000-0000-0000-000000000012','s1000000-0000-0000-0000-000000000003',4,'2026-09-01',180000,'pending',     0,null),
  ('t1000000-0000-0000-0000-000000000013','s1000000-0000-0000-0000-000000000004',1,'2026-01-05',152000,'paid',  152000,'2026-01-05'),
  ('t1000000-0000-0000-0000-000000000014','s1000000-0000-0000-0000-000000000004',2,'2026-04-05',152000,'overdue',     0,null),
  ('t1000000-0000-0000-0000-000000000015','s1000000-0000-0000-0000-000000000004',3,'2026-07-05',152000,'pending',     0,null),
  ('t1000000-0000-0000-0000-000000000016','s1000000-0000-0000-0000-000000000004',4,'2026-10-05',152000,'pending',     0,null),
  ('t1000000-0000-0000-0000-000000000017','s1000000-0000-0000-0000-000000000005',1,'2026-02-20',190000,'paid',  190000,'2026-02-20'),
  ('t1000000-0000-0000-0000-000000000018','s1000000-0000-0000-0000-000000000005',2,'2026-05-20',190000,'pending',     0,null),
  ('t1000000-0000-0000-0000-000000000019','s1000000-0000-0000-0000-000000000005',3,'2026-08-20',190000,'pending',     0,null),
  ('t1000000-0000-0000-0000-000000000020','s1000000-0000-0000-0000-000000000005',4,'2026-11-20',190000,'pending',     0,null),
  ('t1000000-0000-0000-0000-000000000021','s1000000-0000-0000-0000-000000000006',1,'2026-03-10',228000,'pending',     0,null),
  ('t1000000-0000-0000-0000-000000000022','s1000000-0000-0000-0000-000000000006',2,'2026-06-10',228000,'pending',     0,null),
  ('t1000000-0000-0000-0000-000000000023','s1000000-0000-0000-0000-000000000006',3,'2026-09-10',228000,'pending',     0,null),
  ('t1000000-0000-0000-0000-000000000024','s1000000-0000-0000-0000-000000000006',4,'2026-12-10',228000,'pending',     0,null),
  ('t1000000-0000-0000-0000-000000000025','s1000000-0000-0000-0000-000000000007',1,'2026-04-05',450000,'paid',  450000,'2026-04-05'),
  ('t1000000-0000-0000-0000-000000000026','s1000000-0000-0000-0000-000000000007',2,'2026-07-05',450000,'pending',     0,null),
  ('t1000000-0000-0000-0000-000000000027','s1000000-0000-0000-0000-000000000007',3,'2026-10-05',450000,'pending',     0,null),
  ('t1000000-0000-0000-0000-000000000028','s1000000-0000-0000-0000-000000000007',4,'2027-01-05',450000,'pending',     0,null),
  ('t1000000-0000-0000-0000-000000000029','s1000000-0000-0000-0000-000000000008',1,'2026-05-14',304000,'pending',     0,null),
  ('t1000000-0000-0000-0000-000000000030','s1000000-0000-0000-0000-000000000008',2,'2026-08-14',304000,'pending',     0,null),
  ('t1000000-0000-0000-0000-000000000031','s1000000-0000-0000-0000-000000000008',3,'2026-11-14',304000,'pending',     0,null),
  ('t1000000-0000-0000-0000-000000000032','s1000000-0000-0000-0000-000000000008',4,'2027-02-14',304000,'pending',     0,null)
on conflict (id) do nothing;

-- ─── 7. EXTRA INQUIRIES ──────────────────────────────────────────────────
insert into inquiries (id, name, mobile, email, project_id, agent_code, source, status, notes)
values
  ('q100-0009','Karthik Reddy',  '9812200009','karthik.r@email.com','b1000000-0000-0000-0000-000000000003','FNB-002','website',  'new',       'Hyderabad based, looking for investment plot'),
  ('q100-0010','Anushka Joshi',  '9812200010','anushka.j@email.com','b1000000-0000-0000-0000-000000000001','FNB-006','referral', 'qualified', 'Wants to book 200 sqyd in Phase 2'),
  ('q100-0011','Mahesh Bhat',    '9812200011','mahesh.b@email.com', 'b1000000-0000-0000-0000-000000000002','FNB-011','social',   'contacted', 'Marketing director, bulk 3 plots'),
  ('q100-0012','Reshma Khatun',  '9812200012',null,                 'b1000000-0000-0000-0000-000000000003','FNB-014','walk_in',  'new',       'Walked in Faridabad office today'),
  ('q100-0013','Naveen Reddy',   '9812200013','naveen.r@email.com', 'b1000000-0000-0000-0000-000000000001','FNB-001','referral', 'converted', 'Already booked BK-2026-001')
on conflict do nothing;

-- ─── 8. EXTRA ANNOUNCEMENTS / NEWS ───────────────────────────────────────
insert into news_events (id, title, post_type, description, publish_from, publish_to, is_active, state)
values
  ('p100-0007','EMI Auto-Reminder Active From May 2026','news',  'SMS + WhatsApp reminders 7/3/1 days before EMI due date.','2026-05-01','2026-12-31',true,'published'),
  ('p100-0008','Stamp Duty Rebate — Limited Time',     'popup', 'Book before 15th May 2026 for 2% stamp duty rebate.','2026-05-01','2026-05-15',true,'published'),
  ('p100-0009','Site Visit Bus — Every Saturday',      'event', 'Free site-visit bus from Gurugram office to Green Valley each Saturday at 9 AM.','2026-05-01','2026-08-31',true,'published')
on conflict do nothing;

-- ─── 9. EXTRA EXPENSES ───────────────────────────────────────────────────
insert into expenses (id, head_id, item_name, amount, description, expense_date)
values
  ('n100-0013','m100-0001','Newspaper ad — Dainik Jagran',45000,'Half page Sunday edition','2026-04-22'),
  ('n100-0014','m100-0006','RERA Registration Renewal',  85000,'Annual RERA fee for Sunrise City','2026-04-18'),
  ('n100-0015','m100-0004','Diesel for site machinery',  18500,'Phase 2 levelling work','2026-04-26'),
  ('n100-0016','m100-0003','Office boy salary — April',  12000,'Office support staff','2026-04-30'),
  ('n100-0017','m100-0005','Borewell drilling — Sunrise',135000,'Sunrise City water source','2026-04-29')
on conflict do nothing;

-- ─── 10. APP USERS (multi-admin demo) ────────────────────────────────────
insert into app_users (id, name, email, role_id, active)
select
  v.id, v.name, v.email,
  (select id from roles where name = v.role_name),
  true
from (values
  ('u1000000-0000-0000-0000-000000000001'::uuid,'Nidhi Sharma','nidhi@fanbegroup.com',  'super_admin'),
  ('u1000000-0000-0000-0000-000000000002'::uuid,'Vikram Rao',  'vikram@fanbegroup.com', 'admin'),
  ('u1000000-0000-0000-0000-000000000003'::uuid,'Alok Pandey', 'alok@fanbegroup.com',   'office_incharge'),
  ('u1000000-0000-0000-0000-000000000004'::uuid,'Sanjeet Kumar','sanjeet@fanbegroup.com','finance_officer'),
  ('u1000000-0000-0000-0000-000000000005'::uuid,'Pooja Saxena','pooja@fanbegroup.com',  'accountant')
) as v(id,name,email,role_name)
on conflict (id) do nothing;

-- ═══════════════════════════════════════════════════════════════════════════
-- END
-- ═══════════════════════════════════════════════════════════════════════════
