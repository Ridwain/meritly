-- Cover new MCP foreign keys and remove indexes made redundant by unique paths.

create index operation_requests_connection_idx
  on private.operation_requests (connection_id)
  where connection_id is not null;

create index mcp_upload_target_task_idx
  on private.mcp_upload_sessions (target_task_id)
  where target_task_id is not null;

-- The new partial unique indexes support the same equality lookups while also
-- enforcing one business reference per private object.
drop index public.tasks_attachment_path_idx;
drop index public.submissions_file_path_idx;
