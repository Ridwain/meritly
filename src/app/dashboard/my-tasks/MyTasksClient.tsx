"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { Paperclip, Play, Clock, Send, X } from "lucide-react";
import { createSupabaseBrowserClient } from "@/lib/supabaseClient";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge, type BadgeTone, StatusBadge } from "@/components/ui/Badge";
import { Label } from "@/components/ui/Label";
import type { MyTask, Notice, Priority, TaskStatus } from "@/lib/types";

// Record<Priority, BadgeTone> means a new priority can't be forgotten here.
const PRIORITY_TONE: Record<Priority, BadgeTone> = {
  high: "danger",
  medium: "warning",
  low: "neutral",
};
// Statuses from which an employee may submit work.
const CAN_SUBMIT: TaskStatus[] = ["in_progress", "needs_revision", "overdue"];
const FIELD =
  "w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20";

function formatDeadline(ts: string): string {
  return new Date(ts).toLocaleString("en-US", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export type MyTasksClientProps = {
  tasks: MyTask[];
  userId: string;
  canWork: boolean;
};

export default function MyTasksClient({
  tasks,
  userId,
  canWork,
}: MyTasksClientProps) {
  const router = useRouter();
  const supabase = createSupabaseBrowserClient();
  // useRef<HTMLInputElement>(null) — tells TS this ref points at a file input,
  // so fileRef.current.files is known to exist.
  const fileRef = useRef<HTMLInputElement>(null);

  const [busyId, setBusyId] = useState<string | null>(null);
  const [submittingId, setSubmittingId] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);

  async function start(id: string) {
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

  function openSubmit(id: string) {
    setSubmittingId(id);
    setNote("");
    setNotice(null);
    if (fileRef.current) fileRef.current.value = "";
  }
  function cancelSubmit() {
    setSubmittingId(null);
    setNote("");
    if (fileRef.current) fileRef.current.value = "";
  }

  async function submitWork(task: MyTask) {
    setSaving(true);
    setNotice(null);

    // 1) Optional file upload (into the employee's own folder).
    let file_url: string | null = null;
    const file = fileRef.current?.files?.[0];
    if (file) {
      const path = `${userId}/${task.id}-${Date.now()}-${file.name}`;
      const { error: upErr } = await supabase.storage
        .from("submissions")
        .upload(path, file);
      if (upErr) {
        setNotice({ type: "error", text: upErr.message });
        setSaving(false);
        return;
      }
      file_url = supabase.storage.from("submissions").getPublicUrl(path)
        .data.publicUrl;
    }

    // 2) Insert the submission FIRST — RLS only allows this while the task is
    //    still in a submittable state (in_progress / needs_revision / overdue).
    const { error: subErr } = await supabase.from("submissions").insert({
      task_id: task.id,
      employee_id: userId,
      note: note.trim(),
      file_url,
    });
    if (subErr) {
      setNotice({ type: "error", text: subErr.message });
      setSaving(false);
      return;
    }

    // 3) Then flip the task to 'submitted'.
    const { error: taskErr } = await supabase
      .from("tasks")
      .update({ status: "submitted" })
      .eq("id", task.id);
    if (taskErr) {
      setNotice({ type: "error", text: taskErr.message });
      setSaving(false);
      return;
    }

    setSubmittingId(null);
    setNote("");
    if (fileRef.current) fileRef.current.value = "";
    setSaving(false);
    router.refresh();
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
        My tasks
      </h1>
      <p className="mt-1 text-sm text-slate-500">
        Work assigned to you, soonest deadline first.
      </p>
      {!canWork && (
        <p className="mt-3 rounded-lg bg-slate-100 px-3 py-2 text-sm text-slate-600">
          Your role can view assigned tasks, but cannot start or submit work.
        </p>
      )}

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

                  {/* HR feedback when the task was returned for revision */}
                  {t.status === "needs_revision" && t.latest_feedback && (
                    <div className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">
                      <span className="font-medium">HR feedback:</span>{" "}
                      {t.latest_feedback}
                    </div>
                  )}
                </div>

                {/* Action button */}
                {canWork && (
                  <div className="shrink-0">
                    {t.status === "pending" && (
                      <Button
                        onClick={() => start(t.id)}
                        disabled={busyId === t.id}
                      >
                        <Play className="h-4 w-4" />
                        {busyId === t.id ? "Starting…" : "Start"}
                      </Button>
                    )}
                    {CAN_SUBMIT.includes(t.status) &&
                      submittingId !== t.id && (
                        <Button onClick={() => openSubmit(t.id)}>
                          <Send className="h-4 w-4" />
                          Submit work
                        </Button>
                      )}
                  </div>
                )}
              </div>

              {/* Inline submit form */}
              {canWork && submittingId === t.id && (
                <div className="mt-4 border-t border-slate-200 pt-4">
                  <Label>Work note</Label>
                  <textarea
                    rows={3}
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder="Describe what you did"
                    className={FIELD}
                  />
                  <div className="mt-3">
                    <Label>Attach a file (optional)</Label>
                    <input
                      ref={fileRef}
                      type="file"
                      accept=".pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg,.webp,.txt,.zip"
                      className="block w-full text-sm text-slate-600 file:mr-3 file:cursor-pointer file:rounded-lg file:border-0 file:bg-brand-50 file:px-3 file:py-2 file:text-sm file:font-medium file:text-brand-700 hover:file:bg-brand-100"
                    />
                  </div>
                  <div className="mt-3 flex gap-2">
                    <Button
                      onClick={() => submitWork(t)}
                      disabled={saving || !note.trim()}
                    >
                      <Send className="h-4 w-4" />
                      {saving ? "Submitting…" : "Submit work"}
                    </Button>
                    <Button
                      variant="secondary"
                      onClick={cancelSubmit}
                      disabled={saving}
                    >
                      <X className="h-4 w-4" />
                      Cancel
                    </Button>
                  </div>
                </div>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
