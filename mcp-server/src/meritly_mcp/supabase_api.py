"""User-scoped Supabase REST/RPC client with immutable request headers."""

from datetime import UTC, date, datetime, timedelta
from typing import Any, Literal
from urllib.parse import quote

import httpx
from fastmcp.exceptions import ToolError

from .config import Settings
from .models import (
    ActivityPoint,
    AssignableEmployeeResult,
    EmployeePerformanceResult,
    MyContextResult,
    SubmissionSummary,
    TaskDetail,
    TaskListResult,
    TaskStatus,
    TaskSummary,
    UploadStatusResult,
    WorkFileLinkResult,
)


class MeritlySupabaseAPI:
    def __init__(self, settings: Settings, client: httpx.AsyncClient) -> None:
        self._settings = settings
        self._client = client
        self._project_url = str(settings.supabase_project_url).rstrip("/")

    def _headers(self, bearer_token: str) -> dict[str, str]:
        # The shared HTTP pool has no mutable Authorization header. Every call
        # receives an immutable header dictionary for the current Meritly user.
        return {
            "Authorization": f"Bearer {bearer_token}",
            "apikey": self._settings.supabase_publishable_key.get_secret_value(),
            "Accept": "application/json",
        }

    async def _get(
        self,
        path: str,
        bearer_token: str,
        *,
        params: dict[str, str] | None = None,
    ) -> Any:
        try:
            response = await self._client.get(
                f"{self._project_url}{path}",
                headers=self._headers(bearer_token),
                params=params,
            )
        except httpx.RequestError as error:
            raise ToolError("TEMPORARY_UNAVAILABLE") from error

        if response.status_code >= 400:
            self._raise_response_error(response)
        return response.json()

    async def _post(
        self,
        path: str,
        bearer_token: str,
        *,
        body: dict[str, Any],
    ) -> Any:
        try:
            response = await self._client.post(
                f"{self._project_url}{path}",
                headers={
                    **self._headers(bearer_token),
                    "Content-Type": "application/json",
                },
                json=body,
            )
        except httpx.RequestError as error:
            raise ToolError("TEMPORARY_UNAVAILABLE") from error

        if response.status_code >= 400:
            self._raise_response_error(response)
        if response.status_code == 204 or not response.content:
            return None
        return response.json()

    @staticmethod
    def _raise_response_error(response: httpx.Response) -> None:
        """Map database failures to stable codes without exposing SQL details."""

        try:
            body = response.json()
            if isinstance(body, dict):
                message = str(body.get("message", "")).lower()
                code = str(
                    body.get("code") or body.get("error_code") or ""
                ).lower()
            else:
                message = ""
                code = ""
        except (ValueError, AttributeError):
            message = ""
            code = ""

        if response.status_code == 401:
            raise ToolError("AUTH_REQUIRED")
        if code in {
            "session_not_found",
            "bad_jwt",
            "jwt_expired",
            "refresh_token_not_found",
            "invalid_token",
        }:
            raise ToolError("AUTH_REQUIRED")
        if any(
            marker in message
            for marker in (
                "session_not_found",
                "jwt expired",
                "invalid jwt",
                "invalid token",
                "this mcp connection has been revoked",
                "mcp connection not found or revoked",
                "an active oauth session is required",
                "oauth session is no longer active",
            )
        ):
            raise ToolError("AUTH_REQUIRED")

        if response.status_code == 404:
            raise ToolError("NOT_FOUND_OR_INACCESSIBLE")

        if "not found" in message or "inaccessible" in message:
            raise ToolError("NOT_FOUND_OR_INACCESSIBLE")
        if any(
            marker in message
            for marker in (
                "not allowed",
                "permission denied",
                "row-level security",
                "violates row-level",
            )
        ):
            raise ToolError("PERMISSION_DENIED")
        if response.status_code == 403:
            raise ToolError("PERMISSION_DENIED")
        if "request id" in message:
            raise ToolError("REQUEST_CONFLICT")
        if any(
            marker in message
            for marker in (
                "not startable",
                "not submittable",
                "not awaiting review",
                "latest submission",
                "already archived",
            )
        ):
            raise ToolError("INVALID_STATE")
        if "approval" in message:
            raise ToolError("APPROVAL_INVALID")
        if any(
            marker in message
            for marker in (
                "invalid",
                "must be",
                "is required",
                "too long",
                "too large",
                "in the future",
            )
        ):
            raise ToolError("INVALID_INPUT")
        raise ToolError("OPERATION_FAILED")

    async def rpc(
        self,
        name: str,
        bearer_token: str,
        body: dict[str, Any],
    ) -> Any:
        return await self._post(
            f"/rest/v1/rpc/{name}", bearer_token, body=body
        )

    async def verify_session(self, bearer_token: str, expected_user_id: str) -> None:
        user = await self._get("/auth/v1/user", bearer_token)
        if not isinstance(user, dict) or user.get("id") != expected_user_id:
            raise ToolError("AUTH_REQUIRED")

    async def verify_active_account(
        self,
        bearer_token: str,
        user_id: str,
    ) -> None:
        profiles = await self._get(
            "/rest/v1/profiles",
            bearer_token,
            params={
                "select": "id,accepted_at,deleted_at",
                "id": f"eq.{user_id}",
                "limit": "1",
            },
        )
        if not isinstance(profiles, list) or len(profiles) != 1:
            raise ToolError("ACCOUNT_INACTIVE")

        profile = profiles[0]
        if profile.get("deleted_at") is not None or profile.get("accepted_at") is None:
            raise ToolError("ACCOUNT_INACTIVE")

    async def load_my_context(
        self,
        bearer_token: str,
        user_id: str,
    ) -> MyContextResult:
        profiles = await self._get(
            "/rest/v1/profiles",
            bearer_token,
            params={
                "select": (
                    "id,full_name,accepted_at,deleted_at,department_id,role_id"
                ),
                "id": f"eq.{user_id}",
                "limit": "1",
            },
        )
        if not isinstance(profiles, list) or len(profiles) != 1:
            raise ToolError("ACCOUNT_INACTIVE")

        profile = profiles[0]
        if profile.get("deleted_at") is not None or profile.get("accepted_at") is None:
            raise ToolError("ACCOUNT_INACTIVE")

        roles = await self._get(
            "/rest/v1/roles",
            bearer_token,
            params={
                "select": "name",
                "id": f"eq.{profile['role_id']}",
                "limit": "1",
            },
        )
        departments = await self._get(
            "/rest/v1/departments",
            bearer_token,
            params={
                "select": "name",
                "id": f"eq.{profile['department_id']}",
                "limit": "1",
            },
        )

        if len(roles) != 1 or len(departments) != 1:
            raise ToolError("ACCOUNT_INACTIVE")

        return MyContextResult(
            full_name=profile["full_name"],
            role=roles[0]["name"],
            department=departments[0]["name"],
        )

    async def touch_connection(
        self,
        bearer_token: str,
        connection_hash: str,
        client_name: str,
        client_uri: str | None,
    ) -> str:
        result = await self.rpc(
            "mcp_touch_connection",
            bearer_token,
            {
                "p_downstream_client_hash": connection_hash,
                "p_client_name": client_name,
                "p_client_uri": client_uri,
            },
        )
        if not isinstance(result, str):
            raise ToolError("OPERATION_FAILED")
        return result

    async def list_tasks(
        self,
        bearer_token: str,
        *,
        page: int,
        page_size: int,
        status: TaskStatus | None,
    ) -> TaskListResult:
        params = {
            "select": (
                "id,title,description,assigned_to,assigned_by,priority,deadline,"
                "status,created_at,attachment_name,attachment_path"
            ),
            "deleted_at": "is.null",
            "order": "created_at.desc,id.desc",
            "limit": str(page_size + 1),
            "offset": str((page - 1) * page_size),
        }
        if status is not None:
            params["status"] = f"eq.{status}"

        rows = await self._get(
            "/rest/v1/tasks", bearer_token, params=params
        )
        if not isinstance(rows, list):
            raise ToolError("OPERATION_FAILED")

        has_more = len(rows) > page_size
        visible_rows = rows[:page_size]
        names = await self._profile_names(bearer_token, visible_rows)
        tasks = [self._task_summary(row, names) for row in visible_rows]
        return TaskListResult(
            tasks=tasks,
            page=page,
            page_size=page_size,
            has_more=has_more,
        )

    async def get_task(self, bearer_token: str, task_id: str) -> TaskDetail:
        rows = await self._get(
            "/rest/v1/tasks",
            bearer_token,
            params={
                "select": (
                    "id,title,description,assigned_to,assigned_by,priority,"
                    "deadline,status,created_at,attachment_name,attachment_path"
                ),
                "id": f"eq.{task_id}",
                "deleted_at": "is.null",
                "limit": "1",
            },
        )
        if not isinstance(rows, list) or len(rows) != 1:
            raise ToolError("NOT_FOUND_OR_INACCESSIBLE")

        row = rows[0]
        names = await self._profile_names(bearer_token, [row])
        summary = self._task_summary(row, names)
        submissions = await self._get(
            "/rest/v1/submissions",
            bearer_token,
            params={
                "select": (
                    "id,note,submitted_at,reviewed_at,hr_feedback,file_path"
                ),
                "task_id": f"eq.{task_id}",
                "order": "submitted_at.desc,id.desc",
                "limit": "1",
            },
        )
        latest = None
        if isinstance(submissions, list) and submissions:
            submission = submissions[0]
            latest = SubmissionSummary(
                submission_id=submission["id"],
                note=submission["note"],
                submitted_at=submission["submitted_at"],
                reviewed_at=submission.get("reviewed_at"),
                hr_feedback=submission.get("hr_feedback"),
                has_file=bool(submission.get("file_path")),
            )
        return TaskDetail(**summary.model_dump(), latest_submission=latest)

    async def list_assignable_employees(
        self, bearer_token: str
    ) -> list[AssignableEmployeeResult]:
        rows = await self.rpc("assignable_employees", bearer_token, {})
        if not isinstance(rows, list):
            raise ToolError("OPERATION_FAILED")
        return [
            AssignableEmployeeResult(
                employee_id=row["id"], full_name=row["full_name"]
            )
            for row in rows
        ]

    async def get_employee_performance(
        self,
        bearer_token: str,
        employee_id: str,
    ) -> EmployeePerformanceResult:
        can_view = await self.rpc(
            "can_view_performance_subject",
            bearer_token,
            {"target": employee_id},
        )
        if can_view is not True:
            raise ToolError("NOT_FOUND_OR_INACCESSIBLE")

        profiles = await self._get(
            "/rest/v1/profiles",
            bearer_token,
            params={
                "select": "id,full_name,deleted_at,role_id",
                "id": f"eq.{employee_id}",
                "limit": "1",
            },
        )
        if not isinstance(profiles, list) or len(profiles) != 1:
            raise ToolError("NOT_FOUND_OR_INACCESSIBLE")
        profile = profiles[0]

        roles = await self._get(
            "/rest/v1/roles",
            bearer_token,
            params={
                "select": "assignable_work",
                "id": f"eq.{profile['role_id']}",
                "limit": "1",
            },
        )
        if not isinstance(roles, list) or len(roles) != 1:
            raise ToolError("NOT_FOUND_OR_INACCESSIBLE")

        tasks = await self._get(
            "/rest/v1/tasks",
            bearer_token,
            params={
                "select": "id,status,deadline",
                "assigned_to": f"eq.{employee_id}",
                "deleted_at": "is.null",
            },
        )
        submissions = await self._get(
            "/rest/v1/submissions",
            bearer_token,
            params={
                "select": "task_id,submitted_at",
                "employee_id": f"eq.{employee_id}",
            },
        )
        since = datetime.now(UTC) - timedelta(days=13)
        activity = await self._get(
            "/rest/v1/activity_log",
            bearer_token,
            params={
                "select": "created_at",
                "employee_id": f"eq.{employee_id}",
                "created_at": f"gte.{since.isoformat()}",
            },
        )
        if not all(isinstance(value, list) for value in (tasks, submissions, activity)):
            raise ToolError("OPERATION_FAILED")

        total_tasks = len(tasks)
        completed_tasks = sum(row.get("status") == "completed" for row in tasks)
        latest_submissions: dict[str, datetime] = {}
        for row in submissions:
            submitted_at = self._as_datetime(row["submitted_at"])
            current = latest_submissions.get(row["task_id"])
            if current is None or submitted_at > current:
                latest_submissions[row["task_id"]] = submitted_at

        deadline_by_task = {
            row["id"]: self._as_datetime(row["deadline"]) for row in tasks
        }
        submitted_count = 0
        on_time_count = 0
        for task_id, submitted_at in latest_submissions.items():
            deadline = deadline_by_task.get(task_id)
            if deadline is None:
                continue
            submitted_count += 1
            if submitted_at <= deadline:
                on_time_count += 1

        today = datetime.now(UTC).date()
        activity_counts = {
            today - timedelta(days=offset): 0 for offset in range(13, -1, -1)
        }
        for row in activity:
            activity_date = self._as_datetime(row["created_at"]).date()
            if activity_date in activity_counts:
                activity_counts[activity_date] += 1

        lifecycle_status: Literal["active", "promoted", "archived"]
        if profile.get("deleted_at") is not None:
            lifecycle_status = "archived"
        elif roles[0].get("assignable_work") is True:
            lifecycle_status = "active"
        else:
            lifecycle_status = "promoted"

        return EmployeePerformanceResult(
            full_name=profile["full_name"],
            lifecycle_status=lifecycle_status,
            total_tasks=total_tasks,
            completed_tasks=completed_tasks,
            completion_rate=(
                0 if total_tasks == 0 else round(completed_tasks / total_tasks * 100)
            ),
            on_time_rate=(
                0 if submitted_count == 0 else round(on_time_count / submitted_count * 100)
            ),
            recent_activity=[
                ActivityPoint(date=day.isoformat(), count=count)
                for day, count in activity_counts.items()
            ],
        )

    async def prepare_write(
        self,
        bearer_token: str,
        *,
        connection_hash: str,
        client_name: str,
        client_uri: str | None,
        tool_name: str,
        request_id: str,
        target_id: str | None,
        payload: dict[str, Any],
    ) -> dict[str, Any]:
        rows = await self.rpc(
            "mcp_prepare_write",
            bearer_token,
            {
                "p_connection_hash": connection_hash,
                "p_client_name": client_name,
                "p_client_uri": client_uri,
                "p_tool_name": tool_name,
                "p_request_id": request_id,
                "p_target_id": target_id,
                "p_payload": payload,
            },
        )
        if not isinstance(rows, list) or len(rows) != 1:
            raise ToolError("OPERATION_FAILED")
        return rows[0]

    async def prepare_upload(
        self,
        bearer_token: str,
        *,
        connection_hash: str,
        client_name: str,
        client_uri: str | None,
        purpose: Literal["task_attachment", "submission"],
        target_task_id: str | None,
    ) -> dict[str, Any]:
        rows = await self.rpc(
            "mcp_prepare_upload",
            bearer_token,
            {
                "p_connection_hash": connection_hash,
                "p_client_name": client_name,
                "p_client_uri": client_uri,
                "p_purpose": purpose,
                "p_target_task_id": target_task_id,
            },
        )
        if not isinstance(rows, list) or len(rows) != 1:
            raise ToolError("OPERATION_FAILED")
        return rows[0]

    async def get_upload_status(
        self,
        bearer_token: str,
        upload_token: str,
    ) -> UploadStatusResult:
        rows = await self.rpc(
            "get_mcp_upload",
            bearer_token,
            {"p_upload_token": upload_token},
        )
        if not isinstance(rows, list) or len(rows) != 1:
            raise ToolError("NOT_FOUND_OR_INACCESSIBLE")
        row = rows[0]
        return UploadStatusResult(
            upload_token=upload_token,
            purpose=row["purpose"],
            target_task_id=row.get("target_task_id"),
            state=row["state"],
            original_filename=row.get("original_filename"),
            byte_size=row.get("byte_size"),
            expires_at=row["expires_at"],
        )

    async def resolve_upload(
        self,
        bearer_token: str,
        *,
        connection_hash: str,
        upload_token: str,
        purpose: Literal["task_attachment", "submission"],
        target_task_id: str | None,
    ) -> dict[str, str]:
        rows = await self.rpc(
            "mcp_resolve_upload",
            bearer_token,
            {
                "p_connection_hash": connection_hash,
                "p_upload_token": upload_token,
                "p_purpose": purpose,
                "p_target_task_id": target_task_id,
            },
        )
        if not isinstance(rows, list) or len(rows) != 1:
            raise ToolError("NOT_FOUND_OR_INACCESSIBLE")
        path = rows[0].get("object_path")
        name = rows[0].get("original_filename")
        if not isinstance(path, str) or not isinstance(name, str):
            raise ToolError("OPERATION_FAILED")
        return {"object_path": path, "original_filename": name}

    async def approve_write(
        self,
        bearer_token: str,
        connection_hash: str,
        approval_token: str,
    ) -> None:
        result = await self.rpc(
            "mcp_approve_write",
            bearer_token,
            {
                "p_connection_hash": connection_hash,
                "p_approval_token": approval_token,
            },
        )
        if result is not True:
            raise ToolError("APPROVAL_INVALID")

    async def deny_write(self, bearer_token: str, approval_token: str) -> None:
        result = await self.rpc(
            "decide_mcp_approval",
            bearer_token,
            {"p_approval_token": approval_token, "p_decision": "deny"},
        )
        if result is not True:
            raise ToolError("APPROVAL_INVALID")

    async def execute_write(
        self,
        rpc_name: str,
        bearer_token: str,
        *,
        request_id: str,
        payload: dict[str, Any],
        connection_hash: str,
        approval_token: str,
    ) -> dict[str, Any]:
        result = await self.rpc(
            rpc_name,
            bearer_token,
            {
                "p_request_id": request_id,
                "p_payload": payload,
                "p_connection_hash": connection_hash,
                "p_approval_token": approval_token,
            },
        )
        if not isinstance(result, dict):
            raise ToolError("OPERATION_FAILED")
        return result

    async def get_work_file_link(
        self,
        bearer_token: str,
        *,
        kind: Literal["task", "submission"],
        record_id: str,
    ) -> WorkFileLinkResult:
        if kind == "task":
            endpoint = "/rest/v1/tasks"
            select = "attachment_path"
            path_key = "attachment_path"
            bucket = "task-attachments"
        else:
            endpoint = "/rest/v1/submissions"
            select = "file_path"
            path_key = "file_path"
            bucket = "submissions"

        rows = await self._get(
            endpoint,
            bearer_token,
            params={"select": select, "id": f"eq.{record_id}", "limit": "1"},
        )
        if not isinstance(rows, list) or len(rows) != 1 or not rows[0].get(path_key):
            raise ToolError("NOT_FOUND_OR_INACCESSIBLE")

        object_path = quote(rows[0][path_key], safe="/")
        signed = await self._post(
            f"/storage/v1/object/sign/{bucket}/{object_path}",
            bearer_token,
            body={"expiresIn": 60},
        )
        if not isinstance(signed, dict):
            raise ToolError("OPERATION_FAILED")
        url = signed.get("signedURL") or signed.get("signedUrl")
        if not isinstance(url, str):
            raise ToolError("OPERATION_FAILED")
        if url.startswith("/object/"):
            url = f"{self._project_url}/storage/v1{url}"
        elif url.startswith("/"):
            url = f"{self._project_url}{url}"
        return WorkFileLinkResult(url=url)

    async def _profile_names(
        self,
        bearer_token: str,
        task_rows: list[dict[str, Any]],
    ) -> dict[str, str]:
        ids = sorted(
            {
                str(row[key])
                for row in task_rows
                for key in ("assigned_to", "assigned_by")
                if row.get(key)
            }
        )
        if not ids:
            return {}
        profiles = await self._get(
            "/rest/v1/profiles",
            bearer_token,
            params={"select": "id,full_name", "id": f"in.({','.join(ids)})"},
        )
        if not isinstance(profiles, list):
            raise ToolError("OPERATION_FAILED")
        return {row["id"]: row["full_name"] for row in profiles}

    @staticmethod
    def _task_summary(
        row: dict[str, Any], names: dict[str, str]
    ) -> TaskSummary:
        return TaskSummary(
            task_id=row["id"],
            title=row["title"],
            description=row.get("description"),
            assignee_name=names.get(row["assigned_to"], "Unknown"),
            assigner_name=names.get(row["assigned_by"], "Unknown"),
            priority=row["priority"],
            deadline=row["deadline"],
            status=row["status"],
            created_at=row["created_at"],
            attachment_name=row.get("attachment_name"),
            has_attachment=bool(row.get("attachment_path")),
        )

    @staticmethod
    def _as_datetime(value: str) -> datetime:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
