-- Run on a TEST Supabase project first. Additive only; legacy tables are unchanged.
create extension if not exists pgcrypto;
create table if not exists public.literacy_schools (id uuid primary key default gen_random_uuid(), name text not null unique, created_at timestamptz default now());
create table if not exists public.literacy_memberships (id uuid primary key default gen_random_uuid(), school_id uuid not null references public.literacy_schools(id),user_id uuid not null references auth.users(id), display_name text not null default '', role text not null check(role in ('owner','principal','coordinator','teacher')),unique(school_id,user_id));
create table if not exists public.literacy_classes (id uuid primary key default gen_random_uuid(), school_id uuid not null references public.literacy_schools(id),grade text not null check(grade in ('Nursery','LKG','UKG','Grade 1','Grade 2','Grade 3','Grade 4')),section text not null default 'A',academic_year text not null,unique(school_id,grade,section,academic_year));
create table if not exists public.literacy_students (id uuid primary key default gen_random_uuid(),class_id uuid not null references public.literacy_classes(id),admission_number text not null,student_name text not null,active boolean not null default true,created_at timestamptz default now(),unique(class_id,admission_number));
create table if not exists public.literacy_teacher_classes (class_id uuid not null references public.literacy_classes(id),teacher_user_id uuid not null references auth.users(id),primary key(class_id,teacher_user_id));
create table if not exists public.literacy_competencies (id uuid primary key default gen_random_uuid(), code text not null unique,grade text not null,strand text not null,title text not null,description text not null default '', active boolean not null default true,sequence integer not null default 0,version integer not null default 1);
create table if not exists public.literacy_assessments (id uuid primary key default gen_random_uuid(),school_id uuid not null references public.literacy_schools(id),class_id uuid not null references public.literacy_classes(id),subject_type text not null check(subject_type in ('student','teacher')),student_id uuid references public.literacy_students(id),teacher_user_id uuid references auth.users(id),assessor_user_id uuid not null references auth.users(id),assessment_date date not null,notes text not null default '',created_at timestamptz not null default now(),check ((subject_type='student' and student_id is not null and teacher_user_id is null) or (subject_type='teacher' and teacher_user_id is not null and student_id is null)));
create table if not exists public.literacy_assessment_results (id uuid primary key default gen_random_uuid(),assessment_id uuid not null references public.literacy_assessments(id) on delete cascade,competency_id uuid not null references public.literacy_competencies(id),rating text not null check(rating in ('Not Assessed','Emerging','Developing','Independent')), evidence_notes text not null default '',unique(assessment_id,competency_id));
create index if not exists lit_member_user on public.literacy_memberships(user_id,school_id);
create index if not exists lit_classes_school on public.literacy_classes(school_id);
create index if not exists lit_assess_school on public.literacy_assessments(school_id,assessment_date desc);
create index if not exists lit_teacher_class_user on public.literacy_teacher_classes(teacher_user_id);

-- Security definer helpers avoid RLS recursive membership lookups. Limit search_path and EXECUTE.
create or replace function public.lit_role(sid uuid) returns text language sql stable security definer set search_path='' as $$ select role from public.literacy_memberships where school_id=sid and user_id=(select auth.uid()) limit 1 $$;
create or replace function public.lit_can_class(cid uuid) returns boolean language sql stable security definer set search_path='' as $$
select exists(select 1 from public.literacy_classes c where c.id=cid and (public.lit_role(c.school_id) in ('owner','principal','coordinator') or (public.lit_role(c.school_id)='teacher' and exists(select 1 from public.literacy_teacher_classes tc where tc.class_id=cid and tc.teacher_user_id=(select auth.uid()))))) $$;
create or replace function public.lit_is_manager(sid uuid) returns boolean language sql stable security definer set search_path='' as $$ select coalesce(public.lit_role(sid) in ('owner','principal','coordinator'),false) $$;
revoke all on function public.lit_role(uuid),public.lit_can_class(uuid),public.lit_is_manager(uuid) from public;
grant execute on function public.lit_role(uuid),public.lit_can_class(uuid),public.lit_is_manager(uuid) to authenticated;

do $$ declare t text; begin foreach t in array array['literacy_schools','literacy_memberships','literacy_classes','literacy_students','literacy_teacher_classes','literacy_competencies','literacy_assessments','literacy_assessment_results'] loop execute format('alter table public.%I enable row level security',t); end loop; end $$;

create policy lit_school_read on public.literacy_schools for select to authenticated using(public.lit_role(id) is not null);
create policy lit_members_read on public.literacy_memberships for select to authenticated using(public.lit_role(school_id) is not null);
create policy lit_classes_read on public.literacy_classes for select to authenticated using(public.lit_can_class(id));
create policy lit_classes_insert on public.literacy_classes for insert to authenticated with check(public.lit_is_manager(school_id));
create policy lit_students_read on public.literacy_students for select to authenticated using(public.lit_can_class(class_id));
create policy lit_students_insert on public.literacy_students for insert to authenticated with check(exists(select 1 from public.literacy_classes c where c.id=class_id and public.lit_is_manager(c.school_id)));
create policy lit_students_update on public.literacy_students for update to authenticated using(exists(select 1 from public.literacy_classes c where c.id=class_id and public.lit_is_manager(c.school_id))) with check(exists(select 1 from public.literacy_classes c where c.id=class_id and public.lit_is_manager(c.school_id)));
create policy lit_tc_read on public.literacy_teacher_classes for select to authenticated using(public.lit_can_class(class_id));
create policy lit_tc_insert on public.literacy_teacher_classes for insert to authenticated with check(exists(select 1 from public.literacy_classes c join public.literacy_memberships m on m.school_id=c.school_id and m.user_id=teacher_user_id and m.role='teacher' where c.id=class_id and public.lit_is_manager(c.school_id)));
create policy lit_comp_read on public.literacy_competencies for select to authenticated using(true);
create policy lit_comp_insert on public.literacy_competencies for insert to authenticated with check(exists(select 1 from public.literacy_memberships m where m.user_id=(select auth.uid()) and m.role in ('owner','principal','coordinator')));
create policy lit_comp_update on public.literacy_competencies for update to authenticated using(exists(select 1 from public.literacy_memberships m where m.user_id=(select auth.uid()) and m.role in ('owner','principal','coordinator'))) with check(exists(select 1 from public.literacy_memberships m where m.user_id=(select auth.uid()) and m.role in ('owner','principal','coordinator')));
create policy lit_assessment_read on public.literacy_assessments for select to authenticated using(public.lit_can_class(class_id));
create policy lit_result_read on public.literacy_assessment_results for select to authenticated using(exists(select 1 from public.literacy_assessments a where a.id=assessment_id and public.lit_can_class(a.class_id)));
-- INSERT access is through the hardened transaction RPC only, not table policies.

create or replace function public.literacy_submit_assessment(p_school_id uuid,p_class_id uuid,p_subject_type text,p_subject_id uuid,p_assessment_date date,p_notes text,p_results jsonb)
returns uuid language plpgsql security definer set search_path='' as $$
declare aid uuid; grade_name text; entry jsonb; competency uuid; rating_name text; uid uuid := auth.uid();
begin
 if uid is null or not public.lit_can_class(p_class_id) then raise exception 'Not authorized for class'; end if;
 select grade into grade_name from public.literacy_classes where id=p_class_id and school_id=p_school_id;
 if grade_name is null then raise exception 'Class/school mismatch'; end if;
 if p_subject_type='student' then
   if not exists(select 1 from public.literacy_students where id=p_subject_id and class_id=p_class_id and active=true) then raise exception 'Student not enrolled in this class'; end if;
 elsif p_subject_type='teacher' then
   if not public.lit_is_manager(p_school_id) then raise exception 'Only school leaders can assess teachers'; end if;
   if not exists(select 1 from public.literacy_teacher_classes where teacher_user_id=p_subject_id and class_id=p_class_id) then raise exception 'Teacher not assigned'; end if;
 else raise exception 'Unsupported assessment type'; end if;
 if p_assessment_date is null or p_assessment_date>current_date then raise exception 'Assessment date invalid'; end if;
 if jsonb_typeof(p_results) is distinct from 'array' or jsonb_array_length(p_results) not between 1 and 100 then raise exception 'Invalid results'; end if;
 if not exists(select 1 from jsonb_array_elements(p_results) r where r->>'rating' <> 'Not Assessed') then raise exception 'At least one observed rating required'; end if;
 -- Validate entire payload before header insert; transaction rolls back on any failure.
 for entry in select * from jsonb_array_elements(p_results) loop
   competency := (entry->>'competency_id')::uuid; rating_name := entry->>'rating';
   if rating_name not in ('Not Assessed','Emerging','Developing','Independent') then raise exception 'Invalid rating'; end if;
   if not exists(select 1 from public.literacy_competencies where id=competency and grade in ('Nursery','LKG','UKG','Grade 1','Grade 2','Grade 3','Grade 4') and active=true and array_position(array['Nursery','LKG','UKG','Grade 1','Grade 2','Grade 3','Grade 4'], grade) <= array_position(array['Nursery','LKG','UKG','Grade 1','Grade 2','Grade 3','Grade 4'], grade_name)) then raise exception 'Competency is above enrolled grade or inactive'; end if;
 end loop;
 insert into public.literacy_assessments(school_id,class_id,subject_type,student_id,teacher_user_id,assessor_user_id,assessment_date,notes)
 values(p_school_id,p_class_id,p_subject_type,case when p_subject_type='student' then p_subject_id end,case when p_subject_type='teacher' then p_subject_id end,uid,p_assessment_date,coalesce(p_notes,'')) returning id into aid;
 for entry in select * from jsonb_array_elements(p_results) loop
 insert into public.literacy_assessment_results(assessment_id,competency_id,rating,evidence_notes)
 values(aid,(entry->>'competency_id')::uuid,entry->>'rating',coalesce(entry->>'evidence_notes',''));
 end loop;
 return aid;
end $$;
revoke all on function public.literacy_submit_assessment(uuid,uuid,text,uuid,date,text,jsonb) from public;
grant execute on function public.literacy_submit_assessment(uuid,uuid,text,uuid,date,text,jsonb) to authenticated;

-- Bootstrap staff after creating accounts in Supabase Auth (replace UUIDs):
-- insert into public.literacy_schools(name) values('Demo School') returning id;
-- insert into public.literacy_memberships(school_id,user_id,display_name,role)
-- values('<school uuid>','<auth user uuid>','Principal Name','principal');
-- Seed competencies via Supabase Table Editor CSV import, once per code. Grade 3 remains unpopulated.
