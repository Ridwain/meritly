-- Migration 6: lock down direct EXECUTE on SECURITY DEFINER functions.
-- Supabase grants EXECUTE to anon/authenticated by name (not only via
-- PUBLIC), so migration 5's `revoke from public` was insufficient.

-- Trigger-only functions: never called directly. Triggers still fire
-- regardless of EXECUTE grants, so revoke from every API role.
revoke execute on function public.handle_new_user()            from anon, authenticated, public;
revoke execute on function public.set_updated_at()             from anon, authenticated, public;
revoke execute on function public.protect_profile_columns()    from anon, authenticated, public;
revoke execute on function public.protect_task_columns()       from anon, authenticated, public;
revoke execute on function public.protect_submission_columns() from anon, authenticated, public;

-- Helpers used inside RLS policies / by the app: signed-in users must keep
-- EXECUTE (a policy is evaluated as the querying role), but anonymous
-- visitors have no reason to call them.
revoke execute on function public.has_permission(text) from anon;
revoke execute on function public.is_active()          from anon;
revoke execute on function public.my_role()            from anon;
revoke execute on function public.flag_overdue_tasks() from anon;

-- NOTE: the remaining advisor warnings for has_permission/is_active/my_role/
-- flag_overdue_tasks under the `authenticated` role are expected and
-- intentional — RLS evaluates these as the signed-in user, so authenticated
-- MUST retain EXECUTE. This is the standard Supabase RLS-helper pattern.
