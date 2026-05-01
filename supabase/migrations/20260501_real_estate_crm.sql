-- Real Estate CRM upgrade: tables to beat competitor demo (DIGIATURE iNet Revolution)
-- Skips e-pin/registration code generation per business requirement.

create extension if not exists pgcrypto;

-- ========== Inquiries (lead funnel) ==========
create table if not exists inquiries (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  mobile text not null,
  email text,
  address text,
  project_id uuid,
  agent_code text,
  source text default 'website',
  status text default 'new' check (status in ('new','contacted','qualified','converted','lost')),
  notes text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create index if not exists idx_inquiries_status on inquiries(status);
create index if not exists idx_inquiries_agent on inquiries(agent_code);

-- ========== Registry Members (pre-customer) ==========
create table if not exists registry_members (
  id uuid primary key default gen_random_uuid(),
  member_code text unique not null,
  name text not null,
  mobile text not null,
  email text,
  city text,
  state text,
  address text,
  aadhaar text,
  pan text,
  aadhaar_image text,
  pan_image text,
  profile_image text,
  marital_status text,
  is_customer boolean default false,
  customer_id uuid,
  created_by uuid,
  created_at timestamptz default now()
);
create index if not exists idx_registry_members_mobile on registry_members(mobile);

-- ========== Customers (confirmed buyers) ==========
create table if not exists customers (
  id uuid primary key default gen_random_uuid(),
  customer_code text unique not null,
  registry_member_id uuid references registry_members(id),
  name text not null,
  mobile text not null,
  email text,
  city text,
  state text,
  address text,
  aadhaar text,
  pan text,
  marital_status text,
  age int,
  profile_image text,
  created_at timestamptz default now()
);

-- ========== EMI schedules ==========
create table if not exists emi_schedules (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null,
  customer_id uuid,
  frequency text not null check (frequency in ('monthly','quarterly','half_yearly','annual')),
  start_date date not null,
  num_installments int not null,
  principal numeric(14,2) not null,
  interest_rate_pct numeric(6,3) default 0,
  interest_method text default 'flat' check (interest_method in ('flat','reducing')),
  total_payable numeric(14,2) not null,
  status text default 'active' check (status in ('active','closed','defaulted')),
  created_at timestamptz default now()
);

create table if not exists emi_installments (
  id uuid primary key default gen_random_uuid(),
  schedule_id uuid not null references emi_schedules(id) on delete cascade,
  seq int not null,
  due_date date not null,
  amount numeric(14,2) not null,
  principal_component numeric(14,2) default 0,
  interest_component numeric(14,2) default 0,
  late_fee numeric(14,2) default 0,
  cheque_bounce_charge numeric(14,2) default 0,
  paid_amount numeric(14,2) default 0,
  paid_at timestamptz,
  status text default 'pending' check (status in ('pending','partial','paid','overdue')),
  payment_id uuid
);
create index if not exists idx_emi_inst_due on emi_installments(due_date,status);

-- ========== Expense heads + entries ==========
create table if not exists expense_heads (
  id uuid primary key default gen_random_uuid(),
  name text unique not null,
  description text,
  active boolean default true,
  created_at timestamptz default now()
);

create table if not exists expenses (
  id uuid primary key default gen_random_uuid(),
  head_id uuid references expense_heads(id),
  item_name text not null,
  amount numeric(14,2) not null,
  description text,
  slip_url text,
  expense_date date default current_date,
  added_by uuid,
  created_at timestamptz default now()
);
create index if not exists idx_expenses_date on expenses(expense_date);

-- ========== Withdrawal requests ==========
create table if not exists withdrawal_requests (
  id uuid primary key default gen_random_uuid(),
  broker_id uuid not null,
  amount numeric(14,2) not null,
  admin_charge_pct numeric(5,2) default 0,
  tds_pct numeric(5,2) default 0,
  net_amount numeric(14,2) not null,
  bank_name text,
  account_no text,
  ifsc text,
  account_holder text,
  status text default 'pending' check (status in ('pending','approved','rejected','paid')),
  rejection_reason text,
  approved_by uuid,
  approved_at timestamptz,
  paid_at timestamptz,
  utr text,
  created_at timestamptz default now()
);
create index if not exists idx_withdrawals_status on withdrawal_requests(status);

-- ========== Support tickets ==========
create table if not exists ticket_sections (
  id uuid primary key default gen_random_uuid(),
  name text unique not null,
  active boolean default true
);
insert into ticket_sections(name) values ('Technical Support'),('Billing Support'),('Sales'),('General')
  on conflict do nothing;

create table if not exists tickets (
  id uuid primary key default gen_random_uuid(),
  ticket_no text unique not null,
  user_id uuid,
  user_name text,
  section_id uuid references ticket_sections(id),
  subject text not null,
  status text default 'open' check (status in ('open','in_progress','closed')),
  priority text default 'normal' check (priority in ('low','normal','high','urgent')),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists ticket_messages (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references tickets(id) on delete cascade,
  sender_id uuid,
  sender_role text,
  message text not null,
  attachment_url text,
  created_at timestamptz default now()
);

-- ========== News, events, popups ==========
create table if not exists news_events (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  post_type text default 'news' check (post_type in ('news','event','popup')),
  description text,
  image_url text,
  publish_from date,
  publish_to date,
  is_active boolean default true,
  state text default 'draft' check (state in ('draft','published','archived')),
  created_at timestamptz default now()
);

-- ========== Roles, permissions, multi-admin ==========
create table if not exists roles (
  id uuid primary key default gen_random_uuid(),
  name text unique not null,
  description text,
  is_system boolean default false,
  created_at timestamptz default now()
);
insert into roles(name,is_system) values ('super_admin',true),('admin',true),('office_incharge',true),('finance_officer',true),('accountant',false)
  on conflict do nothing;

create table if not exists role_permissions (
  id uuid primary key default gen_random_uuid(),
  role_id uuid not null references roles(id) on delete cascade,
  permission text not null,
  unique(role_id,permission)
);

create table if not exists app_users (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid unique,
  name text not null,
  email text unique not null,
  role_id uuid references roles(id),
  active boolean default true,
  created_at timestamptz default now()
);

-- ========== Company bank accounts ==========
create table if not exists company_bank_accounts (
  id uuid primary key default gen_random_uuid(),
  bank_name text not null,
  account_holder text not null,
  account_no text not null,
  ifsc text not null,
  account_type text default 'current' check (account_type in ('current','savings')),
  opening_balance numeric(14,2) default 0,
  bank_logo text,
  is_default boolean default false,
  active boolean default true,
  created_at timestamptz default now()
);

-- ========== Commission rank slabs (master commission) ==========
create table if not exists commission_ranks (
  id uuid primary key default gen_random_uuid(),
  rank_name text unique not null,
  level int not null,
  min_business numeric(14,2) not null,
  max_business numeric(14,2),
  income_amount numeric(14,2) not null,
  income_pct numeric(6,3) default 0,
  active boolean default true
);
insert into commission_ranks(rank_name,level,min_business,max_business,income_amount,income_pct) values
  ('Associate',1,0,500000,5000,1.0),
  ('Senior Associate',2,500000,1500000,15000,1.5),
  ('Manager',3,1500000,3000000,40000,2.0),
  ('Senior Manager',4,3000000,5000000,75000,2.5),
  ('Director',5,5000000,10000000,150000,3.0),
  ('Senior Director',6,10000000,25000000,400000,3.5),
  ('President',7,25000000,null,1000000,4.0)
  on conflict do nothing;

-- ========== Sponsor tree (upline chain for brokers) ==========
create table if not exists sponsor_tree (
  broker_id uuid primary key,
  sponsor_id uuid,
  level int default 1,
  path uuid[] default '{}',
  created_at timestamptz default now()
);
create index if not exists idx_sponsor_tree_sponsor on sponsor_tree(sponsor_id);

-- ========== Auto payout distributions ==========
create table if not exists payout_distributions (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null,
  payment_id uuid,
  beneficiary_broker_id uuid not null,
  level int not null,
  income_type text not null,
  base_amount numeric(14,2) not null,
  rate_pct numeric(6,3) not null,
  gross_payout numeric(14,2) not null,
  tds_amount numeric(14,2) default 0,
  admin_charge numeric(14,2) default 0,
  net_payout numeric(14,2) not null,
  status text default 'credited' check (status in ('credited','withdrawn','reversed')),
  created_at timestamptz default now()
);
create index if not exists idx_payout_dist_broker on payout_distributions(beneficiary_broker_id);
create index if not exists idx_payout_dist_booking on payout_distributions(booking_id);

-- ========== Customer ledger view ==========
create or replace view customer_ledger as
select
  c.id as customer_id,
  c.customer_code,
  c.name,
  c.mobile,
  count(distinct b.id) as bookings,
  coalesce(sum(b.cost),0) as total_cost,
  coalesce(sum(case when p.status='approved' then p.amount else 0 end),0) as total_paid,
  coalesce(sum(b.cost),0) - coalesce(sum(case when p.status='approved' then p.amount else 0 end),0) as pending
from customers c
left join bookings b on b.customer_id = c.id
left join payments p on p.booking_id = b.id
group by c.id, c.customer_code, c.name, c.mobile;

-- ========== Global settings ==========
create table if not exists app_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz default now()
);
insert into app_settings(key,value) values
  ('payout_config', '{"admin_charge_pct":10,"tds_pct":5,"min_withdrawal":1000,"income1_pct":5,"income2_pct":2,"income3_pct":1,"max_levels":5}'::jsonb),
  ('emi_config', '{"default_late_fee":200,"default_bounce_charge":500,"grace_days":3}'::jsonb),
  ('company_info', '{"name":"Your Company","gstin":"","address":"","logo":""}'::jsonb)
  on conflict do nothing;
