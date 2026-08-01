"""FastMCP OAuth Proxy configured for Supabase user authentication."""

from typing import Any

from cryptography.fernet import Fernet
from fastmcp.server.auth import AccessToken, OAuthProxy
from fastmcp.server.auth.providers.jwt import JWTVerifier
from key_value.aio.stores.redis import RedisStore
from key_value.aio.wrappers.encryption import FernetEncryptionWrapper

from .config import Settings

DOWNSTREAM_CLIENT_CLAIM = "meritly_downstream_client_id"


def preserve_downstream_client_identity(
    validated: AccessToken,
    fastmcp_claims: dict[str, Any],
) -> AccessToken | None:
    """Attach the verified ChatGPT/Claude client ID to the user token context.

    OAuthProxy intentionally returns the upstream Supabase access token to tool
    handlers. This helper keeps the separately verified downstream client ID so
    connection revocation and idempotency can bind to the correct AI client.
    """

    client_id = fastmcp_claims.get("client_id")
    if not isinstance(client_id, str) or not client_id or len(client_id) > 2048:
        return None

    claims = dict(validated.claims or {})
    claims[DOWNSTREAM_CLIENT_CLAIM] = client_id
    return validated.model_copy(update={"claims": claims})


class MeritlyOAuthProxy(OAuthProxy):
    """OAuthProxy that preserves the verified downstream MCP client identity."""

    async def load_access_token(self, token: str) -> AccessToken | None:
        validated = await super().load_access_token(token)
        if validated is None:
            return None

        try:
            # jwt_issuer verifies signature, audience, expiry, and the token JTI.
            fastmcp_claims = self.jwt_issuer.verify_token(token)
        except Exception:
            return None

        return preserve_downstream_client_identity(validated, fastmcp_claims)


def build_auth_provider(settings: Settings) -> MeritlyOAuthProxy:
    """Create the exact resource-bound OAuth bridge used by the MCP server."""

    auth_url = settings.supabase_auth_url
    token_verifier = JWTVerifier(
        jwks_uri=f"{auth_url}/.well-known/jwks.json",
        issuer=auth_url,
        audience="authenticated",
        algorithm="ES256",
        required_scopes=["openid"],
    )

    encrypted_storage = FernetEncryptionWrapper(
        key_value=RedisStore(url=settings.redis_url),
        fernet=Fernet(
            settings.mcp_storage_encryption_key.get_secret_value().encode("ascii")
        ),
    )

    return MeritlyOAuthProxy(
        upstream_authorization_endpoint=f"{auth_url}/oauth/authorize",
        upstream_token_endpoint=f"{auth_url}/oauth/token",
        upstream_client_id=settings.supabase_oauth_client_id,
        upstream_client_secret=(
            settings.supabase_oauth_client_secret.get_secret_value()
        ),
        token_verifier=token_verifier,
        base_url=str(settings.mcp_base_url).rstrip("/"),
        resource_base_url=str(settings.mcp_base_url).rstrip("/"),
        redirect_path="/auth/callback",
        service_documentation_url=settings.next_app_base_url,
        allowed_client_redirect_uris=settings.allowed_client_redirect_uris,
        valid_scopes=["openid"],
        forward_pkce=True,
        # Supabase currently does not understand RFC 8707 resource indicators.
        # FastMCP still binds its own downstream token to the exact /mcp resource.
        forward_resource=False,
        token_endpoint_auth_method="client_secret_basic",
        client_storage=encrypted_storage,
        jwt_signing_key=settings.mcp_jwt_signing_key.get_secret_value(),
        require_authorization_consent=True,
        fallback_refresh_token_expiry_seconds=30 * 24 * 60 * 60,
        fastmcp_access_token_expiry_seconds=60 * 60,
        token_expiry_threshold_seconds=60,
        enable_cimd=True,
    )
