-- CleanExif Admin: plans, manual customer activations and audit trail.
-- Apply in Supabase SQL Editor. No customer-facing access is granted by these tables.

create table if not exists public.cleanexif_admin_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create or replace function public.is_cleanexif_admin()
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select exists (select 1 from public.cleanexif_admin_users where user_id = auth.uid());
$$;

revoke all on function public.is_cleanexif_admin() from public;
grant execute on function public.is_cleanexif_admin() to authenticated;

create table if not exists public.cleanexif_plans (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[a-z0-9-]{2,40}$'),
  name text not null check (char_length(name) between 2 and 60),
  description text,
  price_monthly numeric(10,2) not null default 0 check (price_monthly >= 0),
  watermark_images_per_batch integer not null default 10 check (watermark_images_per_batch > 0),
  watermark_total_mb integer not null default 100 check (watermark_total_mb > 0),
  max_file_mb integer not null default 25 check (max_file_mb > 0),
  active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.cleanexif_customer_access (
  id uuid primary key default gen_random_uuid(),
  email text not null check (email = lower(email)),
  whatsapp text,
  plan_id uuid not null references public.cleanexif_plans(id) on delete restrict,
  status text not null default 'active' check (status in ('active','pending','expired','cancelled')),
  starts_at timestamptz not null default now(),
  expires_at timestamptz,
  notes text,
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (expires_at is null or expires_at > starts_at)
);
create index if not exists cleanexif_customer_access_email_idx on public.cleanexif_customer_access(email);
create index if not exists cleanexif_customer_access_status_idx on public.cleanexif_customer_access(status, expires_at);
create index if not exists cleanexif_customer_access_plan_idx on public.cleanexif_customer_access(plan_id);

create table if not exists public.cleanexif_admin_audit (
  id bigint generated always as identity primary key,
  actor uuid not null default auth.uid() references auth.users(id),
  action text not null,
  entity_type text not null,
  entity_id text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.cleanexif_admin_users enable row level security;
alter table public.cleanexif_plans enable row level security;
alter table public.cleanexif_customer_access enable row level security;
alter table public.cleanexif_admin_audit enable row level security;

drop policy if exists "Admins can read own admin record" on public.cleanexif_admin_users;
create policy "Admins can read own admin record" on public.cleanexif_admin_users
for select to authenticated using (user_id = auth.uid());

drop policy if exists "CleanExif admins manage plans" on public.cleanexif_plans;
create policy "CleanExif admins manage plans" on public.cleanexif_plans
for all to authenticated using (public.is_cleanexif_admin()) with check (public.is_cleanexif_admin());

drop policy if exists "CleanExif admins manage customer access" on public.cleanexif_customer_access;
create policy "CleanExif admins manage customer access" on public.cleanexif_customer_access
for all to authenticated using (public.is_cleanexif_admin()) with check (public.is_cleanexif_admin());

drop policy if exists "CleanExif admins read audit" on public.cleanexif_admin_audit;
create policy "CleanExif admins read audit" on public.cleanexif_admin_audit
for select to authenticated using (public.is_cleanexif_admin());

create or replace function public.cleanexif_admin_audit_trigger()
returns trigger language plpgsql security definer set search_path = public
as $$
declare
  row_id text;
  action_name text;
begin
  if tg_op = 'DELETE' then row_id := old.id::text; action_name := 'delete';
  elsif tg_op = 'UPDATE' then row_id := new.id::text; action_name := 'update';
  else row_id := new.id::text; action_name := 'insert'; end if;
  insert into public.cleanexif_admin_audit(action,entity_type,entity_id,details)
  values(action_name,tg_table_name,row_id,jsonb_build_object('changed_at',now()));
  if tg_op = 'DELETE' then return old; else return new; end if;
end $$;

drop trigger if exists cleanexif_plans_audit on public.cleanexif_plans;
create trigger cleanexif_plans_audit after insert or update or delete on public.cleanexif_plans
for each row execute function public.cleanexif_admin_audit_trigger();
drop trigger if exists cleanexif_customer_access_audit on public.cleanexif_customer_access;
create trigger cleanexif_customer_access_audit after insert or update or delete on public.cleanexif_customer_access
for each row execute function public.cleanexif_admin_audit_trigger();

insert into public.cleanexif_plans(code,name,description,price_monthly,watermark_images_per_batch,watermark_total_mb,max_file_mb,active,sort_order)
values ('free','Free','Starter watermark allowance',0,10,100,25,true,0)
on conflict (code) do nothing;

grant select, insert, update, delete on public.cleanexif_plans to authenticated;
grant select, insert, update, delete on public.cleanexif_customer_access to authenticated;
grant select on public.cleanexif_admin_audit to authenticated;
grant select on public.cleanexif_admin_users to authenticated;

-- Bootstrap: create an Auth user in Supabase Authentication, then run:
-- insert into public.cleanexif_admin_users(user_id)
-- select id from auth.users where email = 'YOUR_ADMIN_EMAIL';
