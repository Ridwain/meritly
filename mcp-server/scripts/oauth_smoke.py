"""Run a real browser OAuth round-trip against the local Meritly MCP server."""

import argparse
import asyncio
from datetime import UTC, datetime, timedelta
from uuid import uuid4

from fastmcp import Client
from fastmcp.client.auth import OAuth


class ManualBrowserOAuth(OAuth):
    """Print the authorization URL so the controlled test browser can open it."""

    async def redirect_handler(self, authorization_url: str) -> None:
        # Keep FastMCP's safety pre-flight, but replace the OS-browser launch.
        async with self.httpx_client_factory() as client:
            response = await client.get(authorization_url, follow_redirects=False)
            if response.status_code not in (200, 302, 303, 307, 308):
                raise RuntimeError(
                    f"Unexpected authorization response: {response.status_code}"
                )

        print(f"MERITLY_AUTH_URL={authorization_url}", flush=True)


async def run(*, approval_preview: bool) -> None:
    auth = ManualBrowserOAuth(
        scopes=["openid"],
        client_name="Meritly OAuth Smoke Test",
        callback_host="127.0.0.1",
        callback_timeout=300,
    )

    async with Client("http://localhost:8000/mcp", auth=auth) as client:
        result = await client.call_tool("get_my_context")
        print(f"MCP_RESULT={result.data}", flush=True)
        tasks = await client.call_tool(
            "list_tasks", {"page": 1, "page_size": 2}
        )
        print(f"MCP_TASKS={tasks.data}", flush=True)

        if approval_preview:
            employees = await client.call_tool(
                "list_assignable_employees", {"page": 1, "page_size": 1}
            )
            if not employees.data.employees:
                raise RuntimeError("No assignable employee is available for the test")

            # This first call only creates an approval intent. It cannot create
            # the task until a person explicitly approves and retries it.
            approval = await client.call_tool(
                "create_task",
                {
                    "request_id": str(uuid4()),
                    "title": "MCP approval smoke test — do not approve",
                    "assigned_to": str(employees.data.employees[0].employee_id),
                    "priority": "low",
                    "deadline": (datetime.now(UTC) + timedelta(days=1)).isoformat(),
                    "description": "Denial-only test; no task should be created.",
                },
            )
            print(f"MCP_APPROVAL={approval.data}", flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--approval-preview",
        action="store_true",
        help="also create a browser approval intent without executing the write",
    )
    args = parser.parse_args()
    asyncio.run(run(approval_preview=args.approval_preview))
