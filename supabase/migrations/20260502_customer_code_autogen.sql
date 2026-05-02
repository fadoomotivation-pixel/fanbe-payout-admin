-- Auto-generate customer_code on bp_customers + sequence so every customer
-- gets a CR-XXXX ID at the time of booking, regardless of who creates them.

alter table bp_customers
  add column if not exists customer_code text unique;

create sequence if not exists bp_customers_code_seq start 1001;

create or replace function bp_customers_set_code() returns trigger
language plpgsql as $$
begin
  if new.customer_code is null or new.customer_code = '' then
    new.customer_code := 'CR-' || lpad(nextval('bp_customers_code_seq')::text, 4, '0');
  end if;
  return new;
end;
$$;

drop trigger if exists trg_bp_customers_set_code on bp_customers;
create trigger trg_bp_customers_set_code
  before insert on bp_customers
  for each row execute function bp_customers_set_code();

-- Backfill existing rows that don't have a code
do $$
declare r record;
begin
  for r in select id from bp_customers where customer_code is null or customer_code = '' loop
    update bp_customers
      set customer_code = 'CR-' || lpad(nextval('bp_customers_code_seq')::text, 4, '0')
      where id = r.id;
  end loop;
end $$;
