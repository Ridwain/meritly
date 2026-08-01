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
  UserRoundX,
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
  attachment_path?: string;
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
  const [custodyFilter, setCustodyFilter] = useState<
    "all" | "needs_reassignment" | "needs_review"
  >("all");

  const editingTask = editingId
    ? tasks.find((task) => task.id === editingId)
    : null;
  const reassignmentCount = tasks.filter(
    (task) => task.custody_category === "needs_reassignment"
  ).length;
  const needsReviewCount = tasks.filter(
    (task) => task.custody_category === "needs_review"
  ).length;
  const visibleTasks =
    custodyFilter === "all"
      ? tasks
      : tasks.filter((task) => task.custody_category === custodyFilter);

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

    // If a file was chosen, upload it first, then save only its canonical path.
    // A signed download URL is created later after RLS authorizes the viewer.
    const file = fileRef.current?.files?.[0];
    let uploadedPath: string | null = null;
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
      uploadedPath = path;
      base.attachment_path = path;
      base.attachment_name = file.name;
    }

    // One RPC call owns the whole database change. The request ID lets the
    // database safely return the first result if the same call is retried.
    const requestId = crypto.randomUUID();
    let error;
    if (editingId) {
      ({ error } = await supabase.rpc("update_task_transaction", {
        p_request_id: requestId,
        p_payload: { task_id: editingId, ...base },
      }));
    } else {
      ({ error } = await supabase.rpc("create_task_transaction", {
        p_request_id: requestId,
        p_payload: base,
      }));
    }

    if (error) {
      if (uploadedPath) {
        await fetch("/api/cleanup-upload", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            bucket: "task-attachments",
            path: uploadedPath,
          }),
        });
      }
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
    const { error } = await supabase.rpc("archive_task_transaction", {
      p_request_id: crypto.randomUUID(),
      p_payload: { task_id: id },
    });
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

    const sub = task.latest_submission;
    if (!sub) {
      setNotice({ type: "error", text: "No submission is available to review." });
      setReviewBusy(false);
      return;
    }

    // Feedback and task status now commit together, so a partial review cannot
    // leave the submission and task disagreeing with each other.
    const { error } = await supabase.rpc("review_submission_transaction", {
      p_request_id: crypto.randomUUID(),
      p_payload: {
        task_id: task.id,
        submission_id: sub.id,
        decision,
        feedback: feedback.trim() || null,
      },
    });
    if (error) {
      setNotice({ type: "error", text: error.message });
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
                  disabled={editingTask?.status === "submitted"}
                  className={FIELD}
                >
                  <option value="" disabled>
                    Select a worker
                  </option>
                  {editingTask &&
                    !employees.some(
                      (employee) => employee.id === editingTask.assigned_to
                    ) && (
                      <option value={editingTask.assigned_to}>
                        {editingTask.assignee_name}
                      </option>
                    )}
                  {employees.map((emp) => (
                    <option key={emp.id} value={emp.id}>
                      {emp.full_name}
                    </option>
                  ))}
                </select>
                {editingTask?.status === "submitted" && (
                  <p className="mt-1 text-xs text-amber-700">
                    Submitted work must stay with its original employee.
                  </p>
                )}
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

      {(reassignmentCount > 0 || needsReviewCount > 0) && (
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <button
            type="button"
            onClick={() =>
              setCustodyFilter((current) =>
                current === "needs_reassignment"
                  ? "all"
                  : "needs_reassignment"
              )
            }
            className={`rounded-xl border p-4 text-left transition-colors ${
              custodyFilter === "needs_reassignment"
                ? "border-rose-300 bg-rose-50"
                : "border-slate-200 bg-white hover:border-rose-200"
            }`}
          >
            <div className="flex items-center gap-2 text-rose-700">
              <UserRoundX className="h-4 w-4" />
              <span className="text-sm font-semibold">Needs reassignment</span>
            </div>
            <p className="mt-1 text-2xl font-semibold text-slate-900">
              {reassignmentCount}
            </p>
            <p className="text-xs text-slate-500">
              Work owned by an inactive or non-worker account.
            </p>
          </button>
          <button
            type="button"
            onClick={() =>
              setCustodyFilter((current) =>
                current === "needs_review" ? "all" : "needs_review"
              )
            }
            className={`rounded-xl border p-4 text-left transition-colors ${
              custodyFilter === "needs_review"
                ? "border-amber-300 bg-amber-50"
                : "border-slate-200 bg-white hover:border-amber-200"
            }`}
          >
            <div className="flex items-center gap-2 text-amber-700">
              <ClipboardCheck className="h-4 w-4" />
              <span className="text-sm font-semibold">Needs review</span>
            </div>
            <p className="mt-1 text-2xl font-semibold text-slate-900">
              {needsReviewCount}
            </p>
            <p className="text-xs text-slate-500">
              Submitted evidence kept with the original employee.
            </p>
          </button>
        </div>
      )}

      {/* Task list */}
      <Card className="mt-4 overflow-hidden">
        {visibleTasks.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-slate-500">
            {tasks.length > 0
              ? "No tasks match this custody filter."
              : capabilities.create
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
                {visibleTasks.map((t) => (
                  <Fragment key={t.id}>
                    <tr className="hover:bg-slate-50/60">
                      <td className="px-5 py-3">
                        <p className="font-medium text-slate-900">{t.title}</p>
                        {t.description && (
                          <p className="max-w-xs truncate text-xs text-slate-500">
                            {t.description}
                          </p>
                        )}
                        {t.attachment_path && (
                          <a
                            href={`/api/work-file?kind=task&id=${encodeURIComponent(t.id)}`}
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
                        {t.custody_category && (
                          <div className="mt-1">
                            <Badge
                              tone={
                                t.custody_category === "needs_review"
                                  ? "warning"
                                  : "danger"
                              }
                            >
                              {t.custody_category === "needs_review"
                                ? "Needs review"
                                : "Needs reassignment"}
                              {t.assignee_state
                                ? ` · ${t.assignee_state.replace("_", " ")}`
                                : ""}
                            </Badge>
                          </div>
                        )}
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
                                {t.latest_submission.file_path && (
                                  <a
                                    href={`/api/work-file?kind=submission&id=${encodeURIComponent(t.latest_submission.id)}`}
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
