"""Validated environment configuration for the MCP service."""

from functools import lru_cache
from typing import Literal

from pydantic import AnyHttpUrl, SecretStr, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Fail fast when a required security setting is missing or malformed."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
    )

    mcp_environment: Literal["development", "test", "production"] = "development"
    mcp_base_url: AnyHttpUrl
    next_app_base_url: AnyHttpUrl

    supabase_project_url: AnyHttpUrl
    supabase_publishable_key: SecretStr
    supabase_oauth_client_id: str
    supabase_oauth_client_secret: SecretStr

    mcp_jwt_signing_key: SecretStr
    mcp_storage_encryption_key: SecretStr
    redis_url: str

    @field_validator("supabase_oauth_client_id")
    @classmethod
    def validate_client_id(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("SUPABASE_OAUTH_CLIENT_ID cannot be empty")
        return value

    @field_validator(
        "supabase_publishable_key",
        "supabase_oauth_client_secret",
        "mcp_jwt_signing_key",
        "mcp_storage_encryption_key",
    )
    @classmethod
    def validate_secret(cls, value: SecretStr) -> SecretStr:
        if len(value.get_secret_value()) < 20:
            raise ValueError("security-sensitive values must be at least 20 characters")
        return value

    @field_validator("redis_url")
    @classmethod
    def validate_redis_url(cls, value: str) -> str:
        value = value.strip()
        if not value.startswith(("redis://", "rediss://")):
            raise ValueError("REDIS_URL must start with redis:// or rediss://")
        return value

    @property
    def supabase_auth_url(self) -> str:
        return f"{str(self.supabase_project_url).rstrip('/')}/auth/v1"

    @property
    def allowed_client_redirect_uris(self) -> list[str]:
        production_clients = [
            "https://chatgpt.com/connector/oauth/*",
            "https://claude.ai/api/mcp/auth_callback",
        ]
        if self.mcp_environment == "production":
            return production_clients
        return [
            *production_clients,
            "http://localhost:*",
            "http://127.0.0.1:*",
        ]

    @property
    def allowed_hosts(self) -> list[str]:
        host = self.mcp_base_url.host
        return [host] if host else []


@lru_cache
def get_settings() -> Settings:
    return Settings()  # type: ignore[call-arg]
