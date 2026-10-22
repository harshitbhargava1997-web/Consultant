-- Vision literacy workflow. School Success tables and mappings are deliberately unused.
create table public.literacy_teacher_portal_links (
 id uuid primary key default gen_random_uuid(),
 school_id uuid not null references public.literacy_schools(id),
 token_hash text not null unique,
 created_by uuid not null references auth.users(id),
 created_at timestamptz not null default now(),
 revoked_at timestamptz
);
create index literacy_teacher_portal_links_school on public.literacy_teacher_portal_links(school_id);
create table public.literacy_teacher_lessons (
 id uuid primary key,
 school_id uuid not null references public.literacy_schools(id),
 teacher_user_id uuid not null references auth.users(id),
 planned_on date not null,
 periods jsonb not null check(jsonb_typeof(periods)='array' and jsonb_array_length(periods) between 1 and 10),
 preparation_files jsonb not null default '[]'::jsonb,
 preparation_minutes numeric not null default 0 check(preparation_minutes between 0 and 480),
 prepared_at timestamptz not null default now(),
 prepared_by text not null,
 evidence_updates jsonb not null default '[]'::jsonb,
 reviews jsonb not null default '[]'::jsonb,
 version integer not null default 0,
 updated_at timestamptz not null default now()
);
create index literacy_teacher_lessons_teacher_date on public.literacy_teacher_lessons(school_id,teacher_user_id,planned_on);
alter table public.literacy_teacher_portal_links enable row level security;
alter table public.literacy_teacher_lessons enable row level security;
revoke all on public.literacy_teacher_portal_links,public.literacy_teacher_lessons from anon,authenticated;
grant all on public.literacy_teacher_portal_links,public.literacy_teacher_lessons to service_role;

create function public.literacy_commit_teacher_lesson(p_mode text,p_submission jsonb,p_files jsonb,p_actor text,p_version integer default 0,p_update uuid default null,p_conducted date default null)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare existing public.literacy_teacher_lessons; sid uuid:=(p_submission->>'id')::uuid; school uuid:=(p_submission->>'schoolId')::uuid; teacher uuid:=(p_submission->>'teacherId')::uuid; event jsonb;
begin
 if p_mode not in ('preparation','evidence') or coalesce(p_actor,'')='' or jsonb_typeof(p_files)<>'array' then raise exception 'Invalid lesson save';end if;
 -- Serializes concurrent first saves and evidence commits for this lesson identity.
 perform pg_advisory_xact_lock(hashtextextended(sid::text,0));
 select * into existing from public.literacy_teacher_lessons where id=sid for update;
 if found and (existing.school_id<>school or existing.teacher_user_id<>teacher) then raise exception 'Lesson identity belongs to another school or teacher';end if;
 if p_mode='preparation' then
  if existing.id is not null then return jsonb_build_object('saved',true,'alreadySaved',true,'id',sid,'version',existing.version);end if;
  insert into public.literacy_teacher_lessons(id,school_id,teacher_user_id,planned_on,periods,preparation_files,preparation_minutes,prepared_by)
  values(sid,school,teacher,(p_submission->>'date')::date,p_submission->'periods',p_files,coalesce((p_submission->>'preparationMinutes')::numeric,0),p_actor);
  return jsonb_build_object('saved',true,'id',sid,'version',0);
 end if;
 if existing.id is null then raise exception 'Save lesson preparation first';end if;
 if p_update is null or p_conducted is null or p_conducted>(now() at time zone 'Asia/Kolkata')::date or jsonb_array_length(p_files)=0 then raise exception 'Add classroom evidence and a valid conducted date';end if;
 if exists(select from jsonb_array_elements(existing.evidence_updates) u where u->>'id'=p_update::text) then return jsonb_build_object('saved',true,'alreadySaved',true,'id',sid,'version',existing.version);end if;
 if existing.version<>p_version then raise exception 'Lesson changed. Reload it before adding evidence';end if;
 if jsonb_array_length(existing.evidence_updates)>=100 then raise exception 'Lesson evidence update limit reached';end if;
 event:=jsonb_build_object('id',p_update,'conductedOn',p_conducted,'submittedAt',now(),'submittedBy',p_actor,'files',p_files);
 update public.literacy_teacher_lessons set evidence_updates=evidence_updates||jsonb_build_array(event),version=version+1,updated_at=now() where id=sid;
 return jsonb_build_object('saved',true,'id',sid,'version',existing.version+1);
end $$;
revoke execute on function public.literacy_commit_teacher_lesson(text,jsonb,jsonb,text,integer,uuid,date) from public,anon,authenticated;
grant execute on function public.literacy_commit_teacher_lesson(text,jsonb,jsonb,text,integer,uuid,date) to service_role;

create function public.literacy_review_teacher_lesson(p_id uuid,p_school uuid,p_reviewer uuid,p_version integer,p_status text,p_feedback text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare existing public.literacy_teacher_lessons;
begin
 select * into existing from public.literacy_teacher_lessons where id=p_id and school_id=p_school for update;
 if not found then raise exception 'Lesson not found';end if;
 if existing.version<>p_version then raise exception 'Lesson changed. Reload before reviewing';end if;
 if p_status not in ('reviewed','needs_follow_up') or length(p_feedback)>4000 or (p_status='needs_follow_up' and length(trim(p_feedback))=0) then raise exception 'Add valid review feedback';end if;
 update public.literacy_teacher_lessons set reviews=reviews||jsonb_build_array(jsonb_build_object('reviewerId',p_reviewer,'version',p_version,'status',p_status,'feedback',p_feedback,'reviewed_at',now())),updated_at=now() where id=p_id;
 return jsonb_build_object('saved',true);
end $$;
revoke execute on function public.literacy_review_teacher_lesson(uuid,uuid,uuid,integer,text,text) from public,anon,authenticated;
grant execute on function public.literacy_review_teacher_lesson(uuid,uuid,uuid,integer,text,text) to service_role;

-- Match retained browser recordings; all pre-existing bucket settings remain in place.
update storage.buckets set allowed_mime_types=array_append(allowed_mime_types,'audio/ogg') where id='vision-implementation' and allowed_mime_types is not null and not ('audio/ogg'=any(allowed_mime_types));
