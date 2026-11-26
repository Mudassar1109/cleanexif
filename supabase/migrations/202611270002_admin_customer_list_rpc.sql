-- Admin-only customer listing with effective expiry status.
-- The function checks the signed-in user's admin membership before returning any customer data.
create or replace function public.cleanexif_admin_list_customer_access()
returns table (
  id uuid,
  email text,
  whatsapp text,
  plan_id uuid,
  status text,
  starts_at timestamptz,
  expires_at timestamptz,
  notes text,
  created_at timestamptz,
  plan_name text,
  plan_code text
)
language plpgsql
stable
security definer
set search_path = public, auth, pg_temp
as $$
begin
  if auth.uid() is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;
  if not coalesce(public.is_cleanexif_admin(), false) then
    raise exception 'You are not authorized to view customer plans.' using errcode = '42501';
  end if;

  return query
  select
    a.id,
    a.email,
    a.whatsapp,
    a.plan_id,
    case
      when a.status = 'active' and a.expires_at is not null and a.expires_at <= now()
        then 'expired'
      else a.status
    end as status,
    a.starts_at,
    a.expires_at,
    a.notes,
    a.created_at,
    p.name,
    p.code
  from public.cleanexif_customer_access a
  join public.cleanexif_plans p on p.id = a.plan_id
  order by a.created_at desc;
end;
$$;

revoke all on function public.cleanexif_admin_list_customer_access() from public, anon;
grant execute on function public.cleanexif_admin_list_customer_access() to authenticated;
