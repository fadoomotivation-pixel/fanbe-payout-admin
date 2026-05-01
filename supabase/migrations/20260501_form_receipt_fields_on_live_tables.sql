-- Add physical-form & receipt fields onto the LIVE tables used by the UI
-- (bp_customers, bp_bookings, bp_payments + registry_members).
-- Earlier migration targeted customers/bookings/payments which are different tables
-- in this monorepo and not driven by the live admin UI.

alter table bp_customers
  add column if not exists father_or_husband_name text,
  add column if not exists dob                    date,
  add column if not exists email                  text,
  add column if not exists address                text,
  add column if not exists pan                    text,
  add column if not exists nominee_name           text,
  add column if not exists nominee_relation       text,
  add column if not exists nominee_dob            date,
  add column if not exists nominee_father_name    text,
  add column if not exists nominee_address        text,
  add column if not exists nominee_pan            text;

alter table bp_bookings
  add column if not exists scheme_name            text,
  add column if not exists application_date       date,
  add column if not exists booking_time           time,
  add column if not exists customer_bank_name     text,
  add column if not exists upline_broker_code     text,
  add column if not exists manager_signature_by   text,
  add column if not exists affidavit_accepted     boolean default true;

alter table bp_payments
  add column if not exists receipt_no             text,
  add column if not exists drawn_on_bank          text,
  add column if not exists branch                 text,
  add column if not exists instalment_no          int,
  add column if not exists rupees_in_words        text,
  add column if not exists sponsor_name           text,
  add column if not exists is_cash_adjustment     boolean default false,
  add column if not exists subject_to_realisation boolean default true;

alter table registry_members
  add column if not exists father_or_husband_name text,
  add column if not exists dob                    date,
  add column if not exists nominee_name           text,
  add column if not exists nominee_relation       text,
  add column if not exists nominee_dob            date,
  add column if not exists nominee_father_name    text,
  add column if not exists nominee_address        text,
  add column if not exists nominee_pan            text;

-- Auto-increment receipt counter (mimics paper book starting at 6301)
create sequence if not exists bp_payments_receipt_seq start 6301;

create or replace function next_receipt_no() returns text language sql as $$
  select nextval('bp_payments_receipt_seq')::text;
$$;
