-- CleanExif manually reviewed sponsor advertisements.
-- Visitors can read only approved ads within their active schedule.
-- Only authenticated CleanExif admins can manage or approve sponsor ads.
create table if not exists public.cleanexif_sponsor_ads (
 id uuid primary key default gen_random_uuid(),
 sponsor_name text not null check (char_length(trim(sponsor_name)) between 2 and 100),
 headline text not null check (char_length(trim(headline)) between 3 and 120),
 body text not null check (char_length(trim(body)) between 5 and 280),
 destination_url text not null check (destination_url ~ '^https://'),
 image_url text check (image_url is null or image_url ~ '^https://'),
 category text not null check (category in ('Software & SaaS','Hosting & Domains','Education','Design & Productivity','Other - review required')),
 placement text not null check (placement in ('blog_inline','blog_end','blog_sidebar')),
 status text not null default 'draft' check (status in ('draft','approved','paused')),
 starts_at timestamptz,
 ends_at timestamptz,
 created_by uuid references auth.users(id) on delete set null default auth.uid(),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 constraint cleanexif_sponsor_ads_schedule_check check (starts_at is null or ends_at is null or ends_at>starts_at)
);
create index if not exists cleanexif_sponsor_ads_public_idx on public.cleanexif_sponsor_ads(placement,status,starts_at,ends_at);
alter table public.cleanexif_sponsor_ads enable row level security;
revoke all on public.cleanexif_sponsor_ads from anon,authenticated;
grant select on public.cleanexif_sponsor_ads to anon,authenticated;
grant insert,update,delete on public.cleanexif_sponsor_ads to authenticated;
drop policy if exists "Public can view current approved sponsor ads" on public.cleanexif_sponsor_ads;
create policy "Public can view current approved sponsor ads" on public.cleanexif_sponsor_ads for select to anon,authenticated
 using (status='approved' and (starts_at is null or starts_at<=now()) and (ends_at is null or ends_at>now()));
drop policy if exists "CleanExif admins manage sponsor ads" on public.cleanexif_sponsor_ads;
create policy "CleanExif admins manage sponsor ads" on public.cleanexif_sponsor_ads for all to authenticated
 using (coalesce(public.is_cleanexif_admin(),false)) with check (coalesce(public.is_cleanexif_admin(),false));
