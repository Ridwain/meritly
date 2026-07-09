"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Paperclip, Play, Clock } from "lucide-react";
import { createSupabaseBrowserClient } from "@/lib/supabaseClient";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge, StatusBadge } from "@/components/ui/Badge";

const PRIORITY_TONE = { high: "danger", medium: "warning", low: "neutral" };

function formatDeadline(ts) {
  return new Date(ts).toLocaleString("en-US", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default function MyTasksClient({ tasks }) {
  const router = useRouter();
  const supabase = createSupabaseBrowserClient();
  const [busyId, setBusyId] = useState(null);
  const [notice, setNotice] = useState(null);

  // Move a pending task to in_progress. The status-whitelist trigger only
  // allows pending -> in_progress here, so nothing else can slip through.
  async function start(id) {
    setBusyId(id);
    setNotice(null);
    const { error } = await supabase
      .from("tasks")
      .update({ status: "in_progress" })
      .eq("id", id);
    if (error) setNotice({ type: "error", text: error.message });
    else router.refresh();
    setBusyId(null);
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
        My tasks
      </h1>
      <p className="mt-1 text-sm text-slate-500">
        Work assigned to you, soonest deadline first.
      </p>

      {notice && <p className="mt-3 text-sm text-rose-600">{notice.text}</p>}

      {tasks.length === 0 ? (
        <Card className="mt-6 p-10 text-center text-sm text-slate-500">
          No tasks assigned to you yet.
        </Card>
      ) : (
        <div className="mt-6 space-y-3">
          {tasks.map((t) => (
            <Card key={t.id} className="p-5">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="font-semibold text-slate-900">{t.title}</h2>
                    <StatusBadge status={t.status} />
                    <Badge tone={PRIORITY_TONE[t.priority]}>
                      <span className="capitalize">{t.priority}</span>
                    </Badge>
                  </div>

                  {t.description && (
                    <p className="mt-1 text-sm text-slate-600">
                      {t.description}
                    </p>
                  )}

                  <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
                    <span className="inline-flex items-center gap-1">
                      <Clock className="h-3.5 w-3.5" />
                      Due {formatDeadline(t.deadline)}
                    </span>
                    <span>Assigned by {t.assigner_name}</span>
                    {t.attachment_url && (
                      <a
                        href={t.attachment_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 font-medium text-brand-600 hover:underline"
                      >
                        <Paperclip className="h-3.5 w-3.5" />
                        {t.attachment_name || "Attachment"}
                      </a>
                    )}
                  </div>
                </div>

                {t.status === "pending" && (
                  <Button onClick={() => start(t.id)} disabled={busyId === t.id}>
                    <Play className="h-4 w-4" />
                    {busyId === t.id ? "Starting…" : "Start"}
                  </Button>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
