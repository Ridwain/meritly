-- Migration 4: archived users must not browse the staff directory.
-- (Caught while testing: the original profiles_select policy said
-- "any logged-in user", which would have let ARCHIVED users keep
-- enumerating staff — violating DESIGN.md §5's "archived = all data
-- access denied". You may always read YOUR OWN profile, which is how
-- the app tells you that you are deactivated; reading others requires
-- being active.)
drop policy "profiles_select" on public.profiles;
create policy "profiles_select" on public.profiles
  for select to authenticated
  using (id = auth.uid() or public.is_active());
