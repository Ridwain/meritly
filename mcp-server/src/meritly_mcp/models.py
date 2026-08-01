"""Strict public schemas returned by Meritly MCP tools."""

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


TaskStatus = Literal[
    "pending",
    "in_progress",
    "submitted",
    "completed",
    "needs_revision",
    "overdue",
]
Priority = Literal["high", "medium", "low"]


class StrictResult(BaseModel):
    model_config = ConfigDict(extra="forbid")


class MyContextResult(StrictResult):

    full_name: str
    role: str
    department: str


class TaskSummary(StrictResult):
    task_id: UUID
    title: str
    description: str | None
    assignee_name: str
    assigner_name: str
    priority: Priority
    deadline: datetime
    status: TaskStatus
    created_at: datetime
    attachment_name: str | None
    has_attachment: bool


class TaskListResult(StrictResult):
    tasks: list[TaskSummary]
    page: int = Field(ge=1)
    page_size: int = Field(ge=1, le=50)
    has_more: bool


class SubmissionSummary(StrictResult):
    submission_id: UUID
    note: str
    submitted_at: datetime
    reviewed_at: datetime | None
    hr_feedback: str | None
    has_file: bool


class TaskDetail(TaskSummary):
    latest_submission: SubmissionSummary | None


class AssignableEmployeeResult(StrictResult):
    employee_id: UUID
    full_name: str


class AssignableEmployeeListResult(StrictResult):
    employees: list[AssignableEmployeeResult]
    page: int = Field(ge=1)
    page_size: int = Field(ge=1, le=50)
    has_more: bool


class ActivityPoint(StrictResult):
    date: str
    count: int = Field(ge=0)


class EmployeePerformanceResult(StrictResult):
    full_name: str
    lifecycle_status: Literal["active", "promoted", "archived"]
    total_tasks: int = Field(ge=0)
    completed_tasks: int = Field(ge=0)
    completion_rate: int = Field(ge=0, le=100)
    on_time_rate: int = Field(ge=0, le=100)
    recent_activity: list[ActivityPoint]


class ApprovalRequiredResult(StrictResult):
    state: Literal["approval_required"] = "approval_required"
    request_id: UUID
    approval_url: str
    expires_at: datetime
    message: str


class UploadPreparationResult(StrictResult):
    upload_token: UUID
    upload_url: str
    expires_at: datetime
    message: str


class UploadStatusResult(StrictResult):
    upload_token: UUID
    purpose: Literal["task_attachment", "submission"]
    target_task_id: UUID | None
    state: Literal["pending", "uploaded", "consumed", "expired"]
    original_filename: str | None
    byte_size: int | None
    expires_at: datetime


class WriteOperationResult(StrictResult):
    state: Literal["completed"] = "completed"
    request_id: UUID
    task_id: UUID
    status: TaskStatus
    submission_id: UUID | None = None
    duplicate_request: bool


class WorkFileLinkResult(StrictResult):
    url: str
    expires_in_seconds: Literal[60] = 60


WriteToolResult = WriteOperationResult | ApprovalRequiredResult
