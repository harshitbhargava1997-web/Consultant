-- Recoverable Vision school deletion. No historical records are removed.
alter table public.literacy_schools add column if not exists archived_at timestamptz;
alter table public.literacy_schools add column if not exists archived_by uuid;
comment on column public.literacy_schools.archived_at is 'Deleted from active Vision workspaces; null means active. Historical records are retained.';

-- Tighten the existing permission predicate; preserve its prior role semantics.
create or replace function public.lit_has_permission(p_school_id uuid,p_feature text)
returns boolean language sql stable security definer set search_path to ''
as $function$
 select (select auth.uid()) is not null
 and exists(select 1 from public.literacy_schools s where s.id=p_school_id and s.archived_at is null)
 and (
  public.literacy_current_user_is_admin()
  or (
   exists(select 1 from public.literacy_consultant_assignments a
    where a.school_id=p_school_id and a.consultant_user_id=(select auth.uid()))
   and public.lit_role_permission('consultant',p_feature)
  )
  or (
   not exists(select 1 from public.literacy_consultant_assignments a
    where a.school_id=p_school_id and a.consultant_user_id=(select auth.uid()))
   and public.lit_role_permission(public.lit_role(p_school_id),p_feature)
  )
 )
$function$;

alter policy lit_school_read on public.literacy_schools using (
 public.literacy_current_user_is_admin()
 or (archived_at is null and (
  public.lit_role(id) is not null
  or exists(select 1 from public.literacy_consultant_assignments a
   where a.school_id=literacy_schools.id and a.consultant_user_id=(select auth.uid()))
 ))
);
