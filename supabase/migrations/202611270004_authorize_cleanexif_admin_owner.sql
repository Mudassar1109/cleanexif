-- Grant CleanExif admin access to the explicitly confirmed owner account.
-- Safe to re-run: existing admin membership is left unchanged.
do $$
declare
  admin_user_id uuid;
begin
  select id
    into admin_user_id
  from auth.users
  where lower(email) = lower('elahimudassasr1@gmail.com')
  limit 1;

  if admin_user_id is null then
    raise exception 'No Supabase Auth user found for elahimudassasr1@gmail.com. Sign in to CleanExif with this email first, then rerun this migration.';
  end if;

  insert into public.cleanexif_admin_users(user_id)
  values (admin_user_id)
  on conflict (user_id) do nothing;
end
$$;
