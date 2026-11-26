-- CleanExif subscription identity, history and entitlement hardening.
-- Existing customer_access rows are retained. Auth IDs are backfilled by normalized email.

alter table public.cleanexif_customer_access
  add column if not exists user_id uuid references auth.users(id) on delete set null;

create index if not exists cleanexif_customer_access_user_id_idx
  on public.cleanexif_customer_access(user_id);

update public.cleanexif_customer_access a
set user_id = u.id
from auth.users u
where a.user_id is null
  and lower(a.email) = lower(u.email);

create table if not exists public.cleanexif_subscriptions (
  id bigint generated always as identity primary key,
  access_id uuid,
  user_id uuid references auth.users(id) on delete set null,
  email text not null,
  plan_id uuid not null references public.cleanexif_plans(id) on delete restrict,
  status text not null check (status in ('active','pending','expired','cancelled')),
  starts_at timestamptz not null,
  expires_at timestamptz,
  event text not null check (event in ('created','activated','upgraded','renewed','changed','cancelled','expired','replaced')),
  changed_by uuid references auth.users(id) on delete set null,
  changed_at timestamptz not null default now(),
  notes text
);
create index if not exists cleanexif_subscriptions_user_history_idx
  on public.cleanexif_subscriptions(user_id, changed_at desc);
create index if not exists cleanexif_subscriptions_email_history_idx
  on public.cleanexif_subscriptions(lower(email), changed_at desc);

alter table public.cleanexif_subscriptions enable row level security;
revoke all on public.cleanexif_subscriptions from anon, authenticated;
grant select on public.cleanexif_subscriptions to authenticated;

-- Preserve the current state of every existing customer record before enforcing
-- a single current access row per Auth user.
insert into public.cleanexif_subscriptions
  (access_id,user_id,email,plan_id,status,starts_at,expires_at,event,changed_by,changed_at,notes)
select a.id,a.user_id,a.email,a.plan_id,
       case when a.status='active' and a.expires_at is not null and a.expires_at<=now()
            then 'expired' else a.status end,
       a.starts_at,a.expires_at,'created',a.created_by,a.created_at,a.notes
from public.cleanexif_customer_access a
where not exists (
  select 1 from public.cleanexif_subscriptions s
  where s.access_id=a.id and s.event='created'
);

-- Mark expired rows accurately and retire older duplicate active rows without
-- deleting their records. The newest valid active row remains current.
with ranked as (
  select id,user_id,email,expires_at,
         row_number() over (
           partition by coalesce(user_id, gen_random_uuid())
           order by created_at desc,id desc
         ) as rn
  from public.cleanexif_customer_access
  where status='active'
)
update public.cleanexif_customer_access a
set status=case
  when a.expires_at is not null and a.expires_at<=now() then 'expired'
  else 'cancelled'
end,
updated_at=now()
from ranked r
where a.id=r.id
  and (r.expires_at is not null and r.expires_at<=now()
       or (r.rn>1 and r.user_id is not null));

drop function if exists public.cleanexif_get_my_access();
create or replace function public.cleanexif_get_my_access()
returns table(
  plan_code text,
  plan_name text,
  watermark_images_per_batch integer,
  watermark_total_mb integer,
  max_file_mb integer,
  daily_images_limit integer,
  expires_at timestamptz
)
language sql stable security definer set search_path=public,auth
as $$
 select p.code,p.name,p.watermark_images_per_batch,p.watermark_total_mb,
        p.max_file_mb,p.daily_images_limit,a.expires_at
 from public.cleanexif_customer_access a
 join public.cleanexif_plans p on p.id=a.plan_id
 where auth.uid() is not null
   and a.user_id=auth.uid()
   and a.status='active' and p.active=true
   and a.starts_at<=now() and (a.expires_at is null or a.expires_at>now())
 order by a.created_at desc limit 1;
$$;
revoke all on function public.cleanexif_get_my_access() from public,anon;
grant execute on function public.cleanexif_get_my_access() to authenticated;

create or replace function public.cleanexif_admin_save_customer_access(
  p_email text,
  p_whatsapp text,
  p_plan_id uuid,
  p_status text,
  p_starts_at timestamptz,
  p_expires_at timestamptz,
  p_notes text,
  p_access_id uuid default null
)
returns public.cleanexif_customer_access
language plpgsql security definer
set search_path=public,auth,pg_temp
as $$
declare
  v_email text:=lower(trim(coalesce(p_email,'')));
  v_user_id uuid:=auth.uid();
  v_customer public.cleanexif_customer_access%rowtype;
  v_auth_user_id uuid;
  v_event text;
begin
  if v_user_id is null then raise exception 'Authentication required.' using errcode='42501'; end if;
  if not coalesce(public.is_cleanexif_admin(),false) then
    raise exception 'You are not authorized to manage customer plans.' using errcode='42501';
  end if;
  if v_email='' or position('@' in v_email)<2 then raise exception 'Enter a valid customer email.'; end if;
  if p_status not in ('active','pending','expired','cancelled') then raise exception 'Invalid customer status.'; end if;
  if p_starts_at is null or (p_expires_at is not null and p_expires_at<=p_starts_at) then
    raise exception 'Expiry date must be later than the start date.';
  end if;
  if not exists(select 1 from public.cleanexif_plans where id=p_plan_id and active=true) then
    raise exception 'Select an active plan.';
  end if;
  select id into v_auth_user_id from auth.users where lower(email)=v_email limit 1;
  if v_auth_user_id is null then
    raise exception 'This customer has not created a CleanExif account yet. Ask them to sign up first.';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_auth_user_id::text,0));

  if p_access_id is not null then
    select * into v_customer from public.cleanexif_customer_access
    where id=p_access_id
      and (user_id=v_auth_user_id or (user_id is null and lower(email)=v_email))
    for update;
    if not found then raise exception 'Customer access record was not found for this account.'; end if;
  else
    select * into v_customer from public.cleanexif_customer_access
    where user_id=v_auth_user_id
    order by case when status='active' then 0 else 1 end,created_at desc
    limit 1 for update;
  end if;

  if v_customer.id is not null then
    v_event:=case
      when v_customer.status='pending' and p_status='active' then 'activated'
      when v_customer.plan_id<>p_plan_id and p_status='active' then 'upgraded'
      when v_customer.expires_at is not distinct from p_expires_at
           and v_customer.plan_id=p_plan_id and v_customer.status='active' then 'changed'
      when v_customer.expires_at is distinct from p_expires_at
           and v_customer.plan_id=p_plan_id and p_status='active' then 'renewed'
      when p_status='cancelled' then 'cancelled'
      else 'changed' end;
    insert into public.cleanexif_subscriptions
      (access_id,user_id,email,plan_id,status,starts_at,expires_at,event,changed_by,notes)
    values
      (v_customer.id,v_customer.user_id,v_customer.email,v_customer.plan_id,
       case when v_customer.status='active' and v_customer.expires_at is not null and v_customer.expires_at<=now()
            then 'expired' else v_customer.status end,
       v_customer.starts_at,v_customer.expires_at,'replaced',v_user_id,v_customer.notes);
  else
    v_event:=case when p_status='active' then 'activated' when p_status='pending' then 'created' else 'changed' end;
  end if;

  if p_status='active' then
    update public.cleanexif_customer_access
    set status='cancelled',updated_at=now()
    where user_id=v_auth_user_id and status='active'
      and (v_customer.id is null or id<>v_customer.id);
  end if;

  if v_customer.id is null then
    insert into public.cleanexif_customer_access
      (user_id,email,whatsapp,plan_id,status,starts_at,expires_at,notes,created_by)
    values
      (v_auth_user_id,v_email,nullif(trim(coalesce(p_whatsapp,'')),''),p_plan_id,p_status,
       p_starts_at,p_expires_at,nullif(trim(coalesce(p_notes,'')),''),v_user_id)
    returning * into v_customer;
  else
    update public.cleanexif_customer_access
    set user_id=v_auth_user_id,email=v_email,
        whatsapp=nullif(trim(coalesce(p_whatsapp,'')),''),plan_id=p_plan_id,status=p_status,
        starts_at=p_starts_at,expires_at=p_expires_at,
        notes=nullif(trim(coalesce(p_notes,'')),''),updated_at=now()
    where id=v_customer.id returning * into v_customer;
  end if;

  insert into public.cleanexif_subscriptions
    (access_id,user_id,email,plan_id,status,starts_at,expires_at,event,changed_by,notes)
  values
    (v_customer.id,v_auth_user_id,v_email,p_plan_id,p_status,p_starts_at,p_expires_at,
     v_event,v_user_id,v_customer.notes);

  return v_customer;
end;
$$;
revoke all on function public.cleanexif_admin_save_customer_access(text,text,uuid,text,timestamptz,timestamptz,text,uuid) from public,anon;
grant execute on function public.cleanexif_admin_save_customer_access(text,text,uuid,text,timestamptz,timestamptz,text,uuid) to authenticated;

drop function if exists public.cleanexif_admin_list_customer_access();
create function public.cleanexif_admin_list_customer_access()
returns table(
  id uuid,user_id uuid,email text,whatsapp text,plan_id uuid,status text,
  starts_at timestamptz,expires_at timestamptz,notes text,created_at timestamptz,
  plan_name text,plan_code text
)
language plpgsql volatile security definer
set search_path=public,auth,pg_temp
as $$
begin
  if auth.uid() is null then raise exception 'Authentication required.' using errcode='42501'; end if;
  if not coalesce(public.is_cleanexif_admin(),false) then
    raise exception 'You are not authorized to view customer plans.' using errcode='42501';
  end if;

  -- Expire due subscriptions once and preserve the transition in history.
  with expired as (
    update public.cleanexif_customer_access
    set status='expired',updated_at=now()
    where status='active' and expires_at is not null and expires_at<=now()
    returning id,user_id,email,plan_id,starts_at,expires_at,notes
  )
  insert into public.cleanexif_subscriptions
    (access_id,user_id,email,plan_id,status,starts_at,expires_at,event,changed_by,notes)
  select id,user_id,email,plan_id,'expired',starts_at,expires_at,'expired',auth.uid(),notes
  from expired;

  -- One row per registered Auth account, including Free customers without a
  -- paid access row. The latest subscription remains visible for management.
  return query
  select a.id,u.id,lower(u.email),a.whatsapp,coalesce(a.plan_id,fp.id),
    case when a.id is null then 'free'
         when a.status='active' and a.expires_at is not null and a.expires_at<=now()
           then 'expired'
         else a.status end,
    coalesce(a.starts_at,u.created_at),a.expires_at,a.notes,u.created_at,
    coalesce(p.name,fp.name),coalesce(p.code,fp.code)
  from auth.users u
  cross join (select id,name,code from public.cleanexif_plans where code='free' limit 1) fp
  left join lateral (
    select x.* from public.cleanexif_customer_access x
    where x.user_id=u.id
    order by case when x.status='active' then 0 else 1 end,x.created_at desc
    limit 1
  ) a on true
  left join public.cleanexif_plans p on p.id=a.plan_id
  where not exists (
    select 1 from public.cleanexif_admin_users au where au.user_id=u.id
  )

  union all

  -- Keep legacy records visible when they could not be linked to an Auth user.
  select a.id,null::uuid,a.email,a.whatsapp,a.plan_id,
    case when a.status='active' and a.expires_at is not null and a.expires_at<=now()
         then 'expired' else a.status end,
    a.starts_at,a.expires_at,a.notes,a.created_at,p.name,p.code
  from public.cleanexif_customer_access a
  join public.cleanexif_plans p on p.id=a.plan_id
  where a.user_id is null
  order by 10 desc;
end;
$$;

revoke all on function public.cleanexif_admin_list_customer_access() from public,anon;
grant execute on function public.cleanexif_admin_list_customer_access() to authenticated;

create or replace function public.cleanexif_admin_list_subscription_history()
returns table(
 id bigint,access_id uuid,user_id uuid,email text,plan_id uuid,plan_name text,
 status text,starts_at timestamptz,expires_at timestamptz,event text,
 changed_at timestamptz,notes text
)
language plpgsql stable security definer set search_path=public,auth,pg_temp
as $$
begin
 if not coalesce(public.is_cleanexif_admin(),false) then
   raise exception 'Not authorized.' using errcode='42501';
 end if;
 return query
 select s.id,s.access_id,s.user_id,s.email,s.plan_id,p.name,s.status,
        s.starts_at,s.expires_at,s.event,s.changed_at,s.notes
 from public.cleanexif_subscriptions s
 join public.cleanexif_plans p on p.id=s.plan_id
 order by s.changed_at desc;
end;
$$;
revoke all on function public.cleanexif_admin_list_subscription_history() from public,anon;
grant execute on function public.cleanexif_admin_list_subscription_history() to authenticated;

create or replace function public.cleanexif_get_my_subscription_history()
returns table(
 plan_name text,plan_code text,status text,starts_at timestamptz,
 expires_at timestamptz,event text,changed_at timestamptz
)
language sql stable security definer set search_path=public,auth
as $$
 select p.name,p.code,s.status,s.starts_at,s.expires_at,s.event,s.changed_at
 from public.cleanexif_subscriptions s
 join public.cleanexif_plans p on p.id=s.plan_id
 where s.user_id=auth.uid()
 order by s.changed_at desc;
$$;
revoke all on function public.cleanexif_get_my_subscription_history() from public,anon;
grant execute on function public.cleanexif_get_my_subscription_history() to authenticated;

-- Admin-only read access to the history table is enforced by RPC; no direct table policy.

-- Daily quota plan lookup also uses immutable Auth user IDs, never email matching.
create or replace function public.cleanexif_get_my_daily_usage(p_tool text default 'metadata')
returns table(used_count integer,daily_limit integer,remaining integer,resets_at timestamptz)
language plpgsql stable security definer
set search_path=public,auth,pg_temp
as $$
declare
 v_user_id uuid:=auth.uid();
 v_today date:=(now() at time zone 'Asia/Karachi')::date;
 v_limit integer;
 v_used integer:=0;
begin
 if p_tool not in ('metadata','watermark') then raise exception 'Invalid CleanExif tool.'; end if;
 if v_user_id is null then raise exception 'Sign in is required to use daily image credits.'; end if;
 select p.daily_images_limit into v_limit
 from public.cleanexif_customer_access a
 join public.cleanexif_plans p on p.id=a.plan_id
 where a.user_id=v_user_id and a.status='active' and p.active=true
   and a.starts_at<=now() and (a.expires_at is null or a.expires_at>now())
 order by a.created_at desc limit 1;
 if v_limit is null then
   select p.daily_images_limit into v_limit from public.cleanexif_plans p
   where p.code='free' and p.active=true limit 1;
 end if;
 select coalesce(u.used_count,0) into v_used
 from (select 1) seed
 left join public.cleanexif_tool_daily_usage u
   on u.user_id=v_user_id and u.usage_date=v_today and u.tool_key=p_tool;
 return query select v_used,coalesce(v_limit,10),
   greatest(coalesce(v_limit,10)-v_used,0),
   ((v_today+1)::timestamp at time zone 'Asia/Karachi');
end;
$$;

create or replace function public.cleanexif_consume_daily_image(p_tool text default 'metadata')
returns table(allowed boolean,used_count integer,daily_limit integer,remaining integer,resets_at timestamptz)
language plpgsql security definer
set search_path=public,auth,pg_temp
as $$
declare
 v_user_id uuid:=auth.uid();
 v_today date:=(now() at time zone 'Asia/Karachi')::date;
 v_limit integer;
 v_used integer:=0;
 v_allowed boolean:=false;
begin
 if p_tool not in ('metadata','watermark') then raise exception 'Invalid CleanExif tool.'; end if;
 if v_user_id is null then raise exception 'Sign in is required to use daily image credits.'; end if;
 select p.daily_images_limit into v_limit
 from public.cleanexif_customer_access a
 join public.cleanexif_plans p on p.id=a.plan_id
 where a.user_id=v_user_id and a.status='active' and p.active=true
   and a.starts_at<=now() and (a.expires_at is null or a.expires_at>now())
 order by a.created_at desc limit 1;
 if v_limit is null then
   select p.daily_images_limit into v_limit from public.cleanexif_plans p
   where p.code='free' and p.active=true limit 1;
 end if;
 v_limit:=coalesce(v_limit,10);
 insert into public.cleanexif_tool_daily_usage as usage(user_id,usage_date,tool_key,used_count)
 values(v_user_id,v_today,p_tool,1)
 on conflict(user_id,usage_date,tool_key) do update
   set used_count=usage.used_count+1,updated_at=now()
   where usage.used_count<v_limit
 returning usage.used_count into v_used;
 if found then v_allowed:=true;
 else
   select u.used_count into v_used from public.cleanexif_tool_daily_usage u
   where u.user_id=v_user_id and u.usage_date=v_today and u.tool_key=p_tool;
 end if;
 return query select v_allowed,coalesce(v_used,0),v_limit,
   greatest(v_limit-coalesce(v_used,0),0),
   ((v_today+1)::timestamp at time zone 'Asia/Karachi');
end;
$$;
revoke all on function public.cleanexif_get_my_daily_usage(text) from public,anon;
revoke all on function public.cleanexif_consume_daily_image(text) from public,anon;
grant execute on function public.cleanexif_get_my_daily_usage(text) to authenticated;
grant execute on function public.cleanexif_consume_daily_image(text) to authenticated;
