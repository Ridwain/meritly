-- Feature 13 final cutover.
--
-- Applied after the compatible app and signed-download flow were verified.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  token_text text := new.raw_user_meta_data->>'meritly_provisioning_token';
  invite_token uuid;
  provision private.pending_user_provisioning%rowtype;
  provision_found boolean := false;
begin
  if token_text is not null
     and token_text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    invite_token := token_text::uuid;

    select p.*
    into provision
    from private.pending_user_provisioning p
    where p.token = invite_token
      and p.normalized_email = lower(btrim(new.email))
      and p.expires_at > now()
    for update;

    provision_found := found;
  end if;

  if not provision_found then
    raise exception 'a valid server-created provisioning token is required';
  end if;

  insert into public.profiles (
    id,
    full_name,
    role_id,
    department_id
  ) values (
    new.id,
    provision.full_name,
    (select r.id from public.roles r where r.name = 'employee'),
    provision.department_id
  );

  delete from private.pending_user_provisioning
  where token = invite_token;

  return new;
end;
$$;

revoke execute on function public.handle_new_user()
  from anon, authenticated, public;

-- The old app may have created URL-only rows between the preparation migration
-- and this cutover. Backfill that deployment window one final time.
update public.tasks
set attachment_path = split_part(
  split_part(attachment_url, '/object/public/task-attachments/', 2),
  '?',
  1
)
where attachment_path is null
  and attachment_url is not null;

update public.submissions
set file_path = split_part(
  split_part(file_url, '/object/public/submissions/', 2),
  '?',
  1
)
where file_path is null
  and file_url is not null;

-- Refuse the cutover if an existing database reference does not match Storage.
do $$
begin
  if exists (
    select 1
    from public.tasks
    where attachment_url is not null
      and coalesce(attachment_path, '') = ''
  ) or exists (
    select 1
    from public.submissions
    where file_url is not null
      and coalesce(file_path, '') = ''
  ) then
    raise exception 'Private cutover blocked by an unconverted legacy URL';
  end if;

  if exists (
    select 1
    from public.tasks t
    where t.attachment_path is not null
      and not exists (
        select 1
        from storage.objects o
        where o.bucket_id = 'task-attachments'
          and o.name = t.attachment_path
      )
  ) then
    raise exception 'Private cutover blocked by a missing task attachment';
  end if;

  if exists (
    select 1
    from public.submissions s
    where s.file_path is not null
      and not exists (
        select 1
        from storage.objects o
        where o.bucket_id = 'submissions'
          and o.name = s.file_path
      )
  ) then
    raise exception 'Private cutover blocked by a missing submission file';
  end if;
end;
$$;

update storage.buckets
set public = false
where id in ('submissions', 'task-attachments');
