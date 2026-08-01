from fastmcp.server.auth import AccessToken

from meritly_mcp.auth import (
    DOWNSTREAM_CLIENT_CLAIM,
    preserve_downstream_client_identity,
)


def test_preserves_verified_downstream_client_id() -> None:
    upstream = AccessToken(
        token="supabase-user-token",
        client_id="supabase-gateway-client",
        scopes=["openid"],
        claims={"sub": "user-1"},
    )

    result = preserve_downstream_client_identity(
        upstream,
        {"client_id": "https://chatgpt.com/oauth/example/client.json"},
    )

    assert result is not None
    assert result.token == "supabase-user-token"
    assert (
        result.claims[DOWNSTREAM_CLIENT_CLAIM]
        == "https://chatgpt.com/oauth/example/client.json"
    )


def test_rejects_missing_downstream_client_id() -> None:
    upstream = AccessToken(
        token="supabase-user-token",
        client_id="supabase-gateway-client",
        scopes=["openid"],
        claims={"sub": "user-1"},
    )

    assert preserve_downstream_client_identity(upstream, {}) is None
