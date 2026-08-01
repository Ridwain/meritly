import json

import httpx
import pytest
from fastmcp.exceptions import ToolError

from meritly_mcp.config import Settings
from meritly_mcp.supabase_api import MeritlySupabaseAPI
from test_config import valid_settings


@pytest.mark.asyncio
async def test_load_my_context_returns_only_safe_public_fields() -> None:
    seen_paths: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        assert request.headers["authorization"] == "Bearer user-token"
        assert request.headers["apikey"] == "publishable-key-with-safe-length"

        path = request.url.path
        seen_paths.append(path)
        if path.endswith("/profiles"):
            assert request.url.params["select"] == (
                "id,full_name,accepted_at,deleted_at,department_id,role_id"
            )
            data = [
                {
                    "id": "user-1",
                    "full_name": "Test User",
                    "accepted_at": "2026-01-01T00:00:00Z",
                    "deleted_at": None,
                    "department_id": 2,
                    "role_id": 3,
                }
            ]
        elif path.endswith("/roles"):
            assert request.url.params["select"] == "name"
            data = [{"name": "employee"}]
        elif path.endswith("/departments"):
            data = [{"name": "Engineering"}]
        else:
            raise AssertionError(f"Unexpected path: {path}")
        return httpx.Response(200, content=json.dumps(data))

    settings = Settings(**valid_settings())
    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        api = MeritlySupabaseAPI(settings, client)
        result = await api.load_my_context("user-token", "user-1")

    assert result.full_name == "Test User"
    assert result.role == "employee"
    assert result.department == "Engineering"
    assert result.model_dump() == {
        "full_name": "Test User",
        "role": "employee",
        "department": "Engineering",
    }
    assert not any(path.endswith("/role_permissions") for path in seen_paths)


@pytest.mark.asyncio
async def test_verify_active_account_rejects_archived_profile() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path.endswith("/profiles")
        assert request.url.params["select"] == "id,accepted_at,deleted_at"
        return httpx.Response(
            200,
            json=[
                {
                    "id": "user-1",
                    "accepted_at": "2026-01-01T00:00:00Z",
                    "deleted_at": "2026-01-02T00:00:00Z",
                }
            ],
        )

    settings = Settings(**valid_settings())
    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        api = MeritlySupabaseAPI(settings, client)
        with pytest.raises(ToolError, match="ACCOUNT_INACTIVE"):
            await api.verify_active_account("user-token", "user-1")


@pytest.mark.asyncio
async def test_session_not_found_maps_to_auth_required() -> None:
    def handler(_: httpx.Request) -> httpx.Response:
        return httpx.Response(
            403,
            json={
                "error_code": "session_not_found",
                "message": "Session from session_id claim in JWT does not exist",
            },
        )

    settings = Settings(**valid_settings())
    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        api = MeritlySupabaseAPI(settings, client)
        with pytest.raises(ToolError, match="AUTH_REQUIRED"):
            await api.verify_session("user-token", "user-1")


@pytest.mark.asyncio
async def test_revoked_mcp_connection_maps_to_auth_required() -> None:
    def handler(_: httpx.Request) -> httpx.Response:
        return httpx.Response(
            400,
            json={"message": "this MCP connection has been revoked"},
        )

    settings = Settings(**valid_settings())
    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        api = MeritlySupabaseAPI(settings, client)
        with pytest.raises(ToolError, match="AUTH_REQUIRED"):
            await api.touch_connection(
                "user-token",
                connection_hash="connection-hash",
                client_name="Claude",
                client_uri=None,
            )


@pytest.mark.asyncio
async def test_generic_403_still_maps_to_permission_denied() -> None:
    def handler(_: httpx.Request) -> httpx.Response:
        return httpx.Response(403, json={"message": "permission denied for table"})

    settings = Settings(**valid_settings())
    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        api = MeritlySupabaseAPI(settings, client)
        with pytest.raises(ToolError, match="PERMISSION_DENIED"):
            await api.list_assignable_employees("user-token")


@pytest.mark.asyncio
async def test_malformed_server_error_has_stable_operation_failed_code() -> None:
    def handler(_: httpx.Request) -> httpx.Response:
        return httpx.Response(500, content=b"not-json")

    settings = Settings(**valid_settings())
    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        api = MeritlySupabaseAPI(settings, client)
        with pytest.raises(ToolError, match="OPERATION_FAILED"):
            await api.list_assignable_employees("user-token")


@pytest.mark.asyncio
async def test_task_summary_hides_internal_person_ids() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        path = request.url.path
        if path.endswith("/tasks"):
            return httpx.Response(
                200,
                json=[
                    {
                        "id": "11111111-1111-1111-1111-111111111111",
                        "title": "Prepare report",
                        "description": None,
                        "assigned_to": "22222222-2222-2222-2222-222222222222",
                        "assigned_by": "33333333-3333-3333-3333-333333333333",
                        "priority": "high",
                        "deadline": "2026-01-02T00:00:00Z",
                        "status": "pending",
                        "created_at": "2026-01-01T00:00:00Z",
                        "attachment_name": None,
                        "attachment_path": None,
                    }
                ],
            )
        if path.endswith("/profiles"):
            return httpx.Response(
                200,
                json=[
                    {
                        "id": "22222222-2222-2222-2222-222222222222",
                        "full_name": "Sara Employee",
                    },
                    {
                        "id": "33333333-3333-3333-3333-333333333333",
                        "full_name": "Ridwain Islam",
                    },
                ],
            )
        raise AssertionError(f"Unexpected path: {path}")

    settings = Settings(**valid_settings())
    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        api = MeritlySupabaseAPI(settings, client)
        result = await api.list_tasks(
            "user-token", page=1, page_size=20, status=None
        )

    task = result.tasks[0].model_dump()
    assert task["task_id"].hex == "11111111111111111111111111111111"
    assert task["assignee_name"] == "Sara Employee"
    assert task["assigner_name"] == "Ridwain Islam"
    assert "assignee_id" not in task
    assert "assigner_id" not in task


@pytest.mark.asyncio
async def test_employee_performance_hides_employee_id() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        path = request.url.path
        if path.endswith("/can_view_performance_subject"):
            return httpx.Response(200, json=True)
        if path.endswith("/profiles"):
            return httpx.Response(
                200,
                json=[
                    {
                        "id": "22222222-2222-2222-2222-222222222222",
                        "full_name": "Sara Employee",
                        "deleted_at": None,
                        "role_id": "role-1",
                    }
                ],
            )
        if path.endswith("/roles"):
            return httpx.Response(200, json=[{"assignable_work": True}])
        if path.endswith("/tasks"):
            return httpx.Response(
                200,
                json=[
                    {
                        "id": "11111111-1111-1111-1111-111111111111",
                        "status": "completed",
                        "deadline": "2026-01-02T00:00:00Z",
                    }
                ],
            )
        if path.endswith("/submissions"):
            return httpx.Response(
                200,
                json=[
                    {
                        "task_id": "11111111-1111-1111-1111-111111111111",
                        "submitted_at": "2026-01-01T00:00:00Z",
                    }
                ],
            )
        if path.endswith("/activity_log"):
            return httpx.Response(200, json=[])
        raise AssertionError(f"Unexpected path: {path}")

    settings = Settings(**valid_settings())
    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        api = MeritlySupabaseAPI(settings, client)
        result = await api.get_employee_performance(
            "user-token", "22222222-2222-2222-2222-222222222222"
        )

    payload = result.model_dump()
    assert payload["full_name"] == "Sara Employee"
    assert payload["lifecycle_status"] == "active"
    assert payload["completion_rate"] == 100
    assert "employee_id" not in payload


@pytest.mark.asyncio
async def test_upload_bridge_keeps_user_token_and_connection_binding() -> None:
    calls: list[tuple[str, dict[str, object]]] = []

    def handler(request: httpx.Request) -> httpx.Response:
        assert request.headers["authorization"] == "Bearer user-token"
        body = json.loads(request.content)
        calls.append((request.url.path, body))

        if request.url.path.endswith("/mcp_prepare_upload"):
            data = [{"upload_token": "token-1", "expires_at": "2026-01-01T00:15:00Z"}]
        elif request.url.path.endswith("/mcp_resolve_upload"):
            data = [
                {
                    "object_path": "user-1/token-1/report.pdf",
                    "original_filename": "report.pdf",
                }
            ]
        else:
            raise AssertionError(f"Unexpected path: {request.url.path}")
        return httpx.Response(200, json=data)

    settings = Settings(**valid_settings())
    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        api = MeritlySupabaseAPI(settings, client)
        await api.prepare_upload(
            "user-token",
            connection_hash="connection-hash",
            client_name="Claude",
            client_uri="https://claude.ai/client",
            purpose="submission",
            target_task_id="task-1",
        )
        resolved = await api.resolve_upload(
            "user-token",
            connection_hash="connection-hash",
            upload_token="token-1",
            purpose="submission",
            target_task_id="task-1",
        )

    assert resolved == {
        "object_path": "user-1/token-1/report.pdf",
        "original_filename": "report.pdf",
    }
    assert calls[0][1]["p_connection_hash"] == "connection-hash"
    assert calls[0][1]["p_target_task_id"] == "task-1"
    assert calls[1][1]["p_upload_token"] == "token-1"


@pytest.mark.asyncio
async def test_upload_status_hides_missing_or_inaccessible_token() -> None:
    def handler(_: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=[])

    settings = Settings(**valid_settings())
    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        api = MeritlySupabaseAPI(settings, client)
        with pytest.raises(ToolError, match="NOT_FOUND_OR_INACCESSIBLE"):
            await api.get_upload_status("user-token", "unknown-token")
