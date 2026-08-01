import pytest
from pydantic import ValidationError

from meritly_mcp.config import Settings


def valid_settings(**overrides: str) -> dict[str, str]:
    values = {
        "mcp_environment": "test",
        "mcp_base_url": "http://localhost:8000",
        "next_app_base_url": "http://localhost:3000",
        "supabase_project_url": "https://example.supabase.co",
        "supabase_publishable_key": "publishable-key-with-safe-length",
        "supabase_oauth_client_id": "client-id",
        "supabase_oauth_client_secret": "oauth-secret-with-safe-length",
        "mcp_jwt_signing_key": "jwt-signing-key-with-safe-length",
        "mcp_storage_encryption_key": (
            "dGVzdC10ZXN0LXRlc3QtdGVzdC10ZXN0LXRlc3Q="
        ),
        "redis_url": "redis://localhost:6379/0",
    }
    values.update(overrides)
    return values


def test_development_redirects_include_inspector() -> None:
    settings = Settings(**valid_settings())

    assert "http://localhost:*" in settings.allowed_client_redirect_uris
    assert "https://claude.ai/api/mcp/auth_callback" in (
        settings.allowed_client_redirect_uris
    )


def test_production_redirects_exclude_localhost() -> None:
    settings = Settings(**valid_settings(mcp_environment="production"))

    assert all(
        "localhost" not in redirect
        for redirect in settings.allowed_client_redirect_uris
    )


def test_rejects_weak_secret() -> None:
    with pytest.raises(ValidationError):
        Settings(**valid_settings(mcp_jwt_signing_key="short"))
