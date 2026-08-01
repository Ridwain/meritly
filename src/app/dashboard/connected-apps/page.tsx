import { Card } from "@/components/ui/Card";
import { createSupabaseServerClient } from "@/lib/supabaseServer";

export default async function ConnectedAppsPage() {
  const supabase = await createSupabaseServerClient();
  const { data: connections } = await supabase.rpc("list_mcp_connections");

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
        Connected apps
      </h1>
      <p className="mt-1 text-sm text-slate-500">
        Review and revoke ChatGPT, Claude, and other Meritly MCP connections.
      </p>

      {!connections?.length ? (
        <Card className="mt-6 p-8 text-center text-sm text-slate-500">
          No active MCP connections.
        </Card>
      ) : (
        <div className="mt-6 space-y-3">
          {connections.map((connection) => (
            <Card key={connection.id} className="flex items-center justify-between gap-4 p-5">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="font-semibold text-slate-900">
                    {connection.client_name}
                  </h2>
                </div>
                <p className="mt-1 text-xs text-slate-500">
                  Last used {new Date(connection.last_seen_at).toLocaleString()}
                </p>
                {connection.client_uri && (
                  <p className="mt-1 truncate text-xs text-slate-400">
                    {connection.client_uri}
                  </p>
                )}
              </div>

              <form action="/api/mcp/revoke" method="POST">
                <input type="hidden" name="connection_id" value={connection.id} />
                <button
                  type="submit"
                  className="rounded-lg border border-rose-200 px-3 py-2 text-sm font-medium text-rose-700 hover:bg-rose-50"
                >
                  Revoke
                </button>
              </form>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
