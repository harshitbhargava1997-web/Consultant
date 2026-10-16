-- Grade 5 support and safe competency deletion for the commercial Vision platform.
-- Apply after the commercial platform, permissions, training and implementation migrations.

alter table public.literacy_classes
  drop constraint if exists literacy_classes_grade_check;

alter table public.literacy_classes
  add constraint literacy_classes_grade_check
  check (grade in ('Nursery','LKG','UKG','Grade 1','Grade 2','Grade 3','Grade 4','Grade 5'));

create or replace function public.literacy_submit_assessment(
 p_school_id uuid,p_class_id uuid,p_subject_type text,p_subject_id uuid,
 p_assessment_date date,p_notes text,p_results jsonb
)
returns uuid language plpgsql security definer set search_path='' as $$
declare aid uuid; grade_name text; entry jsonb; competency uuid; rating_name text; uid uuid := auth.uid();
begin
 if uid is null or not public.lit_can_class(p_class_id) then raise exception 'Not authorized for class'; end if;
 if not public.lit_has_permission(p_school_id,'assessments.create') then
   raise exception 'Assessment creation is disabled for your role';
 end if;
 select grade into grade_name from public.literacy_classes where id=p_class_id and school_id=p_school_id;
 if grade_name is null then raise exception 'Class/school mismatch'; end if;
 if p_subject_type='student' then
   if not exists(select 1 from public.literacy_students where id=p_subject_id and class_id=p_class_id and active=true) then raise exception 'Student not enrolled in this class'; end if;
 elsif p_subject_type='teacher' then
   if not public.lit_has_permission(p_school_id,'teacher_reviews.create') then raise exception 'Teacher reviews are disabled for your role'; end if;
   if not exists(select 1 from public.literacy_teacher_classes where teacher_user_id=p_subject_id and class_id=p_class_id) then raise exception 'Teacher not assigned'; end if;
 else raise exception 'Unsupported assessment type'; end if;
 if p_assessment_date is null or p_assessment_date>current_date then raise exception 'Assessment date invalid'; end if;
 if jsonb_typeof(p_results) is distinct from 'array' or jsonb_array_length(p_results) not between 1 and 100 then raise exception 'Invalid results'; end if;
 if not exists(select 1 from jsonb_array_elements(p_results) r where r->>'rating' <> 'Not Assessed') then raise exception 'At least one observed rating required'; end if;
 for entry in select * from jsonb_array_elements(p_results) loop
   competency := (entry->>'competency_id')::uuid; rating_name := entry->>'rating';
   if rating_name not in ('Not Assessed','Emerging','Developing','Independent') then raise exception 'Invalid rating'; end if;
   if not exists(
    select 1 from public.literacy_competencies
    where id=competency
      and grade in ('Nursery','LKG','UKG','Grade 1','Grade 2','Grade 3','Grade 4','Grade 5')
      and active=true
      and array_position(array['Nursery','LKG','UKG','Grade 1','Grade 2','Grade 3','Grade 4','Grade 5'],grade)
        <= array_position(array['Nursery','LKG','UKG','Grade 1','Grade 2','Grade 3','Grade 4','Grade 5'],grade_name)
   ) then raise exception 'Competency is above enrolled grade or inactive'; end if;
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

create or replace function public.literacy_delete_unused_competency(p_competency_id uuid)
returns boolean language plpgsql security invoker set search_path='' as $$
begin
 if not exists(select 1 from public.literacy_competencies where id=p_competency_id) then
  return false;
 end if;
 if exists(select 1 from public.literacy_assessment_results where competency_id=p_competency_id)
  or exists(select 1 from public.literacy_assessment_phonics_results where competency_id=p_competency_id)
  or exists(select 1 from public.literacy_assessment_evidence where competency_id=p_competency_id)
  or exists(select 1 from public.literacy_implementation_competencies where competency_id=p_competency_id)
  or exists(select 1 from public.literacy_implementation_entries where competency_id=p_competency_id)
  or exists(select 1 from public.literacy_training_courses where competency_id=p_competency_id) then
  raise exception 'This competency is already linked to assessment, training or implementation records. Archive it instead of deleting it.' using errcode='23503';
 end if;
 delete from public.literacy_competency_history where competency_id=p_competency_id;
 delete from public.literacy_competencies where id=p_competency_id;
 return found;
end $$;

revoke all on function public.literacy_delete_unused_competency(uuid) from public,anon,authenticated;
grant execute on function public.literacy_delete_unused_competency(uuid) to service_role;
