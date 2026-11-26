-- Admin-only customer activation/update RPC.
-- Keeps customer plan changes inside the Admin Panel and avoids direct table INSERT RLS failures.

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
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_email text := lower(trim(coalesce(p_email, '')));
  v_customer public.cleanexif_customer_access%rowtype;
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;

  if not coalesce(public.is_cleanexif_admin(), false) then
    raise exception 'You are not authorized to manage customer plans.' using errcode = '42501';
  end if;

  if v_email = '' or position('@' in v_email) < 2 then
    raise exception 'Enter a valid customer email.';
  end if;
  if p_status not in ('active', 'pending', 'expired', 'cancelled') then
    raise exception 'Invalid customer status.';
  end if;
  if p_starts_at is null or (p_expires_at is not null and p_expires_at <= p_starts_at) then
    raise exception 'Expiry date must be later than the start date.';
  end if;
  if not exists (select 1 from public.cleanexif_plans where id = p_plan_id and active = true) then
    raise exception 'Select an active plan.';
  end if;
  if not exists (select 1 from auth.users where lower(email) = v_email) then
    raise exception 'This customer has not created a CleanExif account yet. Ask them to sign up first.';
  end if;

  -- Serialize changes for the same email to prevent duplicate subscriptions.
  perform pg_advisory_xact_lock(hashtextextended(v_email, 0));

  if p_access_id is not null then
    select * into v_customer
    from public.cleanexif_customer_access
    where id = p_access_id
    for update;

    if not found then
      raise exception 'Customer access record was not found.';
    end if;
  else
    select * into v_customer
    from public.cleanexif_customer_access
    where email = v_email
    order by created_at desc
    limit 1
    for update;
  end if;

  if v_customer.id is null then
    insert into public.cleanexif_customer_access
      (email, whatsapp, plan_id, status, starts_at, expires_at, notes, created_by)
    values
      (v_email, nullif(trim(coalesce(p_whatsapp, '')), ''), p_plan_id, p_status,
       p_starts_at, p_expires_at, nullif(trim(coalesce(p_notes, '')), ''), v_user_id)
    returning * into v_customer;
  else
    update public.cleanexif_customer_access
    set email = v_email,
        whatsapp = nullif(trim(coalesce(p_whatsapp, '')), ''),
        plan_id = p_plan_id,
        status = p_status,
        starts_at = p_starts_at,
        expires_at = p_expires_at,
        notes = nullif(trim(coalesce(p_notes, '')), ''),
        updated_at = now()
    where id = v_customer.id
    returning * into v_customer;
  end if;

  return v_customer;
end;
$$;

revoke all on function public.cleanexif_admin_save_customer_access(text,text,uuid,text,timestamptz,timestamptz,text,uuid) from public, anon;
grant execute on function public.cleanexif_admin_save_customer_access(text,text,uuid,text,timestamptz,timestamptz,text,uuid) to authenticated;
