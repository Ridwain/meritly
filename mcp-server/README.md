# Meritly MCP server

This is Meritly's separate Python FastMCP service. It exposes a Streamable HTTP
endpoint at `/mcp`, authenticates each person through Supabase OAuth, and sends
that person's bearer token to Supabase so the existing RBAC and RLS rules remain
the authorization boundary. It never uses a service-role key for tools.

## Local setup

```bash
cd mcp-server
cp .env.example .env
uv sync --frozen
uv run --frozen meritly-mcp
```

Also run Meritly at `http://localhost:3000` and Redis at the URL in `.env`.
Supabase OAuth Server must be enabled, its consent URL must point to Meritly's
`/oauth/consent`, and the confidential gateway client's callback must be
`http://localhost:8000/auth/callback` for local development.

Never commit `.env`. Its OAuth client secret, MCP JWT signing key, and Fernet
storage key are three independent server-only secrets.

## Tools

Read tools expose the current user's context, visible tasks, assignable workers,
permitted performance data, upload state, and 60-second private-file links.
Write tools create/update/start/submit/review through the same transactional
Supabase RPCs used by the web app.

Every write requires a caller-generated UUID `request_id` and exact user
approval. Repeating the same request and payload is safe; reusing the ID for a
different payload fails. Clients without MCP form elicitation receive a
five-minute Meritly browser approval URL.

Files use a separate 15-minute browser upload URL. The web app checks size,
extension, MIME type, and basic file signatures before a one-time token can be
used by a write tool. Production business files additionally require an
external malware-scanning service.

## Checks

```bash
uv run pytest
uv run python -m compileall -q src tests
```

With the web app, Redis, and MCP server running, test a real OAuth round-trip:

```bash
uv run --frozen python scripts/oauth_smoke.py
```

Open the printed `MERITLY_AUTH_URL`, sign in to Meritly, approve access, and the
terminal should print `MCP_RESULT` plus `MCP_TASKS` from the real user-scoped
database session.

To verify the browser approval fallback without creating a task:

```bash
uv run --frozen python scripts/oauth_smoke.py --approval-preview
```

Open the printed approval URL and choose **Deny**. The page should show
`Action denied`; the preview title clearly says not to approve it.

The 38 database transaction/RLS checks live in
`supabase/tests/database/mcp_v1_transaction_test.sql`. They run inside a rollback
and include approval, idempotency, storage, connection revocation, and atomic
start/submit/review cases.

## Production checklist

- public stable HTTPS URLs for Meritly and `/mcp`;
- persistent authenticated TLS Redis/Valkey with backup and monitoring;
- external rate limiting, structured logs/metrics, and secret rotation;
- external malware scanning before accepting business files;
- real ChatGPT and Claude read plus confirmed-write tests;
- Supabase Security and Performance Advisor review before each release.

The private MCP tables intentionally have RLS enabled with no direct policies,
and authenticated users have no direct table grants. Narrow, reviewed RPCs are
the only access path. Some of those RPCs are `SECURITY DEFINER` because they must
reach the private schema; they use an empty `search_path`, fully qualified names,
actor/token/client checks, and explicit grants only to `authenticated`.
