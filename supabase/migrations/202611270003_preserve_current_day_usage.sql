-- Preserve current Pakistan-day metadata usage when moving from the shared
-- daily counter to the new per-tool counters. Safe to run more than once.
insert into public.cleanexif_tool_daily_usage(user_id, usage_date, tool_key, used_count, updated_at)
select user_id, usage_date, 'metadata', used_count, now()
from public.cleanexif_daily_usage
where usage_date = (now() at time zone 'Asia/Karachi')::date
on conflict (user_id, usage_date, tool_key) do update
set used_count = greatest(public.cleanexif_tool_daily_usage.used_count, excluded.used_count),
    updated_at = now();
