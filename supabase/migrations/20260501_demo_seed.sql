-- ═══════════════════════════════════════════════════════════════════════════
-- FANBE GROUP — FULL DEMO SEED
-- Covers: brokers (all 15 ranks), sponsor tree, projects, plots, bookings,
--         payments, payout_distributions (differential), broker_rank_stats,
--         achievers_club, team_rewards, withdrawals, expenses, tickets, news
-- PURPOSE: Admin presentation demo — every logic visible & verifiable
-- ═══════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────────────
-- 0. Fixed UUIDs for deterministic relationships
-- ─────────────────────────────────────────────────────────────────────────

-- BROKERS (15 — one per rank)
-- B01 = President (12%), B02 = Vice President (11.5%) ... B15 = Executive (5%)
do $$ begin
  -- nothing to declare — using inline UUIDs throughout
end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- 1. COMPANY BANK ACCOUNTS
-- ─────────────────────────────────────────────────────────────────────────
insert into company_bank_accounts (id, bank_name, account_holder, account_no, ifsc, account_type, opening_balance, is_default, active)
values
  ('a1000000-0000-0000-0000-000000000001', 'HDFC Bank',  'Fanbe Group Pvt Ltd', '50200012345678', 'HDFC0001234', 'current', 5000000, true,  true),
  ('a1000000-0000-0000-0000-000000000002', 'SBI',        'Fanbe Group Pvt Ltd', '39876543210987', 'SBIN0012345', 'savings', 1000000, false, true),
  ('a1000000-0000-0000-0000-000000000003', 'ICICI Bank', 'Fanbe Group Pvt Ltd', '628705001234',   'ICIC0006287', 'current', 2500000, false, true)
on conflict (id) do nothing;

-- ─────────────────────────────────────────────────────────────────────────
-- 2. PROJECTS
-- ─────────────────────────────────────────────────────────────────────────
insert into projects (id, name, location, total_plots, area_sqyards, status, launch_date, description)
values
  ('b1000000-0000-0000-0000-000000000001', 'Fanbe Green Valley',    'Sector 12, Gurugram',   200, 10000, 'active',   '2025-06-01', 'Premium plotted development with lush green landscaping.'),
  ('b1000000-0000-0000-0000-000000000002', 'Fanbe Royal Residency', 'Yamuna Expressway, UP', 350, 18000, 'active',   '2025-09-01', 'Affordable premium plots near Yamuna Expressway.'),
  ('b1000000-0000-0000-0000-000000000003', 'Fanbe Sunrise City',    'Faridabad, Haryana',    500, 25000, 'upcoming', '2026-07-01', 'Township project with full infrastructure.')
on conflict (id) do nothing;

-- ─────────────────────────────────────────────────────────────────────────
-- 3. PLOTS
-- ─────────────────────────────────────────────────────────────────────────
insert into plots (id, project_id, plot_no, area_sqyards, rate_per_sqyard, total_cost, facing, status)
values
  ('c1000000-0000-0000-0000-000000000001','b1000000-0000-0000-0000-000000000001','GV-A101',100,4500,450000,'East','booked'),
  ('c1000000-0000-0000-0000-000000000002','b1000000-0000-0000-0000-000000000001','GV-A102',150,4500,675000,'North','booked'),
  ('c1000000-0000-0000-0000-000000000003','b1000000-0000-0000-0000-000000000001','GV-B201',200,4500,900000,'East','booked'),
  ('c1000000-0000-0000-0000-000000000004','b1000000-0000-0000-0000-000000000001','GV-B202',120,4500,540000,'West','available'),
  ('c1000000-0000-0000-0000-000000000005','b1000000-0000-0000-0000-000000000002','RR-C101',200,3800,760000,'East','booked'),
  ('c1000000-0000-0000-0000-000000000006','b1000000-0000-0000-0000-000000000002','RR-C102',250,3800,950000,'North','booked'),
  ('c1000000-0000-0000-0000-000000000007','b1000000-0000-0000-0000-000000000002','RR-D201',300,3800,1140000,'East','booked'),
  ('c1000000-0000-0000-0000-000000000008','b1000000-0000-0000-0000-000000000002','RR-D202',100,3800,380000,'South','available'),
  ('c1000000-0000-0000-0000-000000000009','b1000000-0000-0000-0000-000000000001','GV-C301',500,4500,2250000,'East','booked'),
  ('c1000000-0000-0000-0000-000000000010','b1000000-0000-0000-0000-000000000002','RR-E301',400,3800,1520000,'North','booked')
on conflict (id) do nothing;

-- ─────────────────────────────────────────────────────────────────────────
-- 4. CUSTOMERS
-- ─────────────────────────────────────────────────────────────────────────
insert into customers (id, customer_code, name, mobile, email, city, state, aadhaar, pan)
values
  ('d1000000-0000-0000-0000-000000000001','CUST-001','Ramesh Sharma',   '9811100001','ramesh@example.com',  'Delhi',    'Delhi',       '1234-5678-9001','ABCRS1234A'),
  ('d1000000-0000-0000-0000-000000000002','CUST-002','Sunita Verma',    '9811100002','sunita@example.com',  'Noida',    'Uttar Pradesh','1234-5678-9002','ABCSV5678B'),
  ('d1000000-0000-0000-0000-000000000003','CUST-003','Anil Gupta',      '9811100003','anil@example.com',    'Gurgaon',  'Haryana',     '1234-5678-9003','ABCAG9012C'),
  ('d1000000-0000-0000-0000-000000000004','CUST-004','Priya Singh',     '9811100004','priya@example.com',   'Faridabad','Haryana',     '1234-5678-9004','ABCPS3456D'),
  ('d1000000-0000-0000-0000-000000000005','CUST-005','Deepak Jain',     '9811100005','deepak@example.com',  'Lucknow',  'Uttar Pradesh','1234-5678-9005','ABCDJ7890E'),
  ('d1000000-0000-0000-0000-000000000006','CUST-006','Kavita Mehta',    '9811100006','kavita@example.com',  'Agra',     'Uttar Pradesh','1234-5678-9006','ABCKM2345F'),
  ('d1000000-0000-0000-0000-000000000007','CUST-007','Suresh Yadav',    '9811100007','suresh@example.com',  'Meerut',   'Uttar Pradesh','1234-5678-9007','ABCSY6789G'),
  ('d1000000-0000-0000-0000-000000000008','CUST-008','Anjali Trivedi',  '9811100008','anjali@example.com',  'Varanasi', 'Uttar Pradesh','1234-5678-9008','ABCAT0123H'),
  ('d1000000-0000-0000-0000-000000000009','CUST-009','Mohit Saxena',    '9811100009','mohit@example.com',   'Mathura',  'Uttar Pradesh','1234-5678-9009','ABCMS4567I'),
  ('d1000000-0000-0000-0000-000000000010','CUST-010','Reena Agarwal',   '9811100010','reena@example.com',   'Delhi',    'Delhi',       '1234-5678-9010','ABCRA8901J')
on conflict (id) do nothing;

-- ─────────────────────────────────────────────────────────────────────────
-- 5. BROKERS (15 — spanning all ranks for demo)
--    Sponsor tree: B01(President) → B02 → B03 → B04 → B05 → B06..B15
--    i.e. B01 is top, each broker's upline is the one above them
-- ─────────────────────────────────────────────────────────────────────────
insert into brokers (id, broker_code, name, phone, email, city, state, status, wallet_balance, lifetime_business, direct_count, kyc_status)
values
  ('e1000000-0000-0000-0000-000000000001','FNB-001','Rajiv Malhotra',   '9901100001','rajiv@fanbe.com',   'Delhi',   'Delhi',         'active',1250000,6200000,4, 'approved'),
  ('e1000000-0000-0000-0000-000000000002','FNB-002','Poonam Arora',     '9901100002','poonam@fanbe.com',  'Noida',   'Uttar Pradesh', 'active', 830000, 3100000,3, 'approved'),
  ('e1000000-0000-0000-0000-000000000003','FNB-003','Sandeep Rawat',    '9901100003','sandeep@fanbe.com', 'Gurgaon', 'Haryana',       'active', 610000, 1800000,3, 'approved'),
  ('e1000000-0000-0000-0000-000000000004','FNB-004','Nisha Kapoor',     '9901100004','nisha@fanbe.com',   'Gurgaon', 'Haryana',       'active', 420000, 1350000,2, 'approved'),
  ('e1000000-0000-0000-0000-000000000005','FNB-005','Aakash Pandey',    '9901100005','aakash@fanbe.com',  'Lucknow', 'Uttar Pradesh', 'active', 310000, 2050000,3, 'approved'),
  ('e1000000-0000-0000-0000-000000000006','FNB-006','Seema Tiwari',     '9901100006','seema@fanbe.com',   'Agra',    'Uttar Pradesh', 'active', 195000,  875000,2, 'approved'),
  ('e1000000-0000-0000-0000-000000000007','FNB-007','Vivek Srivastava', '9901100007','vivek@fanbe.com',   'Meerut',  'Uttar Pradesh', 'active', 148000,  640000,2, 'approved'),
  ('e1000000-0000-0000-0000-000000000008','FNB-008','Manisha Dubey',    '9901100008','manisha@fanbe.com', 'Kanpur',  'Uttar Pradesh', 'active',  92000,  420000,1, 'approved'),
  ('e1000000-0000-0000-0000-000000000009','FNB-009','Rohit Kesarwani',  '9901100009','rohit@fanbe.com',   'Mathura', 'Uttar Pradesh', 'active',  74000,  310000,1, 'approved'),
  ('e1000000-0000-0000-0000-000000000010','FNB-010','Anjana Mishra',    '9901100010','anjana@fanbe.com',  'Varanasi','Uttar Pradesh', 'active',  58000,  225000,1, 'approved'),
  ('e1000000-0000-0000-0000-000000000011','FNB-011','Sunil Chandra',    '9901100011','sunil@fanbe.com',   'Agra',    'Uttar Pradesh', 'active',  41000,  180000,1, 'pending'),
  ('e1000000-0000-0000-0000-000000000012','FNB-012','Geeta Bhardwaj',   '9901100012','geeta@fanbe.com',   'Delhi',   'Delhi',         'active',  32000,  145000,1, 'pending'),
  ('e1000000-0000-0000-0000-000000000013','FNB-013','Harish Lal',       '9901100013','harish@fanbe.com',  'Mathura', 'Uttar Pradesh', 'active',  18000,   95000,0, 'pending'),
  ('e1000000-0000-0000-0000-000000000014','FNB-014','Pooja Dixit',      '9901100014','pooja@fanbe.com',   'Noida',   'Uttar Pradesh', 'active',  12000,   62000,0, 'pending'),
  ('e1000000-0000-0000-0000-000000000015','FNB-015','Deepak Chaudhary', '9901100015','deepak@fanbe.com',  'Kanpur',  'Uttar Pradesh', 'active',   6500,   18000,0, 'pending')
on conflict (id) do nothing;

-- ─────────────────────────────────────────────────────────────────────────
-- 6. BROKER RANK STATS (maps to 15 commission_ranks levels)
-- ─────────────────────────────────────────────────────────────────────────
insert into broker_rank_stats (broker_id, current_rank_level, personal_sq_yards, team_sq_yards, direct_count)
values
  ('e1000000-0000-0000-0000-000000000001', 15, 4200, 62000, 4), -- President     12%
  ('e1000000-0000-0000-0000-000000000002', 13, 2800, 31000, 3), -- Zonal Manager 11%
  ('e1000000-0000-0000-0000-000000000003', 11, 1900, 18000, 3), -- Gen Manager   10%
  ('e1000000-0000-0000-0000-000000000004',  9, 1400, 13500, 2), -- Sr Sales Mgr   9%
  ('e1000000-0000-0000-0000-000000000005',  8, 1100, 20500, 3), -- Sales Manager  8.5%
  ('e1000000-0000-0000-0000-000000000006',  7,  800,  8750, 2), -- Asst Sales Mgr 8%
  ('e1000000-0000-0000-0000-000000000007',  6,  600,  6400, 2), -- Sr Team Mgr    7.5%
  ('e1000000-0000-0000-0000-000000000008',  5,  500,  4200, 1), -- Team Manager   7%
  ('e1000000-0000-0000-0000-000000000009',  4,  400,  3100, 1), -- Sr Sales Offr  6.5%
  ('e1000000-0000-0000-0000-000000000010',  3,  300,  2250, 1), -- Sales Officer  6%
  ('e1000000-0000-0000-0000-000000000011',  2,  250,  1800, 1), -- Sr Executive   5.5%
  ('e1000000-0000-0000-0000-000000000012',  2,  180,  1450, 1), -- Sr Executive   5.5%
  ('e1000000-0000-0000-0000-000000000013',  1,  120,   950, 0), -- Executive      5%
  ('e1000000-0000-0000-0000-000000000014',  1,   80,   620, 0), -- Executive      5%
  ('e1000000-0000-0000-0000-000000000015',  1,   50,   180, 0)  -- Executive      5%
on conflict (broker_id) do update set
  current_rank_level = excluded.current_rank_level,
  personal_sq_yards  = excluded.personal_sq_yards,
  team_sq_yards      = excluded.team_sq_yards,
  direct_count       = excluded.direct_count;

-- ─────────────────────────────────────────────────────────────────────────
-- 7. SPONSOR TREE
--    Chain: B01 > B02 > B03 > B04 > B05 > B06 > B07
--    B08, B09 report to B05 (multi-leg)
--    B10, B11 report to B06; B12,B13 to B07; B14,B15 to B08
-- ─────────────────────────────────────────────────────────────────────────
insert into sponsor_tree (broker_id, sponsor_id, level)
values
  ('e1000000-0000-0000-0000-000000000001', null,                                    1), -- top
  ('e1000000-0000-0000-0000-000000000002','e1000000-0000-0000-0000-000000000001',   2),
  ('e1000000-0000-0000-0000-000000000003','e1000000-0000-0000-0000-000000000002',   3),
  ('e1000000-0000-0000-0000-000000000004','e1000000-0000-0000-0000-000000000003',   4),
  ('e1000000-0000-0000-0000-000000000005','e1000000-0000-0000-0000-000000000002',   3), -- B05 under B02
  ('e1000000-0000-0000-0000-000000000006','e1000000-0000-0000-0000-000000000003',   4),
  ('e1000000-0000-0000-0000-000000000007','e1000000-0000-0000-0000-000000000004',   5),
  ('e1000000-0000-0000-0000-000000000008','e1000000-0000-0000-0000-000000000005',   4),
  ('e1000000-0000-0000-0000-000000000009','e1000000-0000-0000-0000-000000000005',   4),
  ('e1000000-0000-0000-0000-000000000010','e1000000-0000-0000-0000-000000000006',   5),
  ('e1000000-0000-0000-0000-000000000011','e1000000-0000-0000-0000-000000000006',   5),
  ('e1000000-0000-0000-0000-000000000012','e1000000-0000-0000-0000-000000000007',   6),
  ('e1000000-0000-0000-0000-000000000013','e1000000-0000-0000-0000-000000000007',   6),
  ('e1000000-0000-0000-0000-000000000014','e1000000-0000-0000-0000-000000000008',   5),
  ('e1000000-0000-0000-0000-000000000015','e1000000-0000-0000-0000-000000000008',   5)
on conflict (broker_id) do nothing;

-- ─────────────────────────────────────────────────────────────────────────
-- 8. BOOKINGS
-- ─────────────────────────────────────────────────────────────────────────
insert into bookings (id, booking_no, project_id, plot_id, customer_id, broker_id, sq_yards, cost, booking_amount, status, booked_at)
values
  ('f1000000-0000-0000-0000-000000000001','BK-2025-001','b1000000-0000-0000-0000-000000000001','c1000000-0000-0000-0000-000000000001','d1000000-0000-0000-0000-000000000001','e1000000-0000-0000-0000-000000000013',100, 450000,  90000,'active','2025-07-10'),
  ('f1000000-0000-0000-0000-000000000002','BK-2025-002','b1000000-0000-0000-0000-000000000001','c1000000-0000-0000-0000-000000000002','d1000000-0000-0000-0000-000000000002','e1000000-0000-0000-0000-000000000014',150, 675000, 135000,'active','2025-08-15'),
  ('f1000000-0000-0000-0000-000000000003','BK-2025-003','b1000000-0000-0000-0000-000000000001','c1000000-0000-0000-0000-000000000003','d1000000-0000-0000-0000-000000000003','e1000000-0000-0000-0000-000000000010',200, 900000, 180000,'active','2025-09-01'),
  ('f1000000-0000-0000-0000-000000000004','BK-2025-004','b1000000-0000-0000-0000-000000000002','c1000000-0000-0000-0000-000000000005','d1000000-0000-0000-0000-000000000004','e1000000-0000-0000-0000-000000000008',200, 760000, 152000,'active','2025-10-05'),
  ('f1000000-0000-0000-0000-000000000005','BK-2025-005','b1000000-0000-0000-0000-000000000002','c1000000-0000-0000-0000-000000000006','d1000000-0000-0000-0000-000000000005','e1000000-0000-0000-0000-000000000009',250, 950000, 190000,'active','2025-11-20'),
  ('f1000000-0000-0000-0000-000000000006','BK-2025-006','b1000000-0000-0000-0000-000000000002','c1000000-0000-0000-0000-000000000007','d1000000-0000-0000-0000-000000000006','e1000000-0000-0000-0000-000000000006',300,1140000, 228000,'active','2025-12-10'),
  ('f1000000-0000-0000-0000-000000000007','BK-2026-001','b1000000-0000-0000-0000-000000000001','c1000000-0000-0000-0000-000000000009','d1000000-0000-0000-0000-000000000007','e1000000-0000-0000-0000-000000000003',500,2250000, 450000,'active','2026-01-05'),
  ('f1000000-0000-0000-0000-000000000008','BK-2026-002','b1000000-0000-0000-0000-000000000002','c1000000-0000-0000-0000-000000000010','d1000000-0000-0000-0000-000000000008','e1000000-0000-0000-0000-000000000004',400,1520000, 304000,'active','2026-02-14'),
  ('f1000000-0000-0000-0000-000000000009','BK-2026-003','b1000000-0000-0000-0000-000000000001','c1000000-0000-0000-0000-000000000001','d1000000-0000-0000-0000-000000000009','e1000000-0000-0000-0000-000000000015',100, 450000,  90000,'active','2026-03-08'),
  ('f1000000-0000-0000-0000-000000000010','BK-2026-004','b1000000-0000-0000-0000-000000000002','c1000000-0000-0000-0000-000000000006','d1000000-0000-0000-0000-000000000010','e1000000-0000-0000-0000-000000000005',250, 950000, 190000,'active','2026-04-12')
on conflict (id) do nothing;

-- ─────────────────────────────────────────────────────────────────────────
-- 9. PAYMENTS
-- ─────────────────────────────────────────────────────────────────────────
insert into payments (id, booking_id, amount, payment_mode, reference_no, status, payment_date, approved_at, remarks)
values
  -- BK-2025-001: booking + 2 instalments (full series visible)
  ('g1000000-0000-0000-0000-000000000001','f1000000-0000-0000-0000-000000000001', 90000,'NEFT','NEFT20250710001','approved','2025-07-10','2025-07-11','Booking amount'),
  ('g1000000-0000-0000-0000-000000000002','f1000000-0000-0000-0000-000000000001', 90000,'NEFT','NEFT20251010002','approved','2025-10-10','2025-10-12','Instalment 2'),
  ('g1000000-0000-0000-0000-000000000003','f1000000-0000-0000-0000-000000000001', 90000,'Cheque','CHQ20260110003','approved','2026-01-10','2026-01-12','Instalment 3'),
  -- BK-2025-002
  ('g1000000-0000-0000-0000-000000000004','f1000000-0000-0000-0000-000000000002',135000,'UPI','UPI20250815004','approved','2025-08-15','2025-08-16','Booking amount'),
  ('g1000000-0000-0000-0000-000000000005','f1000000-0000-0000-0000-000000000002',135000,'NEFT','NEFT20251115005','approved','2025-11-15','2025-11-17','Instalment 2'),
  -- BK-2025-003 (large 500 sqyd plot — key for achievers demo)
  ('g1000000-0000-0000-0000-000000000006','f1000000-0000-0000-0000-000000000003',180000,'NEFT','NEFT20250901006','approved','2025-09-01','2025-09-02','Booking amount'),
  ('g1000000-0000-0000-0000-000000000007','f1000000-0000-0000-0000-000000000003',180000,'NEFT','NEFT20251201007','approved','2025-12-01','2025-12-03','Instalment 2'),
  ('g1000000-0000-0000-0000-000000000008','f1000000-0000-0000-0000-000000000003',180000,'RTGS','RTGS20260301008','approved','2026-03-01','2026-03-02','Instalment 3'),
  -- BK-2025-004
  ('g1000000-0000-0000-0000-000000000009','f1000000-0000-0000-0000-000000000004',152000,'UPI','UPI20251005009','approved','2025-10-05','2025-10-06','Booking amount'),
  ('g1000000-0000-0000-0000-000000000010','f1000000-0000-0000-0000-000000000004',152000,'NEFT','NEFT20260105010','approved','2026-01-05','2026-01-07','Instalment 2'),
  -- BK-2025-005
  ('g1000000-0000-0000-0000-000000000011','f1000000-0000-0000-0000-000000000005',190000,'Cheque','CHQ20251120011','approved','2025-11-20','2025-11-22','Booking amount'),
  ('g1000000-0000-0000-0000-000000000012','f1000000-0000-0000-0000-000000000005',190000,'NEFT','NEFT20260220012','approved','2026-02-20','2026-02-22','Instalment 2'),
  -- BK-2025-006
  ('g1000000-0000-0000-0000-000000000013','f1000000-0000-0000-0000-000000000006',228000,'RTGS','RTGS20251210013','approved','2025-12-10','2025-12-11','Booking amount'),
  -- BK-2026-001 (500 sqyd — biggest)
  ('g1000000-0000-0000-0000-000000000014','f1000000-0000-0000-0000-000000000007',450000,'RTGS','RTGS20260105014','approved','2026-01-05','2026-01-06','Booking amount'),
  ('g1000000-0000-0000-0000-000000000015','f1000000-0000-0000-0000-000000000007',450000,'RTGS','RTGS20260405015','approved','2026-04-05','2026-04-06','Instalment 2'),
  -- BK-2026-002
  ('g1000000-0000-0000-0000-000000000016','f1000000-0000-0000-0000-000000000008',304000,'NEFT','NEFT20260214016','approved','2026-02-14','2026-02-15','Booking amount'),
  -- BK-2026-003
  ('g1000000-0000-0000-0000-000000000017','f1000000-0000-0000-0000-000000000009', 90000,'UPI','UPI20260308017','approved','2026-03-08','2026-03-09','Booking amount'),
  -- BK-2026-004
  ('g1000000-0000-0000-0000-000000000018','f1000000-0000-0000-0000-000000000010',190000,'NEFT','NEFT20260412018','approved','2026-04-12','2026-04-13','Booking amount')
on conflict (id) do nothing;

-- ─────────────────────────────────────────────────────────────────────────
-- 10. PAYOUT DISTRIBUTIONS (differential engine output — hand-calculated)
--
-- Example trace for Payment G001 (BK-001, ₹90,000, Broker B13=Executive 5%):
--   B13 (level 0, 5%)          → gross = 90000×5%  = 4500  → tds=225 admin=450  net=3825
--   B08 upline (level 1, 7%)   → diff  = 7%-5%=2%  → gross = 90000×2%  = 1800  tds=90  admin=180  net=1530
--   B05 upline (level 2, 8.5%) → diff  = 8.5%-7%=1.5% → gross=90000×1.5%=1350 tds=68 admin=135 net=1148
--   B02 upline (level 3, 11%)  → diff  = 11%-8.5%=2.5%→ gross=90000×2.5%=2250 tds=113 admin=225 net=1913
--   B01 upline (level 4, 12%)  → diff  = 12%-11%=1%  → gross=90000×1%   =  900 tds=45  admin=90  net=765
-- ─────────────────────────────────────────────────────────────────────────
insert into payout_distributions
  (id, booking_id, payment_id, beneficiary_broker_id, level, income_type,
   base_amount, upline_rank_pct, downline_rank_pct, differential_pct,
   gross_payout, tds_amount, admin_charge, net_payout, status)
values
  -- G001 chain (B13 sold → upline B08>B05>B02>B01)
  ('h100-0000-0000-0001','f1000000-0000-0000-0000-000000000001','g1000000-0000-0000-0000-000000000001','e1000000-0000-0000-0000-000000000013',0,'direct',      90000,5.0,0.0,5.0, 4500,225,450,3825,'credited'),
  ('h100-0000-0000-0002','f1000000-0000-0000-0000-000000000001','g1000000-0000-0000-0000-000000000001','e1000000-0000-0000-0000-000000000008',1,'differential',90000,7.0,5.0,2.0, 1800, 90,180,1530,'credited'),
  ('h100-0000-0000-0003','f1000000-0000-0000-0000-000000000001','g1000000-0000-0000-0000-000000000001','e1000000-0000-0000-0000-000000000005',2,'differential',90000,8.5,7.0,1.5, 1350, 68,135,1148,'credited'),
  ('h100-0000-0000-0004','f1000000-0000-0000-0000-000000000001','g1000000-0000-0000-0000-000000000001','e1000000-0000-0000-0000-000000000002',3,'differential',90000,11.0,8.5,2.5,2250,113,225,1913,'credited'),
  ('h100-0000-0000-0005','f1000000-0000-0000-0000-000000000001','g1000000-0000-0000-0000-000000000001','e1000000-0000-0000-0000-000000000001',4,'differential',90000,12.0,11.0,1.0,  900, 45, 90, 765,'credited'),
  -- G002 chain (BK-001 instalment 2, same broker B13)
  ('h100-0000-0000-0006','f1000000-0000-0000-0000-000000000001','g1000000-0000-0000-0000-000000000002','e1000000-0000-0000-0000-000000000013',0,'direct',      90000,5.0,0.0,5.0, 4500,225,450,3825,'credited'),
  ('h100-0000-0000-0007','f1000000-0000-0000-0000-000000000001','g1000000-0000-0000-0000-000000000002','e1000000-0000-0000-0000-000000000008',1,'differential',90000,7.0,5.0,2.0, 1800, 90,180,1530,'credited'),
  ('h100-0000-0000-0008','f1000000-0000-0000-0000-000000000001','g1000000-0000-0000-0000-000000000002','e1000000-0000-0000-0000-000000000002',2,'differential',90000,11.0,7.0,4.0, 3600,180,360,3060,'credited'),
  ('h100-0000-0000-0009','f1000000-0000-0000-0000-000000000001','g1000000-0000-0000-0000-000000000002','e1000000-0000-0000-0000-000000000001',3,'differential',90000,12.0,11.0,1.0,  900, 45, 90, 765,'credited'),
  -- G006 chain (BK-003, B10=Sales Officer 6%, 180000)
  ('h100-0000-0000-0010','f1000000-0000-0000-0000-000000000003','g1000000-0000-0000-0000-000000000006','e1000000-0000-0000-0000-000000000010',0,'direct',     180000,6.0,0.0,6.0,10800,540,1080,9180,'credited'),
  ('h100-0000-0000-0011','f1000000-0000-0000-0000-000000000003','g1000000-0000-0000-0000-000000000006','e1000000-0000-0000-0000-000000000006',1,'differential',180000,8.0,6.0,2.0, 3600,180,360,3060,'credited'),
  ('h100-0000-0000-0012','f1000000-0000-0000-0000-000000000003','g1000000-0000-0000-0000-000000000006','e1000000-0000-0000-0000-000000000003',2,'differential',180000,10.0,8.0,2.0, 3600,180,360,3060,'credited'),
  ('h100-0000-0000-0013','f1000000-0000-0000-0000-000000000003','g1000000-0000-0000-0000-000000000006','e1000000-0000-0000-0000-000000000002',3,'differential',180000,11.0,10.0,1.0,1800, 90,180,1530,'credited'),
  ('h100-0000-0000-0014','f1000000-0000-0000-0000-000000000003','g1000000-0000-0000-0000-000000000006','e1000000-0000-0000-0000-000000000001',4,'differential',180000,12.0,11.0,1.0,1800, 90,180,1530,'credited'),
  -- G014 chain (BK-2026-001, B03=Gen Manager 10%, 450000 — showstopper demo)
  ('h100-0000-0000-0015','f1000000-0000-0000-0000-000000000007','g1000000-0000-0000-0000-000000000014','e1000000-0000-0000-0000-000000000003',0,'direct',     450000,10.0,0.0,10.0,45000,2250,4500,38250,'credited'),
  ('h100-0000-0000-0016','f1000000-0000-0000-0000-000000000007','g1000000-0000-0000-0000-000000000014','e1000000-0000-0000-0000-000000000002',1,'differential',450000,11.0,10.0,1.0, 4500, 225, 450, 3825,'credited'),
  ('h100-0000-0000-0017','f1000000-0000-0000-0000-000000000007','g1000000-0000-0000-0000-000000000014','e1000000-0000-0000-0000-000000000001',2,'differential',450000,12.0,11.0,1.0, 4500, 225, 450, 3825,'credited')
on conflict (id) do nothing;

-- ─────────────────────────────────────────────────────────────────────────
-- 11. WITHDRAWAL REQUESTS
-- ─────────────────────────────────────────────────────────────────────────
insert into withdrawal_requests (id, broker_id, amount, admin_charge_pct, tds_pct, net_amount, bank_name, account_no, ifsc, account_holder, status, utr, paid_at)
values
  ('i1000000-0000-0000-0000-000000000001','e1000000-0000-0000-0000-000000000001',500000,10,5,422500,'HDFC Bank','50200088881234','HDFC0001234','Rajiv Malhotra',  'paid',   'UTR2026040100001','2026-04-01'),
  ('i1000000-0000-0000-0000-000000000002','e1000000-0000-0000-0000-000000000002',200000,10,5,169000,'SBI',      '39876511110987','SBIN0012345','Poonam Arora',     'paid',   'UTR2026040100002','2026-04-02'),
  ('i1000000-0000-0000-0000-000000000003','e1000000-0000-0000-0000-000000000003',100000,10,5, 84500,'ICICI Bank','628705009991',  'ICIC0006287','Sandeep Rawat',    'approved',null,null),
  ('i1000000-0000-0000-0000-000000000004','e1000000-0000-0000-0000-000000000005', 80000,10,5, 67600,'HDFC Bank','50200077772222','HDFC0009988','Aakash Pandey',    'pending', null,null),
  ('i1000000-0000-0000-0000-000000000005','e1000000-0000-0000-0000-000000000007', 30000,10,5, 25350,'SBI',      '39876522223456','SBIN0023456','Vivek Srivastava', 'pending', null,null),
  ('i1000000-0000-0000-0000-000000000006','e1000000-0000-0000-0000-000000000010', 15000,10,5, 12675,'PNB',      '01234567890123','PUNB0012345','Anjana Mishra',    'rejected',null,null)
on conflict (id) do nothing;

-- ─────────────────────────────────────────────────────────────────────────
-- 12. ACHIEVERS CLUB (April 2026 month data)
--     Total fresh sales in April: 950 sqyd (BK-2026-004: 250) + (G015: 500) + others
--     Pool = 30000 sqyd total × ₹100 = ₹30,00,000 (using larger hypothetical month)
-- ─────────────────────────────────────────────────────────────────────────
insert into achievers_club_months (id, month_year, total_fresh_sq_yards, total_pool, qualifying_count, per_achiever_amount, monthly_instalment, status)
values
  ('j1000000-0000-0000-0000-000000000001','2026-02',12000,1200000,3, 400000,133333,'distributed'),
  ('j1000000-0000-0000-0000-000000000002','2026-03',18000,1800000,4, 450000,150000,'distributed'),
  ('j1000000-0000-0000-0000-000000000003','2026-04',30000,3000000,6, 500000,166667,'pending')
on conflict (id) do nothing;

insert into achievers_club_payouts (id, month_id, broker_id, instalment_no, amount, status, paid_at)
values
  -- Feb 2026 — 3 achievers × 3 instalments
  ('k100-0001','j1000000-0000-0000-0000-000000000001','e1000000-0000-0000-0000-000000000001',1,133333,'paid','2026-03-01'),
  ('k100-0002','j1000000-0000-0000-0000-000000000001','e1000000-0000-0000-0000-000000000002',1,133333,'paid','2026-03-01'),
  ('k100-0003','j1000000-0000-0000-0000-000000000001','e1000000-0000-0000-0000-000000000003',1,133333,'paid','2026-03-01'),
  ('k100-0004','j1000000-0000-0000-0000-000000000001','e1000000-0000-0000-0000-000000000001',2,133333,'paid','2026-04-01'),
  ('k100-0005','j1000000-0000-0000-0000-000000000001','e1000000-0000-0000-0000-000000000002',2,133333,'paid','2026-04-01'),
  ('k100-0006','j1000000-0000-0000-0000-000000000001','e1000000-0000-0000-0000-000000000003',2,133333,'paid','2026-04-01'),
  ('k100-0007','j1000000-0000-0000-0000-000000000001','e1000000-0000-0000-0000-000000000001',3,133334,'paid','2026-05-01'),
  ('k100-0008','j1000000-0000-0000-0000-000000000001','e1000000-0000-0000-0000-000000000002',3,133334,'paid','2026-05-01'),
  ('k100-0009','j1000000-0000-0000-0000-000000000001','e1000000-0000-0000-0000-000000000003',3,133334,'paid','2026-05-01'),
  -- Apr 2026 — 6 achievers, instalment 1 pending
  ('k100-0010','j1000000-0000-0000-0000-000000000003','e1000000-0000-0000-0000-000000000001',1,166667,'pending',null),
  ('k100-0011','j1000000-0000-0000-0000-000000000003','e1000000-0000-0000-0000-000000000002',1,166667,'pending',null),
  ('k100-0012','j1000000-0000-0000-0000-000000000003','e1000000-0000-0000-0000-000000000003',1,166667,'pending',null),
  ('k100-0013','j1000000-0000-0000-0000-000000000003','e1000000-0000-0000-0000-000000000004',1,166667,'pending',null),
  ('k100-0014','j1000000-0000-0000-0000-000000000003','e1000000-0000-0000-0000-000000000005',1,166667,'pending',null),
  ('k100-0015','j1000000-0000-0000-0000-000000000003','e1000000-0000-0000-0000-000000000006',1,166665,'pending',null)
on conflict (id) do nothing;

-- ─────────────────────────────────────────────────────────────────────────
-- 13. TEAM REWARD CLAIMS
-- ─────────────────────────────────────────────────────────────────────────
insert into broker_reward_claims (id, broker_id, tier_id, status, payment_gate_met, qualifying_sq_yards, capped_sq_yards, claimed_at)
select
  'l100-000' || lpad(row_number() over ()::text, 2, '0'),
  b.broker_id,
  t.id,
  case when b.capped_yards >= t.required_sq_yards and b.pay_gate then 'approved' else 'pending' end,
  b.pay_gate,
  b.raw_yards,
  b.capped_yards,
  case when b.capped_yards >= t.required_sq_yards and b.pay_gate then now() - interval '15 days' else null end
from
  (values
    ('e1000000-0000-0000-0000-000000000001'::uuid, 62000, 41333, true),
    ('e1000000-0000-0000-0000-000000000002'::uuid, 31000, 20666, true),
    ('e1000000-0000-0000-0000-000000000003'::uuid, 18000, 12000, true),
    ('e1000000-0000-0000-0000-000000000005'::uuid, 20500, 13667, true),
    ('e1000000-0000-0000-0000-000000000004'::uuid, 13500,  9000, false)
  ) as b(broker_id, raw_yards, capped_yards, pay_gate),
  team_reward_tiers t
where t.is_active = true
on conflict do nothing;

-- ─────────────────────────────────────────────────────────────────────────
-- 14. EXPENSES
-- ─────────────────────────────────────────────────────────────────────────
insert into expense_heads (id, name)
values
  ('m100-0001','Marketing & Advertising'),
  ('m100-0002','Office Rent'),
  ('m100-0003','Staff Salary'),
  ('m100-0004','Travel & Conveyance'),
  ('m100-0005','Site Development'),
  ('m100-0006','Legal & Professional')
on conflict do nothing;

insert into expenses (id, head_id, item_name, amount, description, expense_date)
values
  ('n100-0001','m100-0001','Facebook & Google Ads — April',  85000,  'Digital campaign for Green Valley',  '2026-04-01'),
  ('n100-0002','m100-0001','Hoardings & Banners',            42000,  '10 hoardings across Delhi-NCR',       '2026-04-05'),
  ('n100-0003','m100-0002','Office Rent — April',            55000,  'Gurugram main office',                '2026-04-01'),
  ('n100-0004','m100-0003','Sales Team Salary — April',     320000,  '8 staff members',                    '2026-04-30'),
  ('n100-0005','m100-0003','Admin Staff Salary — April',    180000,  '4 admin staff',                      '2026-04-30'),
  ('n100-0006','m100-0004','Site Visit Cab Charges',          8500,  '22 customer site visits',             '2026-04-15'),
  ('n100-0007','m100-0004','Flight — Lucknow Broker Meet',   14200,  'Quarterly broker summit',             '2026-04-20'),
  ('n100-0008','m100-0005','Boundary Wall Construction',    250000,  'Phase 1 — Green Valley boundary',    '2026-03-15'),
  ('n100-0009','m100-0005','Road Levelling Work',           175000,  'Internal roads — Royal Residency',   '2026-04-10'),
  ('n100-0010','m100-0006','Stamp Duty Legal Fees',          22000,  'Q1 legal retainer',                  '2026-04-25'),
  ('n100-0011','m100-0001','Broker Awards Ceremony',         68000,  'Quarterly achievers felicitation',   '2026-04-28'),
  ('n100-0012','m100-0002','Storage Unit Rent',              12000,  'Document storage facility',          '2026-04-01')
on conflict do nothing;

-- ─────────────────────────────────────────────────────────────────────────
-- 15. SUPPORT TICKETS
-- ─────────────────────────────────────────────────────────────────────────
insert into tickets (id, ticket_no, user_name, section_id, subject, status, priority, created_at)
select
  'o100-000' || lpad(n::text,2,'0'),
  'TKT-2026-' || lpad(n::text,4,'0'),
  name, sec_id, subj, st, pri,
  now() - (interval '1 day' * offset_days)
from (values
  (1,'Rajiv Malhotra',   (select id from ticket_sections where name='Billing Support'),  'Withdrawal not credited after 5 days',              'open',       'urgent', 2),
  (2,'Poonam Arora',     (select id from ticket_sections where name='Technical Support'), 'Login issue on mobile browser',                     'in_progress','high',   4),
  (3,'Sandeep Rawat',    (select id from ticket_sections where name='Sales'),             'Commission amount mismatch on BK-2025-003',         'open',       'high',   3),
  (4,'Aakash Pandey',    (select id from ticket_sections where name='Billing Support'),   'Payout not calculated for April instalment',        'open',       'normal', 1),
  (5,'Seema Tiwari',     (select id from ticket_sections where name='General'),           'How to update bank account details?',               'closed',     'low',    10),
  (6,'Vivek Srivastava', (select id from ticket_sections where name='Technical Support'), 'OTP not received during broker registration',       'closed',     'normal', 15),
  (7,'Nisha Kapoor',     (select id from ticket_sections where name='Sales'),             'Plot GV-A101 availability query',                   'in_progress','normal', 5),
  (8,'Manisha Dubey',    (select id from ticket_sections where name='Billing Support'),   'TDS certificate for FY 2025-26 required',           'open',       'high',   1)
) as t(n, name, sec_id, subj, st, pri, offset_days)
on conflict do nothing;

-- ─────────────────────────────────────────────────────────────────────────
-- 16. NEWS & EVENTS
-- ─────────────────────────────────────────────────────────────────────────
insert into news_events (id, title, post_type, description, publish_from, publish_to, is_active, state)
values
  ('p100-0001','Fanbe Green Valley — Phase 2 Launch!',          'event',  'We are proud to announce Phase 2 of Green Valley with 100 new plots. Book your plot at the early-bird rate before 31st May 2026.','2026-05-01','2026-05-31',true, 'published'),
  ('p100-0002','April 2026 Achievers Club Felicitation',        'news',   '6 top brokers qualified for the April Achievers Club. Total pool: ₹30,00,000. Congratulations to all winners!',              '2026-05-01','2026-05-15',true, 'published'),
  ('p100-0003','Payout Processed — April 2026',                 'news',   'All pending payout distributions for March & April have been processed. Please check your broker wallet.',                  '2026-05-01','2026-05-10',true, 'published'),
  ('p100-0004','Broker Summit — Lucknow, 20th April',           'event',  'Quarterly broker summit held in Lucknow with 120+ attendees. Rank certificates distributed to all promoted brokers.',       '2026-04-20','2026-04-20',false,'archived'),
  ('p100-0005','New Commission Policy Effective May 2026',      'news',   'Revised commission slabs and rank qualification criteria are now live. Please review your dashboard for updated rank status.', '2026-05-01','2026-05-31',true, 'published'),
  ('p100-0006','KYC Reminder — Pending Brokers',                'popup',  'Brokers with pending KYC must submit documents by 15th May 2026 to avoid payout suspension.',                           '2026-05-01','2026-05-15',true, 'published')
on conflict do nothing;

-- ─────────────────────────────────────────────────────────────────────────
-- 17. INQUIRIES (lead funnel demo)
-- ─────────────────────────────────────────────────────────────────000000--
insert into inquiries (id, name, mobile, email, project_id, agent_code, source, status, notes)
values
  ('q100-0001','Amit Kulkarni', '9812200001','amit.k@email.com',  'b1000000-0000-0000-0000-000000000001','FNB-008','website',  'new',       'Interested in 100 sqyd plot'),
  ('q100-0002','Priti Sharma',  '9812200002','priti.s@email.com', 'b1000000-0000-0000-0000-000000000002','FNB-009','referral', 'contacted', 'Called back. Wants site visit'),
  ('q100-0003','Ravi Gupta',    '9812200003','ravi.g@email.com',  'b1000000-0000-0000-0000-000000000001','FNB-003','social',   'qualified', 'Site visit done. Ready to book'),
  ('q100-0004','Meena Pillai',  '9812200004','meena.p@email.com', 'b1000000-0000-0000-0000-000000000002','FNB-005','walk_in',  'converted', 'Converted to booking BK-2026-004'),
  ('q100-0005','Tarun Bose',    '9812200005','tarun.b@email.com', 'b1000000-0000-0000-0000-000000000001','FNB-010','website',  'lost',      'Budget mismatch — requires smaller plot'),
  ('q100-0006','Shalini Tomar', '9812200006',null,                'b1000000-0000-0000-0000-000000000002','FNB-013','referral', 'new',       'Walked in at Agra office'),
  ('q100-0007','Vikram Nair',   '9812200007','vikram.n@email.com','b1000000-0000-0000-0000-000000000001','FNB-007','social',   'contacted', 'WhatsApp follow-up sent'),
  ('q100-0008','Divya Rao',     '9812200008','divya.r@email.com', 'b1000000-0000-0000-0000-000000000002','FNB-012','website',  'qualified', 'Loan pre-approval in progress')
on conflict do nothing;

-- ─────────────────────────────────────────────────────────────────────────
-- 18. app_settings — update company info
-- ─────────────────────────────────────────────────────────────────────────
insert into app_settings (key, value) values
  ('company_info', '{
    "name": "Fanbe Group Pvt Ltd",
    "gstin": "07AABCF1234H1Z5",
    "address": "Plot No. 12, Sector 44, Gurugram, Haryana — 122003",
    "phone": "1800-123-4567",
    "email": "admin@fanbegroup.com",
    "logo": ""
  }'::jsonb)
on conflict (key) do update
  set value = excluded.value, updated_at = now();

-- ═══════════════════════════════════════════════════════════════════════════
-- END OF DEMO SEED
-- ═══════════════════════════════════════════════════════════════════════════
