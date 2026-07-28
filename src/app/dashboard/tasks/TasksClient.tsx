"use client";

import { useState, useRef, Fragment, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import {
  Plus,
  Pencil,
  X,
  Paperclip,
  ClipboardCheck,
  Check,
  RotateCcw,
} from "lucide-react";
import { createSupabaseBrowserClient } from "@/lib/supabaseClient";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge, type BadgeTone, StatusBadge } from "@/components/ui/Badge";
import { Input } from "@/components/ui/Input";
import { Label } from "@/components/ui/Label";
import { Avatar } from "@/components/ui/Avatar";
import type {
  AssignableEmployee,
  HrTask,
  Notice,
  Priority,
  TaskCapabilities,
} from "@/lib/types";

const PRIORITY_TONE: Record<Priority, BadgeTone> = {
  high: "danger",
  medium: "warning",
  low: "neutral",
};
const FIELD =
  "w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20";

// datetime-local input <-> stored timestamp helpers.
function toInputValue(ts: string): string {
  const d = new Date(ts);
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}
function formatDeadline(ts: string): string {
  return new Date(ts).toLocaleString("en-US", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

// The shape of the create/edit form.
type TaskForm = {
  title: string;
  description: string;
  assigned_to: string;
  priority: Priority;
  deadline: string;
};

// What we send when creating/updating a task (attachment fields are optional).
type TaskPayload = {
  title: string;
  description: string | null;
  assigned_to: string;
  priority: Priority;
  deadline: string;
  attachment_url?: string;
  attachment_name?: string;
};

const EMPTY: TaskForm = {
  title: "",
  description: "",
  assigned_to: "",
  priority: "medium",
  deadline: "",
};

export type TasksClientProps = {
  tasks: HrTask[];
  employees: AssignableEmployee[];
  currentUserId: string;
  capabilities: TaskCapabilities;
};

export default function TasksClient({
  tasks,
  employees,
  currentUserId,
  capabilities,
}: TasksClientProps) {
  const router = useRouter();
  const supabase = createSupabaseBrowserClient();

  const [form, setForm] = useState<TaskForm>(EMPTY);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editAttachment, setEditAttachment] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Review state
  const [reviewingId, setReviewingId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState("");
  const [reviewBusy, setReviewBusy] = useState(false);

  // Generic setter: K is a key of TaskForm, and v must match that key's type,
  // so set("priority", "urgent") is a compile error.
  const set = <K extends keyof TaskForm>(k: K, v: TaskForm[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  function startEdit(t: HrTask) {
    setEditingId(t.id);
    setEditAttachment(t.attachment_name);
    setForm({
      title: t.title,
      description: t.description ?? "",
      assigned_to: t.assigned_to,
      priority: t.priority,
      deadline: toInputValue(t.deadline),
    });
    if (fileRef.current) fileRef.current.value = "";
    setNotice(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function cancelEdit() {
    setEditingId(null);
    setEditAttachment(null);
    setForm(EMPTY);
    if (fileRef.current) fileRef.current.value = "";
    setNotice(null);
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setNotice(null);

    const base: TaskPayload = {
      title: form.title.trim(),
      description: form.description.trim() || null,
      assigned_to: form.assigned_to,
      priority: form.priority,
      deadline: new Date(form.deadline).toISOString(),
    };

    // If a file was chosen, upload it to Storage first, then save its public URL.
    const file = fileRef.current?.files?.[0];
    if (file) {
      const path = `${currentUserId}/${Date.now()}-${file.name}`;
      const { error: upErr } = await supabase.storage
        .from("task-attachments")
        .upload(path, file);
      if (upErr) {
        setNotice({ type: "error", text: upErr.message });
        setBusy(false);
        return;
      }
      const {
        data: { publicUrl },
      } = supabase.storage.from("task-attachments").getPublicUrl(path);
      base.attachment_url = publicUrl;
      base.attachment_name = file.name;
    }

    let error;
    if (editingId) {
      ({ error } = await supabase
        .from("tasks")
        .update(base)
        .eq("id", editingId));
    } else {
      // assigned_by must be the current user; RLS also verifies this.
      ({ error } = await supabase.from("tasks").insert({
        ...base,
        assigned_by: currentUserId,
        status: "pending",
      }));
    }

    if (error) {
      setNotice({ type: "error", text: error.message });
      setBusy(false);
      return;
    }
    setForm(EMPTY);
    setEditingId(null);
    setEditAttachment(null);
    if (fileRef.current) fileRef.current.value = "";
    setBusy(false);
    router.refresh();
  }

  async function archive(id: string) {
    setBusy(true);
    setNotice(null);
    const { error } = await supabase
      .from("tasks")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", id);
    if (error) setNotice({ type: "error", text: error.message });
    else router.refresh();
    setBusy(false);
  }

  function openReview(t: HrTask) {
    setReviewingId(t.id);
    setFeedback(t.latest_submission?.hr_feedback ?? "");
    setNotice(null);
  }
  function cancelReview() {
    setReviewingId(null);
    setFeedback("");
  }

  // decision = 'completed' (approve) or 'needs_revision' (return)
  async function review(task: HrTask, decision: "completed" | "needs_revision") {
    setReviewBusy(true);
    setNotice(null);

    // 1) Save HR feedback on the submission (only feedback fields may change).
    const sub = task.latest_submission;
    if (sub) {
      const { error: fbErr } = await supabase
        .from("submissions")
        .update({
          hr_feedback: feedback.trim() || null,
          reviewed_at: new Date().toISOString(),
        })
        .eq("id", sub.id);
      if (fbErr) {
        setNotice({ type: "error", text: fbErr.message });
        setReviewBusy(false);
        return;
      }
    }

    // 2) Set the task status (submitted -> completed / needs_revision).
    const { error: tErr } = await supabase
      .from("tasks")
      .update({ status: decision })
      .eq("id", task.id);
    if (tErr) {
      setNotice({ type: "error", text: tErr.message });
      setReviewBusy(false);
      return;
    }

    setReviewingId(null);
    setFeedback("");
    setReviewBusy(false);
    router.refresh();
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
        Tasks
      </h1>
      <p className="mt-1 text-sm text-slate-500">
        Track work and use the actions allowed by your role.
      </p>

      {/* Create / edit form */}
      {(capabilities.create || editingId) && (
        <Card className="mt-6 p-5">
          <h2 className="mb-4 text-sm font-semibold text-slate-900">
            {editingId ? "Edit task" : "New task"}
          </h2>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <Label>Title</Label>
              <Input
                required
                value={form.title}
                onChange={(e) => set("title", e.target.value)}
                placeholder="Prepare Q3 report"
              />
            </div>
            <div>
              <Label>Description</Label>
              <textarea
                rows={2}
                value={form.description}
                onChange={(e) => set("description", e.target.value)}
                placeholder="What needs to be done"
                className={FIELD}
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              <div>
                <Label>Assignee</Label>
                <select
                  required
                  value={form.assigned_to}
                  onChange={(e) => set("assigned_to", e.target.value)}
                  className={FIELD}
                >
                  <option value="" disabled>
                    Select a worker
                  </option>
                  {employees.map((emp) => (
                    <option key={emp.id} value={emp.id}>
                      {emp.full_name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <Label>Priority</Label>
                <select
                  value={form.priority}
                  // A <select> value is always `string`, so assert it back to
                  // Priority — safe because the only options are the three below.
                  onChange={(e) => set("priority", e.target.value as Priority)}
                  className={FIELD}
                >
                  <option value="high">High</option>
                  <option value="medium">Medium</option>
                  <option value="low">Low</option>
                </select>
              </div>
              <div>
                <Label>Deadline</Label>
                <Input
                  type="datetime-local"
                  required
                  value={form.deadline}
                  // Only block past dates when ASSIGNING a new task. An
                  // existing task can legitimately already be overdue — if
                  // this also applied while editing, HR couldn't save any
                  // other change on it without being forced to push the
                  // deadline forward too.
                  min={
                    editingId
                      ? undefined
                      : toInputValue(new Date().toISOString())
                  }
                  onChange={(e) => set("deadline", e.target.value)}
                />
              </div>
            </div>

            <div>
              <Label>Attachment (optional)</Label>
              <input
                ref={fileRef}
                type="file"
                accept=".pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg,.webp,.txt,.zip"
                className="block w-full text-sm text-slate-600 file:mr-3 file:cursor-pointer file:rounded-lg file:border-0 file:bg-brand-50 file:px-3 file:py-2 file:text-sm file:font-medium file:text-brand-700 hover:file:bg-brand-100"
              />
              {editingId && editAttachment && (
                <p className="mt-1 text-xs text-slate-500">
                  Current: {editAttachment} — choose a file to replace it.
                </p>
              )}
            </div>

            {notice && !reviewingId && (
              <p
                className={`text-sm ${
                  notice.type === "error"
                    ? "text-rose-600"
                    : "text-emerald-600"
                }`}
              >
                {notice.text}
              </p>
            )}

            <div className="flex gap-2">
              <Button type="submit" disabled={busy}>
                {!editingId && <Plus className="h-4 w-4" />}
                {busy
                  ? "Saving…"
                  : editingId
                    ? "Save changes"
                    : "Assign task"}
              </Button>
              {editingId && (
                <Button
                  type="button"
                  variant="secondary"
                  onClick={cancelEdit}
                  disabled={busy}
                >
                  <X className="h-4 w-4" />
                  Cancel
                </Button>
              )}
            </div>
          </form>
        </Card>
      )}

      {/* Task list */}
      <Card className="mt-4 overflow-hidden">
        {tasks.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-slate-500">
            {capabilities.create
              ? "No tasks yet. Assign your first task above."
              : "No active tasks."}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-5 py-3 font-medium">Task</th>
                  <th className="px-4 py-3 font-medium">Assignee</th>
                  <th className="px-4 py-3 font-medium">Priority</th>
                  <th className="px-4 py-3 font-medium">Deadline</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-5 py-3 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {tasks.map((t) => (
                  <Fragment key={t.id}>
                    <tr className="hover:bg-slate-50/60">
                      <td className="px-5 py-3">
                        <p className="font-medium text-slate-900">{t.title}</p>
                        {t.description && (
                          <p className="max-w-xs truncate text-xs text-slate-500">
                            {t.description}
                          </p>
                        )}
                        {t.attachment_url && (
                          <a
                            href={t.attachment_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-brand-600 hover:underline"
                          >
                            <Paperclip className="h-3 w-3" />
                            {t.attachment_name || "Attachment"}
                          </a>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <Avatar
                            name={t.assignee_name}
                            className="h-7 w-7 text-[11px]"
                          />
                          <span className="text-slate-700">
                            {t.assignee_name}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <Badge tone={PRIORITY_TONE[t.priority]}>
                          <span className="capitalize">{t.priority}</span>
                        </Badge>
                      </td>
                      <td className="px-4 py-3 text-slate-600">
                        {formatDeadline(t.deadline)}
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge status={t.status} />
                      </td>
                      <td className="px-5 py-3">
                        <div className="flex justify-end gap-2">
                          {capabilities.review && t.status === "submitted" && (
                            <Button
                              size="sm"
                              onClick={() => openReview(t)}
                              disabled={reviewBusy}
                            >
                              <ClipboardCheck className="h-3.5 w-3.5" />
                              Review
                            </Button>
                          )}
                          {capabilities.update && (
                            <Button
                              variant="secondary"
                              size="sm"
                              onClick={() => startEdit(t)}
                              disabled={busy}
                            >
                              <Pencil className="h-3.5 w-3.5" />
                              Edit
                            </Button>
                          )}
                          {capabilities.archive && (
                            <Button
                              variant="danger"
                              size="sm"
                              onClick={() => archive(t.id)}
                              disabled={busy}
                            >
                              Archive
                            </Button>
                          )}
                          {!capabilities.review &&
                            !capabilities.update &&
                            !capabilities.archive && (
                              <span className="text-xs text-slate-400">—</span>
                            )}
                        </div>
                      </td>
                    </tr>

                    {/* Review panel */}
                    {reviewingId === t.id && (
                      <tr className="bg-slate-50">
                        <td colSpan={6} className="px-5 py-4">
                          <div className="rounded-lg border border-slate-200 bg-white p-4">
                            <h3 className="text-sm font-semibold text-slate-900">
                              Review submission
                            </h3>
                            {t.latest_submission ? (
                              <>
                                <p className="mt-2 whitespace-pre-wrap text-sm text-slate-700">
                                  {t.latest_submission.note}
                                </p>
                                {t.latest_submission.file_url && (
                                  <a
                                    href={t.latest_submission.file_url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-brand-600 hover:underline"
                                  >
                                    <Paperclip className="h-3.5 w-3.5" />
                                    Submitted file
                                  </a>
                                )}
                                <div className="mt-3">
                                  <Label>Feedback (optional)</Label>
                                  <textarea
                                    rows={2}
                                    value={feedback}
                                    onChange={(e) => setFeedback(e.target.value)}
                                    placeholder="Feedback for the employee"
                                    className={FIELD}
                                  />
                                </div>
                                {notice && (
                                  <p className="mt-2 text-sm text-rose-600">
                                    {notice.text}
                                  </p>
                                )}
                                <div className="mt-3 flex flex-wrap gap-2">
                                  <Button
                                    onClick={() => review(t, "completed")}
                                    disabled={reviewBusy}
                                  >
                                    <Check className="h-4 w-4" />
                                    Approve &amp; complete
                                  </Button>
                                  <Button
                                    variant="secondary"
                                    onClick={() => review(t, "needs_revision")}
                                    disabled={reviewBusy}
                                  >
                                    <RotateCcw className="h-4 w-4" />
                                    Return for revision
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    onClick={cancelReview}
                                    disabled={reviewBusy}
                                  >
                                    Cancel
                                  </Button>
                                </div>
                              </>
                            ) : (
                              <p className="mt-2 text-sm text-slate-500">
                                No submission found for this task.
                              </p>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
