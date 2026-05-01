-- Adds sponsor chain + KYC + bank + auth link to brokers (idempotent)
alter table brokers
  add column if not exists sponsor_id       uuid references brokers(id),
  add column if not exists auth_user_id     uuid unique,
  add column if not exists date_of_joining  date,
  add column if not exists bank_name        text,
  add column if not exists account_no       text,
  add column if not exists ifsc             text,
  add column if not exists account_holder   text,
  add column if not exists aadhaar_no       text;

create index if not exists idx_brokers_sponsor on brokers(sponsor_id);
create index if not exists idx_brokers_auth    on brokers(auth_user_id);
