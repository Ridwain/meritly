-- Feature 12 advisor follow-up: index every new foreign key and make public
-- read helpers obey the signed-in caller's RLS policies.

create index task_assignment_history_changed_by_idx
  on public.task_assignment_history (changed_by)
  where changed_by is not null;
create index user_lifecycle_events_previous_role_idx
  on public.user_lifecycle_events (previous_role_id)
  where previous_role_id is not null;
create index user_lifecycle_events_new_role_idx
  on public.user_lifecycle_events (new_role_id)
  where new_role_id is not null;
create index user_lifecycle_events_replacement_idx
  on public.user_lifecycle_events (replacement_user_id)
  where replacement_user_id is not null;

create or replace function public.historical_employees()
returns table (
  id uuid,
  full_name text,
  role text,
  email text,
  deleted_at timestamptz,
  accepted boolean,
  current_assignable boolean,
  has_history boolean
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  if not public.has_permission('stats.view_all') then
    raise exception 'stats.view_all is required to list performance subjects';
  end if;

  return query
    with historical_ids as (
      select t.assigned_to as user_id from public.tasks t
      union
      select s.employee_id from public.submissions s
      union
      select a.employee_id from public.activity_log a
      union
      select h.from_user_id
      from public.task_assignment_history h
      where h.from_user_id is not null
      union
      select h.to_user_id from public.task_assignment_history h
      union
      select rt.employee_id from public.ratings rt
    ),
    subject_ids as (
      select p.id as user_id
      from public.profiles p
      join public.roles r on r.id = p.role_id
      where p.deleted_at is null
        and p.accepted_at is not null
        and r.assignable_work
      union
      select h.user_id from historical_ids h
    )
    select
      p.id,
      p.full_name,
      r.name,
      null::text,
      p.deleted_at,
      (p.accepted_at is not null),
      (
        p.deleted_at is null
        and p.accepted_at is not null
        and r.assignable_work
      ),
      exists (
        select 1 from historical_ids h where h.user_id = p.id
      )
    from subject_ids s
    join public.profiles p on p.id = s.user_id
    join public.roles r on r.id = p.role_id
    where p.id <> auth.uid()
    order by p.created_at;
end;
$$;

create or replace function public.can_view_performance_subject(target uuid)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select
    case
      when target = auth.uid() then public.is_active()
      when not public.has_permission('stats.view_all') then false
      else exists (
        select 1
        from public.profiles p
        join public.roles r on r.id = p.role_id
        where p.id = target
          and (
            (
              p.deleted_at is null
              and p.accepted_at is not null
              and r.assignable_work
            )
            or exists (
              select 1 from public.tasks t where t.assigned_to = target
            )
            or exists (
              select 1 from public.submissions s where s.employee_id = target
            )
            or exists (
              select 1 from public.activity_log a where a.employee_id = target
            )
            or exists (
              select 1
              from public.task_assignment_history h
              where h.from_user_id = target or h.to_user_id = target
            )
            or exists (
              select 1 from public.ratings rt where rt.employee_id = target
            )
          )
      )
    end;
$$;
