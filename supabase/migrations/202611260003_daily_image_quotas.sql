-- Server-side daily image quotas for the EXIF cleaning tool.
-- Daily boundaries use Asia/Karachi. A successful image clean consumes one credit.

drop function if exists public.cleanexif_get_my_access();

alter table public.cleanexif_plans
  add column if not exists daily_images_limit integer not null default 10
  check (daily_images_limit > 0);

update public.cleanexif_plans
set daily_images_limit = case code when 'free' then 10 when 'pro' then 50 when 'business' then 200 else daily_images_limit end
where code in ('free','pro','business');

create function public.cleanexif_get_my_access()
returns table(plan_code text,plan_name text,watermark_images_per_batch integer,watermark_total_mb integer,max_file_mb integer,daily_images_limit integer,expires_at timestamptz)
language sql stable security definer set search_path=public,auth
as $$
 select p.code,p.name,p.watermark_images_per_batch,p.watermark_total_mb,p.max_file_mb,p.daily_images_limit,a.expires_at
 from public.cleanexif_customer_access a
 join public.cleanexif_plans p on p.id=a.plan_id
 where auth.uid() is not null
   and a.email=lower(coalesce(auth.jwt()->>'email',''))
   and a.status='active' and p.active=true
   and a.starts_at<=now() and (a.expires_at is null or a.expires_at>now())
 order by a.created_at desc limit 1;
$$;
revoke all on function public.cleanexif_get_my_access() from public,anon;
grant execute on function public.cleanexif_get_my_access() to authenticated;

create table if not exists public.cleanexif_daily_usage (
  user_id uuid not null references auth.users(id) on delete cascade,
  usage_date date not null,
  used_count integer not null default 0 check (used_count >= 0),
  updated_at timestamptz not null default now(),
  primary key (user_id, usage_date)
);
alter table public.cleanexif_daily_usage enable row level security;
revoke all on public.cleanexif_daily_usage from anon, authenticated;

create or replace function public.cleanexif_get_my_daily_usage()
returns table(used_count integer, daily_limit integer, remaining integer, resets_at timestamptz)
language plpgsql stable security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_email text := lower(coalesce(auth.jwt()->>'email',''));
  v_today date := (now() at time zone 'Asia/Karachi')::date;
  v_limit integer;
  v_used integer := 0;
begin
  if v_user_id is null or v_email = '' then raise exception 'Sign in is required to use daily image credits.'; end if;
  select p.daily_images_limit into v_limit
  from public.cleanexif_customer_access a join public.cleanexif_plans p on p.id=a.plan_id
  where a.email=v_email and a.status='active' and p.active=true and a.starts_at<=now()
    and (a.expires_at is null or a.expires_at>now())
  order by a.created_at desc limit 1;
  if v_limit is null then
    select daily_images_limit into v_limit from public.cleanexif_plans where code='free' and active=true limit 1;
  end if;
  select coalesce((select u.used_count from public.cleanexif_daily_usage u where u.user_id=v_user_id and u.usage_date=v_today),0) into v_used;
  return query select v_used,coalesce(v_limit,10),greatest(coalesce(v_limit,10)-v_used,0),
    ((v_today+1)::timestamp at time zone 'Asia/Karachi');
end;
$$;

create or replace function public.cleanexif_consume_daily_image()
returns table(allowed boolean, used_count integer, daily_limit integer, remaining integer, resets_at timestamptz)
language plpgsql security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_email text := lower(coalesce(auth.jwt()->>'email',''));
  v_today date := (now() at time zone 'Asia/Karachi')::date;
  v_limit integer;
  v_used integer;
  v_allowed boolean := false;
begin
  if v_user_id is null or v_email = '' then raise exception 'Sign in is required to use daily image credits.'; end if;
  select p.daily_images_limit into v_limit
  from public.cleanexif_customer_access a join public.cleanexif_plans p on p.id=a.plan_id
  where a.email=v_email and a.status='active' and p.active=true and a.starts_at<=now()
    and (a.expires_at is null or a.expires_at>now())
  order by a.created_at desc limit 1;
  if v_limit is null then
    select daily_images_limit into v_limit from public.cleanexif_plans where code='free' and active=true limit 1;
  end if;
  v_limit := coalesce(v_limit,10);

  insert into public.cleanexif_daily_usage(user_id,usage_date,used_count)
  values(v_user_id,v_today,1)
  on conflict(user_id,usage_date) do update
    set used_count=public.cleanexif_daily_usage.used_count+1,updated_at=now()
    where public.cleanexif_daily_usage.used_count<v_limit
  returning cleanexif_daily_usage.used_count into v_used;

  if found then v_allowed:=true;
  else
    select used_count into v_used from public.cleanexif_daily_usage
    where user_id=v_user_id and usage_date=v_today;
  end if;
  return query select v_allowed,coalesce(v_used,0),v_limit,greatest(v_limit-coalesce(v_used,0),0),
    ((v_today+1)::timestamp at time zone 'Asia/Karachi');
end;
$$;

revoke all on function public.cleanexif_get_my_daily_usage() from public,anon;
revoke all on function public.cleanexif_consume_daily_image() from public,anon;
grant execute on function public.cleanexif_get_my_daily_usage() to authenticated;
grant execute on function public.cleanexif_consume_daily_image() to authenticated;
