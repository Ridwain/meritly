-- Migration 5: hardening from the Supabase security advisor.
-- Three classes of finding, all addressed:

-- (1) set_updated_at had a mutable search_path (every other function pins it).
create or replace function public.set_updated_at()
returns trigger
language plpgsql set search_path = public as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- (2) The two "management" UPDATE policies used WITH CHECK (true), relying
-- entirely on the column-pinning triggers. That is correct, but a policy
-- that literally says `true` is a footgun if a trigger is ever dropped.
-- Re-express WITH CHECK as the caller-permission check (defence in depth;
-- the fine-grained column/role logic still lives in the triggers). These
-- expressions are row-state-independent, so they never block a legitimate
-- promotion (employee->hr) the way a naive role check would.
drop policy "profiles_update_manage" on public.profiles;
create policy "profiles_update_manage" on public.profiles
  for update to authenticated
  using (
    id <> auth.uid()
    and (
      public.has_permission('user.manage_all')
      or (
        (public.has_permission('user.promote') or public.has_permission('user.archive'))
        and role_id = (select id from public.roles where name = 'employee')
      )
    )
  )
  with check (
    id <> auth.uid()
    and (
      public.has_permission('user.manage_all')
      or public.has_permission('user.promote')
      or public.has_permission('user.archive')
    )
  );

drop policy "tasks_update_manage" on public.tasks;
create policy "tasks_update_manage" on public.tasks
  for update to authenticated
  using (
    public.has_permission('task.update')
    or public.has_permission('task.archive')
    or public.has_permission('submission.review')
  )
  with check (
    public.has_permission('task.update')
    or public.has_permission('task.archive')
    or public.has_permission('submission.review')
  );

-- (3) SECURITY DEFINER functions were callable directly as REST RPCs by
-- anon/authenticated. Trigger-only functions never need to be called
-- directly (triggers fire regardless of EXECUTE grants), so revoke all
-- direct access. Helper functions used inside RLS policies must keep
-- EXECUTE for `authenticated` (the policy is evaluated as that user), but
-- anon has no business calling them — so revoke from PUBLIC, then grant
-- back only authenticated.

-- Trigger-only: no direct callers at all.
revoke execute on function public.handle_new_user()             from public;
revoke execute on function public.set_updated_at()              from public;
revoke execute on function public.protect_profile_columns()     from public;
revoke execute on function public.protect_task_columns()        from public;
revoke execute on function public.protect_submission_columns()  from public;

-- Policy/app helpers: authenticated only (needed for RLS evaluation and app calls).
revoke execute on function public.has_permission(text) from public;
revoke execute on function public.is_active()          from public;
revoke execute on function public.my_role()            from public;
revoke execute on function public.flag_overdue_tasks() from public;
grant  execute on function public.has_permission(text) to authenticated;
grant  execute on function public.is_active()          to authenticated;
grant  execute on function public.my_role()            to authenticated;
grant  execute on function public.flag_overdue_tasks() to authenticated;
