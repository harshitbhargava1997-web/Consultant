-- Store distinct sound, blending-action and reading observations for VC/CVC items.
-- Existing phonics rows remain valid as the "overall" dimension.

alter table public.literacy_assessment_phonics_results
 add column if not exists observation_dimension text not null default 'overall';

do $$
begin
 if not exists (
  select 1 from pg_constraint
  where conname='literacy_assessment_phonics_results_dimension_check'
    and conrelid='public.literacy_assessment_phonics_results'::regclass
 ) then
  alter table public.literacy_assessment_phonics_results
   add constraint literacy_assessment_phonics_results_dimension_check
   check (observation_dimension in ('overall','sound','action','reading'));
 end if;
end $$;

alter table public.literacy_assessment_phonics_results
 drop constraint if exists literacy_assessment_phonics_results_pkey;
alter table public.literacy_assessment_phonics_results
 add constraint literacy_assessment_phonics_results_pkey
 primary key (assessment_id,competency_id,item_id,observation_dimension);

drop function if exists public.literacy_get_assessment_phonics(uuid,uuid,text,uuid);

create function public.literacy_get_assessment_phonics(
 p_school_id uuid,p_class_id uuid,p_subject_type text,p_subject_id uuid
) returns table(
 assessment_id uuid,competency_id uuid,item_id uuid,rating text,observation_dimension text
)
language plpgsql security definer set search_path=''
as $$
begin
 if auth.uid() is null or not public.lit_can_class(p_class_id) then
  raise exception 'Not authorized for this class';end if;
 if not exists(select 1 from public.literacy_classes where id=p_class_id and school_id=p_school_id)
 then raise exception 'School/class mismatch';end if;
 if p_subject_type='student' then
  if not public.lit_has_permission(p_school_id,'assessments.view')
  then raise exception 'Assessment history permission denied';end if;
  if not exists(select 1 from public.literacy_students where id=p_subject_id and class_id=p_class_id)
  then raise exception 'Student not in class';end if;
 elsif p_subject_type='teacher' then
  if not public.lit_has_permission(p_school_id,'teacher_reviews.create')
  then raise exception 'Teacher review permission denied';end if;
  if not exists(select 1 from public.literacy_teacher_classes where class_id=p_class_id and teacher_user_id=p_subject_id)
  then raise exception 'Teacher not assigned';end if;
 else raise exception 'Invalid assessment subject';end if;
 return query select d.assessment_id,d.competency_id,d.item_id,d.rating,d.observation_dimension
 from public.literacy_assessment_phonics_results d
 join public.literacy_assessments a on a.id=d.assessment_id
 where a.school_id=p_school_id and a.class_id=p_class_id and a.subject_type=p_subject_type
  and (p_subject_type='student' and a.student_id=p_subject_id or p_subject_type='teacher' and a.teacher_user_id=p_subject_id)
 order by a.assessment_date desc,a.created_at desc;
end
$$;

revoke all on function public.literacy_get_assessment_phonics(uuid,uuid,text,uuid) from public,anon;
grant execute on function public.literacy_get_assessment_phonics(uuid,uuid,text,uuid) to authenticated;

create or replace function public.literacy_submit_detailed_assessment(
 p_school_id uuid,p_class_id uuid,p_subject_type text,p_subject_id uuid,
 p_assessment_date date,p_stage text,p_notes text,p_next_action text,p_results jsonb,p_mode text
) returns uuid
language plpgsql security definer set search_path=''
as $$
declare
 sid uuid;item jsonb;sound_record jsonb;competency uuid;pattern_item_id uuid;
 rating text;dimension_name text;item_count integer;role_name text;uid uuid:=(select auth.uid());
begin
 if p_mode not in ('complete','random','targeted') or p_mode is null then raise exception 'Choose a valid assessment type';end if;
 if p_subject_type='student' then
  sid:=public.literacy_submit_assessor_session(p_school_id,p_class_id,p_subject_id,p_assessment_date,p_stage,p_notes,p_next_action,p_results);
 elsif p_subject_type='teacher' then
  if p_stage not in ('baseline','follow_up','periodic','endline') or p_stage is null then raise exception 'Choose a valid assessment stage';end if;
  sid:=public.literacy_submit_assessment(p_school_id,p_class_id,'teacher',p_subject_id,p_assessment_date,p_notes,p_results);
  if public.literacy_current_user_is_admin() then role_name:='super_admin';
  elsif public.lit_consultant_assigned(p_school_id) then role_name:='consultant';
  else role_name:=coalesce(public.lit_role(p_school_id),'legacy');end if;
  update public.literacy_assessments set assessment_stage=p_stage,next_action=coalesce(p_next_action,''),assessor_role=role_name
   where id=sid and assessor_user_id=uid and school_id=p_school_id;
 else raise exception 'Only student or teacher can be reviewed';end if;
 for item in select value from jsonb_array_elements(p_results) loop
  competency:=(item->>'competency_id')::uuid;
  if item ? 'sound_items' then
   if jsonb_typeof(item->'sound_items') is distinct from 'array' then raise exception 'Sound observations must be a list';end if;
   item_count:=jsonb_array_length(item->'sound_items');
   if item_count>240 then raise exception 'Too many individual sound ratings';end if;
   if (select count(distinct (x->>'item_id',coalesce(x->>'observation_dimension','overall'))) from jsonb_array_elements(item->'sound_items') x)<>item_count
   then raise exception 'Repeated sound observation';end if;
   for sound_record in select value from jsonb_array_elements(item->'sound_items') loop
    if jsonb_typeof(sound_record) is distinct from 'object' then raise exception 'Invalid sound';end if;
    pattern_item_id:=(sound_record->>'item_id')::uuid;rating:=sound_record->>'rating';
    dimension_name:=coalesce(nullif(sound_record->>'observation_dimension',''),'overall');
    if rating not in ('Emerging','Developing','Independent') then raise exception 'Invalid sound rating';end if;
    if dimension_name not in ('overall','sound','action','reading') then raise exception 'Invalid observation dimension';end if;
    if not exists(select 1 from public.literacy_competency_phonics_items m join public.literacy_phonics_items p on p.id=m.item_id
     where m.competency_id=competency and m.item_id=pattern_item_id and p.active=true)
    then raise exception 'Sound does not belong to the selected competency';end if;
    insert into public.literacy_assessment_phonics_results(assessment_id,competency_id,item_id,rating,observation_dimension)
    values(sid,competency,pattern_item_id,rating,dimension_name);
   end loop;
  end if;
 end loop;
 update public.literacy_assessments set assessment_mode=p_mode where id=sid and assessor_user_id=uid and school_id=p_school_id;
 return sid;
end
$$;

revoke all on function public.literacy_submit_detailed_assessment(uuid,uuid,text,uuid,date,text,text,text,jsonb,text) from public,anon;
grant execute on function public.literacy_submit_detailed_assessment(uuid,uuid,text,uuid,date,text,text,text,jsonb,text) to authenticated;

