-- Recruiting Timeline Checker: lead + result table (T032)
-- Lives in the existing online-report-card Supabase project (shared with T028/T030/T031),
-- so SUPABASE_URL and SUPABASE_SERVICE_KEY are already valid. Already applied live.

create table if not exists timeline_reports (
  id          bigint generated always as identity primary key,
  created_at  timestamptz default now(),
  full_name   text not null,
  email       text not null,
  sport       text,
  grad_year   int,
  verdict     text,
  report      jsonb,          -- full card the page renders
  ip          text,           -- used only for rate limiting
  token       text unique     -- unguessable id for the shareable /report.html page
);

create index if not exists timeline_created_idx on timeline_reports (created_at desc);
create index if not exists timeline_cache_idx   on timeline_reports (email, sport, grad_year, created_at desc);
create index if not exists timeline_ip_idx      on timeline_reports (ip, created_at desc);

-- Lock the table down. The server uses the service-role key, which bypasses RLS.
alter table timeline_reports enable row level security;
