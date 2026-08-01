import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Card } from "@/components/ui/Card";
import { createSupabaseServerClient } from "@/lib/supabaseServer";

export const metadata: Metadata = {
  title: "Approve Meritly action",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

function MessageCard({ title, message }: { title: string; message: string }) {
  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-xl p-8">
        <p className="text-sm font-semibold uppercase tracking-[0.2em] text-brand-600">
          Meritly
        </p>
        <h1 className="mt-2 text-2xl font-semibold text-slate-900">{title}</h1>
        <p className="mt-3 text-sm text-slate-600">{message}</p>
      </Card>
    </main>
  );
}

export default async function McpApprovalPage({
  searchParams,
}: {
  searchParams: Promise<{
    token?: string | string[];
  }>;
}) {
  const params = await searchParams;
  const token = Array.isArray(params.token) ? params.token[0] : params.token;
  if (!token || !/^[0-9a-f-]{36}$/i.test(token)) {
    return (
      <MessageCard
        title="Approval unavailable"
        message="This approval link is invalid or incomplete."
      />
    );
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    const next = `/mcp/approve?token=${encodeURIComponent(token)}`;
    redirect(`/login?next=${encodeURIComponent(next)}`);
  }

  const { data, error } = await supabase.rpc("get_mcp_approval", {
    p_approval_token: token,
  });
  const approval = data?.[0];
  if (error || !approval) {
    return (
      <MessageCard
        title="Approval unavailable"
        message="This action is expired, inaccessible, or no longer available."
      />
    );
  }

  if (approval.state === "approved" || approval.state === "denied") {
    return (
      <MessageCard
        title={approval.state === "approved" ? "Action approved" : "Action denied"}
        message={
          approval.state === "approved"
            ? "Return to ChatGPT or Claude and retry the same tool call with the same request ID."
            : "The pending action was denied and cannot be executed."
        }
      />
    );
  }

  const expired = new Date(approval.expires_at).getTime() <= Date.now();
  if (approval.state !== "pending" || expired) {
    return (
      <MessageCard
        title="Approval unavailable"
        message={
          expired
            ? "This five-minute approval expired. Ask the assistant to prepare the action again."
            : approval.state === "consumed"
              ? "This approved action has already been completed."
              : `This action is already ${approval.state}.`
        }
      />
    );
  }

  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-xl p-8 shadow-sm">
        <p className="text-sm font-semibold uppercase tracking-[0.2em] text-brand-600">
          Meritly
        </p>
        <h1 className="mt-2 text-2xl font-semibold text-slate-900">
          Approve {approval.tool_name.replaceAll("_", " ")}
        </h1>
        <p className="mt-3 text-sm leading-6 text-slate-600">
          <span className="font-medium text-slate-900">{approval.client_name}</span>{" "}
          requested this action. Check every field before approving it.
        </p>

        <pre className="mt-5 max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-xl border border-slate-200 bg-slate-50 p-4 text-xs leading-5 text-slate-700">
          {JSON.stringify(approval.payload, null, 2)}
        </pre>
        <p className="mt-3 text-xs text-slate-500">
          This approval expires at {new Date(approval.expires_at).toLocaleString()} and can be used once.
        </p>

        <form action="/api/mcp/approval" method="POST" className="mt-6 flex gap-3">
          <input type="hidden" name="token" value={token} />
          <button
            type="submit"
            name="decision"
            value="deny"
            className="flex-1 rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Deny
          </button>
          <button
            type="submit"
            name="decision"
            value="approve"
            className="flex-1 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
          >
            Approve once
          </button>
        </form>
      </Card>
    </main>
  );
}
