begin;

create table if not exists public.literacy_digital_content (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(title) between 4 and 180),
  summary text not null default '' check (char_length(summary) <= 1000),
  grade text not null check (grade in ('Nursery','LKG','UKG','Grade 1','Grade 2','Grade 3','Grade 4','Grade 5')),
  competency_id uuid references public.literacy_competencies(id) on delete set null,
  content_type text not null default 'demonstration' check (content_type in ('demonstration','lesson_plan','activity','worksheet','audio','video','external')),
  objective text not null default '' check (char_length(objective) <= 3000),
  preparation text not null default '' check (char_length(preparation) <= 12000),
  demonstration text not null default '' check (char_length(demonstration) <= 12000),
  practice text not null default '' check (char_length(practice) <= 12000),
  check_understanding text not null default '' check (char_length(check_understanding) <= 12000),
  resource_url text not null default '' check (char_length(resource_url) <= 1500),
  target_roles text[] not null default array['consultant','owner','principal','coordinator','teacher']::text[],
  status text not null default 'draft' check (status in ('draft','published','archived')),
  sequence integer not null default 0 check (sequence between 0 and 10000),
  created_by uuid not null references auth.users(id),
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (target_roles <@ array['consultant','owner','principal','coordinator','teacher']::text[]),
  check (cardinality(target_roles) > 0),
  check (resource_url = '' or resource_url ~ '^https://')
);

create index if not exists literacy_digital_content_published_grade_idx
  on public.literacy_digital_content (grade, sequence, created_at desc)
  where status = 'published';
create index if not exists literacy_digital_content_competency_idx
  on public.literacy_digital_content (competency_id)
  where competency_id is not null;
create index if not exists literacy_digital_content_created_by_idx
  on public.literacy_digital_content (created_by);

alter table public.literacy_digital_content enable row level security;
revoke all on table public.literacy_digital_content from anon, authenticated;
grant all on table public.literacy_digital_content to service_role;
drop policy if exists "No direct browser access to digital content" on public.literacy_digital_content;
create policy "No direct browser access to digital content"
  on public.literacy_digital_content for all to authenticated
  using (false) with check (false);

insert into public.literacy_role_permissions (role,feature,enabled)
select role_name,'digital_content.access',false
from unnest(array['consultant','owner','principal','coordinator','teacher']::text[]) as role_name
on conflict (role,feature) do nothing;

commit;
