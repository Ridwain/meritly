# Feature 14 — Realtime In-App Notifications

## Goal

Add a secure notification bell to the `main` branch. Task lifecycle events are
stored transactionally in Postgres and delivered live through a private,
per-user Supabase Realtime Broadcast channel.

## Events

| Event | Recipient | Destination |
| --- | --- | --- |
| Task assigned | Assigned employee | `/dashboard/my-tasks` |
| Task reassigned | New employee | `/dashboard/my-tasks` |
| Work submitted | Active task creator | `/dashboard/tasks` |
| Work approved | Assigned employee | `/dashboard/my-tasks` |
| Revision requested | Assigned employee | `/dashboard/my-tasks` |

No notification is created for self-actions, inactive/unaccepted recipients,
task starts, ordinary edits, overdue transitions, archives, comments, or user
lifecycle events. Failed transactions roll notifications back with the task
operation, and idempotent request replays do not create duplicates.

## Database and Security

- Add `public.notifications` with recipient/actor/task references, a constrained
  event kind, safe internal destination, `read_at`, and `created_at`.
- Add recent and unread indexes keyed by recipient.
- Grant authenticated users only `SELECT` and column-level `UPDATE(read_at)`;
  RLS restricts both to the active signed-in recipient. Clients cannot insert,
  delete, or rewrite notification content.
- Private trigger functions create notifications for task/submission changes.
  They use an empty `search_path` and cannot be called directly by public roles.
- An `AFTER INSERT` trigger broadcasts to
  `notifications:<recipient_uuid>`. A `realtime.messages` SELECT policy allows
  only that active recipient to join the private channel. Clients receive only;
  they cannot broadcast.

## Frontend

- Dashboard layout loads the newest 10 notifications and exact unread count.
- A client `NotificationBell` renders the badge/dropdown, marks one/all rows as
  read, closes on outside click/Escape, and navigates only to stored safe paths.
- The component authenticates a private Realtime channel, refetches after
  subscribe to close the SSR/WebSocket race, refetches on every insert event,
  and removes the channel on unmount.
- Realtime is an enhancement: if the socket fails, stored notifications remain
  available on the next navigation or reload.
- A follow-up hardening migration caps generated display text and catches
  Broadcast-only errors, so unusually long task text or a Realtime outage can
  never roll back an otherwise valid task/submission transaction.

## Verification

- Add rollback-based database tests for structure, grants, RLS isolation,
  trigger event mapping, rollback/idempotency, direct-function denial, and
  private-topic authorization.
- Re-run Feature 11–13 and MCP database regressions, Python MCP tests, and the
  Next.js production build.
- Manually test the assign → submit → revision/resubmit → approve flow in two
  signed-in browser profiles, including mark-read, reconnect, and one MCP action.

## Scope Boundaries

- No historical backfill, separate notifications page, deletion/expiry UI,
  email/push/sound/toast, deadline reminder, or Task Activity comment alert.
- The friend-owned `riyan` branch remains unchanged.
- The unrelated local MCP comment is preserved and excluded from this feature.
