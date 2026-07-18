-- Migration 13: lock down log_task_activity(), same as migration 6 did for
-- the other trigger-only functions. Trigger functions never need to be
-- called directly — triggers fire regardless of EXECUTE grants — so a
-- forgotten revoke here just leaves an unnecessary RPC endpoint exposed.

revoke execute on function public.log_task_activity() from anon, authenticated, public;
