# Meritly MCP v1 — Reviewed Python FastMCP Plan

> **Status:** Local v1 implementation complete. Gates A-C have automated/local
> coverage; real ChatGPT/Claude clients and production infrastructure in Gate D
> remain release requirements.

## 1. Locked architecture

- Run a separate `mcp-server/` service with Python 3.13, `uv`, and
  `fastmcp==3.4.5`.
- Expose stateless Streamable HTTP at the stable HTTPS `/mcp` endpoint.
- Use FastMCP `OAuthProxy`, not the direct `SupabaseProvider`. Supabase currently
  cannot bind its access token to one RFC 8707 MCP resource, so FastMCP issues a
  separate resource-bound token to ChatGPT/Claude.
- Supabase remains the upstream identity provider and database authorization
  boundary. Normal tool handlers use the user's bearer token and public key;
  they never use the service-role key.
- Store OAuth state and upstream tokens in encrypted Redis with explicit,
  independent JWT-signing and Fernet encryption keys.
- Keep Google login, identity administration, role editing, department editing,
  offboarding, destructive deletion, and multi-tenancy outside v1.

## 2. OAuth and connection behavior

1. ChatGPT or Claude identifies itself to FastMCP through CIMD/DCR and PKCE.
2. FastMCP shows client consent and forwards authentication to one pre-registered
   confidential Supabase OAuth client.
3. Meritly hosts the Supabase consent UI at `/oauth/consent` and safely returns
   signed-out users there after password login.
4. FastMCP stores the encrypted upstream Supabase tokens and gives the MCP client
   a JWT whose audience is the exact Meritly `/mcp` resource.
5. Every request verifies both token layers, checks the Supabase session, checks
   the profile is active, and evaluates current RBAC/RLS data.

Mandatory proxy settings:

- ES256 Supabase JWKS verifier, issuer `<project>/auth/v1`, audience
  `authenticated`, minimum scope `openid`;
- `forward_pkce=True`, `forward_resource=False`;
- `token_endpoint_auth_method="client_secret_basic"`;
- `require_authorization_consent=True`, `enable_cimd=True`;
- one-hour FastMCP access token, 60-second refresh threshold;
- production redirect allowlist limited to ChatGPT and Claude; localhost is
  development-only.

Supabase Dynamic Client Registration stays disabled in production because
FastMCP handles downstream CIMD/DCR. A reviewed `MeritlyOAuthProxy` preserves the
verified downstream client identity alongside the upstream user token.

Add a private connection registry keyed by user plus a hash of the downstream
client ID. Check it on every tool call. Individual revocation blocks one MCP
client; revoking the upstream Supabase gateway grant blocks all of that user's
MCP connections.

## 3. MCP v1 interfaces

Read tools:

- `get_my_context`
- `list_tasks`
- `get_task`
- `list_assignable_employees`
- `get_employee_performance`
- `get_upload_status`
- `get_work_file_link`

Write tools:

- `create_task`
- `update_task`
- `start_task`
- `prepare_file_upload`
- `submit_work`
- `review_submission`

All schemas use strict Pydantic validation, bounded strings and pages, UUIDs,
enums, UTC timestamps, and unknown-field rejection. Actor, role, department,
ownership, and privileged columns are always derived server-side. Inaccessible
IDs return one generic not-found-or-inaccessible error.

Consequential writes use hybrid approval. Prefer MCP elicitation with an exact
preview; if the client does not support it, return a five-minute, authenticated
Meritly browser approval link. The database binds an approval intent to actor,
downstream client, tool, request ID, target, and canonical payload hash, then
consumes it once in the same transaction as the business write.

Every write has a UUID `request_id`. Repeating the same ID and payload returns
the recorded result; reusing it with a changed payload fails.

## 4. Database and file security

Keep MCP connections, approvals, idempotency, upload sessions, and audit records
in a private schema. Expose only narrow authenticated RPCs. Create transactional
RPCs for create/update/start/submit/review, and use the same RPCs from the web UI
and MCP so their behavior cannot drift.

Each mutation must:

- require `auth.uid()` and an active accepted profile;
- re-check current permission, ownership, assignability, and department scope;
- lock rows in a consistent order and validate the latest state;
- consume approval/idempotency and write the audit record atomically;
- revoke `PUBLIC`/`anon` execution, use an empty `search_path`, and fully qualify
  objects when `SECURITY DEFINER` is genuinely required.

Move overdue maintenance away from authenticated page loads to Supabase Cron.
Resolve or explicitly justify relevant Security/Performance Advisor findings
before write tools launch.

Files use a 15-minute one-time authenticated browser bridge, private Storage,
server-generated paths, a 10 MB limit, extension/MIME/signature checks, one-time
finalization, Cron cleanup, and download links lasting at most 60 seconds.
Malware scanning is required before real business-file production use.

## 5. Release gates and tests

### Gate A — OAuth compatibility (local pass)

- Supabase OAuth discovery returns valid metadata instead of the current 404.
- The registered gateway callback, Meritly login return, consent, PKCE, refresh,
  CIMD/DCR, resource audience, and revocation work.
- A real local FastMCP OAuth client initializes and calls `get_my_context` and
  `list_tasks`. ChatGPT and Claude are tracked separately in Gate D because they
  require a public HTTPS endpoint.
- Wrong issuer/signature/audience/resource, expired tokens, browser-session
  tokens, and altered redirects are rejected.

### Gate B — database safety (local pass)

- Permission, own-task, department, active/archived, assignable-role, direct
  REST/RPC, concurrency, and idempotency tests pass.
- Browser and MCP create/update/start/submit/review produce identical outcomes.
- Supabase Security and Performance Advisors are rerun.

### Gate C — approvals and files (database/browser-local pass)

- Elicitation accept/decline and browser fallback work.
- Expired, reused, wrong-user/client, and changed-payload approvals fail.
- Oversized, unsafe, mismatched, reused, and cross-user files fail.
- Individual and upstream grant revocation work.

### Gate D — production integration (pending)

- Stable public HTTPS, persistent encrypted Redis, always-on hosting, rate
  limits, structured logs, metrics, secret rotation, backup, and rollback work.
- Real ChatGPT and Claude end-to-end read and confirmed-write scenarios pass.

Production-ready means all four gates pass. Supabase OAuth Server and its
confidential gateway client are now enabled/configured for local development;
that does not replace Gate D's public-hosting and real-client checks.
