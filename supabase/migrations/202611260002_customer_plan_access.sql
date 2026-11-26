-- Customer-facing plan catalog and authenticated plan entitlement lookup.
-- Apply after 202611260001_cleanexif_admin.sql in the Supabase SQL Editor.
drop policy if exists "Public can read active CleanExif plans" on public.cleanexif_plans;
create policy "Public can read active CleanExif plans" on public.cleanexif_plans
for select to anon, authenticated using (active = true);
grant select on public.cleanexif_plans to anon, authenticated;

insert into public.cleanexif_plans(code,name,description,price_monthly,watermark_images_per_batch,watermark_total_mb,max_file_mb,active,sort_order)
values
 ('free','Free','Starter watermark allowance',0,10,100,25,true,0),
 ('pro','Pro','For creators and regular workflows',4.99,100,500,50,true,1),
 ('business','Business','For teams and higher-volume workflows',12.99,200,1024,100,true,2)
on conflict (code) do update set name=excluded.name,description=excluded.description,
 watermark_images_per_batch=excluded.watermark_images_per_batch,
 watermark_total_mb=excluded.watermark_total_mb,max_file_mb=excluded.max_file_mb,
 active=true,sort_order=excluded.sort_order;

create or replace function public.cleanexif_get_my_access()
returns table(plan_code text,plan_name text,watermark_images_per_batch integer,watermark_total_mb integer,max_file_mb integer,expires_at timestamptz)
language sql stable security definer set search_path=public,auth
as $$
 select p.code,p.name,p.watermark_images_per_batch,p.watermark_total_mb,p.max_file_mb,a.expires_at
 from public.cleanexif_customer_access a
 join public.cleanexif_plans p on p.id=a.plan_id
 where auth.uid() is not null
   and a.email=lower(coalesce(auth.jwt()->>'email',''))
   and a.status='active' and p.active=true
   and a.starts_at<=now() and (a.expires_at is null or a.expires_at>now())
 order by a.created_at desc limit 1;
$$;
revoke all on function public.cleanexif_get_my_access() from public;
grant execute on function public.cleanexif_get_my_access() to authenticated;
