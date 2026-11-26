-- Separate daily image credits for Metadata Inspector and Watermark Maker.
create table if not exists public.cleanexif_tool_daily_usage (
  user_id uuid not null references auth.users(id) on delete cascade,
  usage_date date not null,
  tool_key text not null check (tool_key in ('metadata','watermark')),
  used_count integer not null default 0 check (used_count >= 0),
  updated_at timestamptz not null default now(),
  primary key (user_id, usage_date, tool_key)
);
alter table public.cleanexif_tool_daily_usage enable row level security;
revoke all on public.cleanexif_tool_daily_usage from anon, authenticated;

drop function if exists public.cleanexif_get_my_daily_usage();
create function public.cleanexif_get_my_daily_usage(p_tool text default 'metadata')
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
  if p_tool not in ('metadata','watermark') then raise exception 'Invalid CleanExif tool.'; end if;
  if v_user_id is null or v_email = '' then raise exception 'Sign in is required to use daily image credits.'; end if;
  select p.daily_images_limit into v_limit
  from public.cleanexif_customer_access a
  join public.cleanexif_plans p on p.id = a.plan_id
  where a.email = v_email and a.status = 'active' and p.active = true
    and a.starts_at <= now() and (a.expires_at is null or a.expires_at > now())
  order by a.created_at desc limit 1;
  if v_limit is null then
    select p.daily_images_limit into v_limit from public.cleanexif_plans p
    where p.code = 'free' and p.active = true limit 1;
  end if;
  select coalesce(u.used_count,0) into v_used
  from (select 1) seed
  left join public.cleanexif_tool_daily_usage u
    on u.user_id = v_user_id and u.usage_date = v_today and u.tool_key = p_tool;
  return query select v_used, coalesce(v_limit,10), greatest(coalesce(v_limit,10)-v_used,0),
    ((v_today+1)::timestamp at time zone 'Asia/Karachi');
end;
$$;

drop function if exists public.cleanexif_consume_daily_image();
create function public.cleanexif_consume_daily_image(p_tool text default 'metadata')
returns table(allowed boolean, used_count integer, daily_limit integer, remaining integer, resets_at timestamptz)
language plpgsql security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_email text := lower(coalesce(auth.jwt()->>'email',''));
  v_today date := (now() at time zone 'Asia/Karachi')::date;
  v_limit integer;
  v_used integer := 0;
  v_allowed boolean := false;
begin
  if p_tool not in ('metadata','watermark') then raise exception 'Invalid CleanExif tool.'; end if;
  if v_user_id is null or v_email = '' then raise exception 'Sign in is required to use daily image credits.'; end if;
  select p.daily_images_limit into v_limit
  from public.cleanexif_customer_access a
  join public.cleanexif_plans p on p.id = a.plan_id
  where a.email = v_email and a.status = 'active' and p.active = true
    and a.starts_at <= now() and (a.expires_at is null or a.expires_at > now())
  order by a.created_at desc limit 1;
  if v_limit is null then
    select p.daily_images_limit into v_limit from public.cleanexif_plans p
    where p.code = 'free' and p.active = true limit 1;
  end if;
  v_limit := coalesce(v_limit,10);
  insert into public.cleanexif_tool_daily_usage(user_id,usage_date,tool_key,used_count)
  values(v_user_id,v_today,p_tool,1)
  on conflict(user_id,usage_date,tool_key) do update
    set used_count = cleanexif_tool_daily_usage.used_count + 1, updated_at = now()
    where cleanexif_tool_daily_usage.used_count < v_limit
  returning cleanexif_tool_daily_usage.used_count into v_used;
  if found then v_allowed := true;
  else
    select u.used_count into v_used from public.cleanexif_tool_daily_usage u
    where u.user_id = v_user_id and u.usage_date = v_today and u.tool_key = p_tool;
  end if;
  return query select v_allowed, coalesce(v_used,0), v_limit, greatest(v_limit-coalesce(v_used,0),0),
    ((v_today+1)::timestamp at time zone 'Asia/Karachi');
end;
$$;

revoke all on function public.cleanexif_get_my_daily_usage(text) from public, anon;
revoke all on function public.cleanexif_consume_daily_image(text) from public, anon;
grant execute on function public.cleanexif_get_my_daily_usage(text) to authenticated;
grant execute on function public.cleanexif_consume_daily_image(text) to authenticated;
