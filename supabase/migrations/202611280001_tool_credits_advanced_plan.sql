-- Per-tool daily credits, Advanced plan, and admin usage reporting.
-- Additive only: existing subscriptions and daily usage are retained.

alter table public.cleanexif_plans
  add column if not exists metadata_daily_limit integer not null default 10 check (metadata_daily_limit >= 0),
  add column if not exists watermark_daily_limit integer not null default 10 check (watermark_daily_limit >= 0),
  add column if not exists gps_daily_limit integer not null default 5 check (gps_daily_limit >= 0),
  add column if not exists scanner_daily_limit integer not null default 5 check (scanner_daily_limit >= 0),
  add column if not exists editor_daily_limit integer not null default 2 check (editor_daily_limit >= 0);

-- Migrate each existing plan without changing its legacy cleaner allowance.
update public.cleanexif_plans
set metadata_daily_limit = daily_images_limit,
    watermark_daily_limit = daily_images_limit,
    gps_daily_limit = case code
      when 'free' then 5
      when 'pro' then 25
      when 'business' then 100
      when 'advanced' then 250
      else greatest(1, floor(daily_images_limit * 0.5)::integer)
    end,
    scanner_daily_limit = case code
      when 'free' then 5
      when 'pro' then 50
      when 'business' then 200
      when 'advanced' then 500
      else daily_images_limit
    end,
    editor_daily_limit = case code
      when 'free' then 2
      when 'pro' then 25
      when 'business' then 100
      when 'advanced' then 250
      else greatest(1, floor(daily_images_limit * 0.5)::integer)
    end;

-- Existing usage rows are preserved; the same table now accepts all five tools.
alter table public.cleanexif_tool_daily_usage
  drop constraint if exists cleanexif_tool_daily_usage_tool_key_check;
alter table public.cleanexif_tool_daily_usage
  add constraint cleanexif_tool_daily_usage_tool_key_check
  check (tool_key in ('metadata','watermark','gps','scanner','editor'));

-- New premium tier. Existing Free, Pro and Business plans are not overwritten.
insert into public.cleanexif_plans
  (code,name,description,price_monthly,watermark_images_per_batch,watermark_total_mb,max_file_mb,
   daily_images_limit,metadata_daily_limit,watermark_daily_limit,gps_daily_limit,scanner_daily_limit,
   editor_daily_limit,active,sort_order)
values
  ('advanced','Advanced','For agencies and power users with higher daily image allowances and large local batches.',
   24.99,300,1024,100,500,500,500,250,500,250,true,3)
on conflict (code) do update
set name=excluded.name,
    description=excluded.description,
    price_monthly=excluded.price_monthly,
    watermark_images_per_batch=excluded.watermark_images_per_batch,
    watermark_total_mb=excluded.watermark_total_mb,
    max_file_mb=excluded.max_file_mb,
    daily_images_limit=excluded.daily_images_limit,
    metadata_daily_limit=excluded.metadata_daily_limit,
    watermark_daily_limit=excluded.watermark_daily_limit,
    gps_daily_limit=excluded.gps_daily_limit,
    scanner_daily_limit=excluded.scanner_daily_limit,
    editor_daily_limit=excluded.editor_daily_limit,
    active=true,
    sort_order=excluded.sort_order;

-- Extend the authenticated entitlement RPC while retaining its legacy daily_images_limit output.
drop function if exists public.cleanexif_get_my_access();
create function public.cleanexif_get_my_access()
returns table(
  plan_code text,
  plan_name text,
  watermark_images_per_batch integer,
  watermark_total_mb integer,
  max_file_mb integer,
  daily_images_limit integer,
  metadata_daily_limit integer,
  watermark_daily_limit integer,
  gps_daily_limit integer,
  scanner_daily_limit integer,
  editor_daily_limit integer,
  expires_at timestamptz
)
language sql
stable
security definer
set search_path=''
as $$
  select p.code,p.name,p.watermark_images_per_batch,p.watermark_total_mb,p.max_file_mb,
         p.daily_images_limit,p.metadata_daily_limit,p.watermark_daily_limit,
         p.gps_daily_limit,p.scanner_daily_limit,p.editor_daily_limit,a.expires_at
  from public.cleanexif_customer_access a
  join public.cleanexif_plans p on p.id=a.plan_id
  where auth.uid() is not null
    and a.user_id=auth.uid()
    and a.status='active'
    and p.active=true
    and a.starts_at<=now()
    and (a.expires_at is null or a.expires_at>now())
  order by a.created_at desc
  limit 1;
$$;
revoke all on function public.cleanexif_get_my_access() from public,anon;
grant execute on function public.cleanexif_get_my_access() to authenticated;

create or replace function public.cleanexif_get_my_daily_usage(p_tool text default 'metadata')
returns table(used_count integer,daily_limit integer,remaining integer,resets_at timestamptz)
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v_user_id uuid:=auth.uid();
  v_today date:=(now() at time zone 'Asia/Karachi')::date;
  v_limit integer;
  v_used integer:=0;
begin
  if p_tool not in ('metadata','watermark','gps','scanner','editor') then
    raise exception 'Invalid CleanExif tool.';
  end if;
  if v_user_id is null then
    raise exception 'Sign in is required to use daily image credits.';
  end if;

  select case p_tool
    when 'metadata' then p.metadata_daily_limit
    when 'watermark' then p.watermark_daily_limit
    when 'gps' then p.gps_daily_limit
    when 'scanner' then p.scanner_daily_limit
    when 'editor' then p.editor_daily_limit
  end
  into v_limit
  from public.cleanexif_customer_access a
  join public.cleanexif_plans p on p.id=a.plan_id
  where a.user_id=v_user_id
    and a.status='active'
    and p.active=true
    and a.starts_at<=now()
    and (a.expires_at is null or a.expires_at>now())
  order by a.created_at desc
  limit 1;

  if v_limit is null then
    select case p_tool
      when 'metadata' then p.metadata_daily_limit
      when 'watermark' then p.watermark_daily_limit
      when 'gps' then p.gps_daily_limit
      when 'scanner' then p.scanner_daily_limit
      when 'editor' then p.editor_daily_limit
    end
    into v_limit
    from public.cleanexif_plans p
    where p.code='free' and p.active=true
    limit 1;
  end if;

  select coalesce(u.used_count,0)
  into v_used
  from (select 1) seed
  left join public.cleanexif_tool_daily_usage u
    on u.user_id=v_user_id
   and u.usage_date=v_today
   and u.tool_key=p_tool;

  v_limit:=coalesce(v_limit,0);
  return query
  select coalesce(v_used,0),v_limit,greatest(v_limit-coalesce(v_used,0),0),
         ((v_today+1)::timestamp at time zone 'Asia/Karachi');
end;
$$;

create or replace function public.cleanexif_consume_daily_image(p_tool text default 'metadata')
returns table(allowed boolean,used_count integer,daily_limit integer,remaining integer,resets_at timestamptz)
language plpgsql
security definer
set search_path=''
as $$
declare
  v_user_id uuid:=auth.uid();
  v_today date:=(now() at time zone 'Asia/Karachi')::date;
  v_limit integer;
  v_used integer:=0;
  v_allowed boolean:=false;
begin
  if p_tool not in ('metadata','watermark','gps','scanner','editor') then
    raise exception 'Invalid CleanExif tool.';
  end if;
  if v_user_id is null then
    raise exception 'Sign in is required to use daily image credits.';
  end if;

  select case p_tool
    when 'metadata' then p.metadata_daily_limit
    when 'watermark' then p.watermark_daily_limit
    when 'gps' then p.gps_daily_limit
    when 'scanner' then p.scanner_daily_limit
    when 'editor' then p.editor_daily_limit
  end
  into v_limit
  from public.cleanexif_customer_access a
  join public.cleanexif_plans p on p.id=a.plan_id
  where a.user_id=v_user_id
    and a.status='active'
    and p.active=true
    and a.starts_at<=now()
    and (a.expires_at is null or a.expires_at>now())
  order by a.created_at desc
  limit 1;

  if v_limit is null then
    select case p_tool
      when 'metadata' then p.metadata_daily_limit
      when 'watermark' then p.watermark_daily_limit
      when 'gps' then p.gps_daily_limit
      when 'scanner' then p.scanner_daily_limit
      when 'editor' then p.editor_daily_limit
    end
    into v_limit
    from public.cleanexif_plans p
    where p.code='free' and p.active=true
    limit 1;
  end if;

  v_limit:=coalesce(v_limit,0);

  -- Zero disables a tool for a plan. Do not insert a usage row for a denied request.
  if v_limit<=0 then
    select coalesce(u.used_count,0) into v_used
    from (select 1) seed
    left join public.cleanexif_tool_daily_usage u
      on u.user_id=v_user_id and u.usage_date=v_today and u.tool_key=p_tool;
    return query
    select false,coalesce(v_used,0),0,0,((v_today+1)::timestamp at time zone 'Asia/Karachi');
    return;
  end if;

  -- Atomic upsert prevents simultaneous requests from exceeding the daily allowance.
  insert into public.cleanexif_tool_daily_usage as usage(user_id,usage_date,tool_key,used_count)
  values(v_user_id,v_today,p_tool,1)
  on conflict(user_id,usage_date,tool_key) do update
    set used_count=usage.used_count+1,updated_at=now()
    where usage.used_count<v_limit
  returning usage.used_count into v_used;

  if found then
    v_allowed:=true;
  else
    select u.used_count into v_used
    from public.cleanexif_tool_daily_usage u
    where u.user_id=v_user_id and u.usage_date=v_today and u.tool_key=p_tool;
  end if;

  return query
  select v_allowed,coalesce(v_used,0),v_limit,greatest(v_limit-coalesce(v_used,0),0),
         ((v_today+1)::timestamp at time zone 'Asia/Karachi');
end;
$$;
revoke all on function public.cleanexif_get_my_daily_usage(text) from public,anon;
revoke all on function public.cleanexif_consume_daily_image(text) from public,anon;
grant execute on function public.cleanexif_get_my_daily_usage(text) to authenticated;
grant execute on function public.cleanexif_consume_daily_image(text) to authenticated;

-- Admin-only tool usage overview. No direct table access is granted to customers.
create or replace function public.cleanexif_admin_list_tool_usage(
  p_usage_date date default (now() at time zone 'Asia/Karachi')::date
)
returns table(
  user_id uuid,
  email text,
  plan_code text,
  plan_name text,
  tool_key text,
  used_count integer,
  daily_limit integer,
  remaining integer
)
language plpgsql
stable
security definer
set search_path=''
as $$
begin
  if auth.uid() is null or not coalesce(public.is_cleanexif_admin(),false) then
    raise exception 'You are not authorized to view tool usage.' using errcode='42501';
  end if;

  return query
  with tools(tool_key) as (
    values ('metadata'::text),('watermark'::text),('gps'::text),('scanner'::text),('editor'::text)
  )
  select u.id,
         lower(u.email),
         p.code,
         p.name,
         t.tool_key,
         coalesce(d.used_count,0)::integer,
         case t.tool_key
           when 'metadata' then p.metadata_daily_limit
           when 'watermark' then p.watermark_daily_limit
           when 'gps' then p.gps_daily_limit
           when 'scanner' then p.scanner_daily_limit
           when 'editor' then p.editor_daily_limit
         end::integer,
         greatest(case t.tool_key
           when 'metadata' then p.metadata_daily_limit
           when 'watermark' then p.watermark_daily_limit
           when 'gps' then p.gps_daily_limit
           when 'scanner' then p.scanner_daily_limit
           when 'editor' then p.editor_daily_limit
         end-coalesce(d.used_count,0),0)::integer
  from auth.users u
  left join lateral (
    select a.plan_id
    from public.cleanexif_customer_access a
    where a.user_id=u.id
      and a.status='active'
      and a.starts_at<=now()
      and (a.expires_at is null or a.expires_at>now())
    order by a.created_at desc
    limit 1
  ) active_access on true
  join public.cleanexif_plans p
    on p.id=coalesce(active_access.plan_id,(select fp.id from public.cleanexif_plans fp where fp.code='free' and fp.active=true limit 1))
  cross join tools t
  left join public.cleanexif_tool_daily_usage d
    on d.user_id=u.id and d.usage_date=p_usage_date and d.tool_key=t.tool_key
  where u.email is not null
    and not exists(select 1 from public.cleanexif_admin_users au where au.user_id=u.id)
  order by lower(u.email),t.tool_key;
end;
$$;
revoke all on function public.cleanexif_admin_list_tool_usage(date) from public,anon;
grant execute on function public.cleanexif_admin_list_tool_usage(date) to authenticated;
