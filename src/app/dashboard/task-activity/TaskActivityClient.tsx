"use client";

// ─────────────────────────────────────────────────────────────────────────────
// TaskActivityClient — THE single file for the Task Activity feature.
//
// What lives here:
//   1. Task list (left panel) — all tasks visible to the current user
//   2. Comment thread (right panel) — per-task back-and-forth between HR & employee
//   3. AI Review panel (HR only, "submitted" tasks) — click "Ask AI to Review",
//      Gemini drafts feedback + decision, HR edits & approves, it submits
//      the review AND posts the feedback as a comment in one click.
//
// No other files to hunt for — everything is here.
// ─────────────────────────────────────────────────────────────────────────────

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  MessageSquare,
  Sparkles,
  Send,
  Check,
  RotateCcw,
  ChevronRight,
  Bot,
  User,
  Clock,
  Loader2,
  Paperclip,
} from "lucide-react";
import { createSupabaseBrowserClient } from "@/lib/supabaseClient";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge, type BadgeTone, StatusBadge } from "@/components/ui/Badge";
import { cn } from "@/lib/cn";
import type { ActivityTask, CommentRow } from "./page";
import type { Priority } from "@/lib/types";

// ─── helpers ─────────────────────────────────────────────────────────────────

const PRIORITY_TONE: Record<Priority, BadgeTone> = {
  high: "danger",
  medium: "warning",
  low: "neutral",
};

function formatDate(ts: string) {
  return new Date(ts).toLocaleString("en-US", {
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatDeadline(ts: string) {
  return new Date(ts).toLocaleString("en-US", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

// ─── types ───────────────────────────────────────────────────────────────────

type AiDraft = {
  feedback: string;
  decision: "completed" | "needs_revision";
};

export type TaskActivityClientProps = {
  tasks: ActivityTask[];
  currentUserId: string;
  currentUserName: string;
  isHr: boolean;
  canReview: boolean;
  canWork: boolean;
};

// ─── component ───────────────────────────────────────────────────────────────

export default function TaskActivityClient({
  tasks,
  currentUserId,
  currentUserName,
  isHr,
  canReview,
  canWork,
}: TaskActivityClientProps) {
  const router = useRouter();
  const supabase = createSupabaseBrowserClient();
  const bottomRef = useRef<HTMLDivElement>(null);

  // Which task is open in the right panel
  const [selectedId, setSelectedId] = useState<string | null>(
    tasks[0]?.id ?? null
  );
  const selected = tasks.find((t) => t.id === selectedId) ?? null;

  // Comment input
  const [commentText, setCommentText] = useState("");
  const [commentBusy, setCommentBusy] = useState(false);
  const [commentError, setCommentError] = useState<string | null>(null);

  // AI review state
  const [aiLoading, setAiLoading] = useState(false);
  const [aiDraft, setAiDraft] = useState<AiDraft | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiEditedFeedback, setAiEditedFeedback] = useState("");
  const [aiEditedDecision, setAiEditedDecision] = useState<
    "completed" | "needs_revision"
  >("completed");
  const [reviewBusy, setReviewBusy] = useState(false);
  const [reviewError, setReviewError] = useState<string | null>(null);

  // Scroll comment thread to bottom when task or comments change
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [selectedId, selected?.comments.length]);

  // Reset AI panel when task changes
  useEffect(() => {
    setAiDraft(null);
    setAiError(null);
    setReviewError(null);
  }, [selectedId]);

  // ── post a comment ──────────────────────────────────────────────────────────
  async function postComment() {
    if (!selected || !commentText.trim()) return;
    setCommentBusy(true);
    setCommentError(null);

    const { error } = await supabase.from("task_comments").insert({
      task_id: selected.id,
      author_id: currentUserId,
      body: commentText.trim(),
      ai_generated: false,
    });

    if (error) {
      setCommentError(error.message);
    } else {
      setCommentText("");
      router.refresh();
    }
    setCommentBusy(false);
  }

  // ── ask Gemini to review a submission ──────────────────────────────────────
  async function askAi() {
    if (!selected?.submission_note) return;
    setAiLoading(true);
    setAiError(null);
    setAiDraft(null);

    try {
      const res = await fetch("/api/ai-review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          taskTitle: selected.title,
          taskDescription: selected.description,
          submissionNote: selected.submission_note,
          priority: selected.priority,
          deadline: selected.deadline,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Unknown error from AI");

      setAiDraft(data as AiDraft);
      setAiEditedFeedback(data.feedback);
      setAiEditedDecision(data.decision);
    } catch (err) {
      setAiError(err instanceof Error ? err.message : "AI request failed.");
    } finally {
      setAiLoading(false);
    }
  }

  // ── HR approves the AI draft → reviews the task + posts as comment ─────────
  async function approveAiReview() {
    if (!selected?.submission_id || !aiDraft) return;
    setReviewBusy(true);
    setReviewError(null);

    // 1) Submit the actual HR review (approve or return) via the existing RPC
    const { error: reviewErr } = await supabase.rpc(
      "review_submission_transaction",
      {
        p_request_id: crypto.randomUUID(),
        p_payload: {
          task_id: selected.id,
          submission_id: selected.submission_id,
          decision: aiEditedDecision,
          feedback: aiEditedFeedback.trim() || null,
        },
      }
    );

    if (reviewErr) {
      setReviewError(reviewErr.message);
      setReviewBusy(false);
      return;
    }

    // 2) Post the AI-generated feedback as a comment so the employee can see it
    //    in the thread — marked ai_generated = true for the badge.
    if (aiEditedFeedback.trim()) {
      await supabase.from("task_comments").insert({
        task_id: selected.id,
        author_id: currentUserId,
        body: `[AI-assisted review] ${aiEditedFeedback.trim()}`,
        ai_generated: true,
      });
    }

    setAiDraft(null);
    setReviewBusy(false);
    router.refresh();
  }

  // ─── render ──────────────────────────────────────────────────────────────

  return (
    <div>
      {/* Page header */}
      <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
        Task Activity
      </h1>
      <p className="mt-1 text-sm text-slate-500">
        {isHr
          ? "Comment on tasks, and let AI draft your review — you approve before anything is sent."
          : "See comments on your tasks and chat with HR."}
      </p>

      {tasks.length === 0 ? (
        <Card className="mt-8 p-10 text-center text-sm text-slate-500">
          No tasks to show yet.
        </Card>
      ) : (
        <div className="mt-6 flex gap-4" style={{ minHeight: "72vh" }}>
          {/* ── LEFT: task list ─────────────────────────────────────────────── */}
          <div className="w-72 shrink-0 space-y-1.5 overflow-y-auto">
            {tasks.map((t) => {
              const unread = t.comments.length > 0;
              const isSelected = t.id === selectedId;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setSelectedId(t.id)}
                  className={cn(
                    "w-full rounded-xl border px-4 py-3 text-left transition-all",
                    isSelected
                      ? "border-brand-300 bg-brand-50 shadow-sm"
                      : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50"
                  )}
                >
                  <div className="flex items-start justify-between gap-2">
                    <p
                      className={cn(
                        "truncate text-sm font-medium",
                        isSelected ? "text-brand-700" : "text-slate-900"
                      )}
                    >
                      {t.title}
                    </p>
                    {isSelected ? (
                      <ChevronRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand-500" />
                    ) : (
                      unread && (
                        <MessageSquare className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" />
                      )
                    )}
                  </div>

                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    <StatusBadge status={t.status} />
                    <Badge tone={PRIORITY_TONE[t.priority]}>
                      <span className="capitalize">{t.priority}</span>
                    </Badge>
                  </div>

                  {isHr && (
                    <p className="mt-1 truncate text-xs text-slate-500">
                      {t.assignee_name}
                    </p>
                  )}

                  <p className="mt-0.5 text-xs text-slate-400">
                    Due {formatDeadline(t.deadline)}
                  </p>

                  {t.comments.length > 0 && (
                    <p className="mt-1 text-xs text-slate-400">
                      {t.comments.length} comment
                      {t.comments.length !== 1 ? "s" : ""}
                    </p>
                  )}
                </button>
              );
            })}
          </div>

          {/* ── RIGHT: thread + AI review ────────────────────────────────────── */}
          {selected ? (
            <div className="flex min-w-0 flex-1 flex-col gap-4">
              {/* Task info bar */}
              <Card className="flex flex-wrap items-center gap-3 px-5 py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold text-slate-900">
                    {selected.title}
                  </p>
                  {selected.description && (
                    <p className="truncate text-xs text-slate-500">
                      {selected.description}
                    </p>
                  )}
                </div>
                <StatusBadge status={selected.status} />
                <Badge tone={PRIORITY_TONE[selected.priority]}>
                  <span className="capitalize">{selected.priority}</span>
                </Badge>
                <span className="flex items-center gap-1 text-xs text-slate-400">
                  <Clock className="h-3.5 w-3.5" />
                  {formatDeadline(selected.deadline)}
                </span>
                {isHr && (
                  <span className="text-xs text-slate-500">
                    → {selected.assignee_name}
                  </span>
                )}
              </Card>

              {/* ── AI Review panel (HR + submitted tasks only) ── */}
              {isHr && canReview && selected.status === "submitted" && (
                <Card className="p-5">
                  {/* Section header */}
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <Sparkles className="h-4 w-4 text-violet-500" />
                      <h2 className="text-sm font-semibold text-slate-900">
                        AI Review Assistant
                      </h2>
                    </div>
                    {!aiDraft && (
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={askAi}
                        disabled={aiLoading || !selected.submission_note}
                        className="border-violet-200 text-violet-700 hover:bg-violet-50"
                      >
                        {aiLoading ? (
                          <>
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            Thinking…
                          </>
                        ) : (
                          <>
                            <Sparkles className="h-3.5 w-3.5" />
                            Ask AI to Review
                          </>
                        )}
                      </Button>
                    )}
                  </div>

                  {/* Submission preview */}
                  {selected.submission_note && (
                    <div className="mt-3 rounded-lg bg-slate-50 px-3 py-2">
                      <p className="text-xs font-medium text-slate-500">
                        Employee submission
                      </p>
                      <p className="mt-1 text-sm text-slate-700">
                        {selected.submission_note}
                      </p>
                      {selected.submission_file_path && (
                        <a
                          href={`/api/work-file?kind=submission&id=${encodeURIComponent(selected.submission_id ?? "")}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-brand-600 hover:underline"
                        >
                          <Paperclip className="h-3 w-3" />
                          View attached file
                        </a>
                      )}
                    </div>
                  )}

                  {!selected.submission_note && (
                    <p className="mt-3 text-xs text-slate-400">
                      No submission yet — the employee hasn't submitted work for
                      this task.
                    </p>
                  )}

                  {/* Error */}
                  {aiError && (
                    <p className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-600">
                      {aiError}
                    </p>
                  )}

                  {/* AI draft — editable before sending */}
                  {aiDraft && (
                    <div className="mt-4 space-y-3 rounded-xl border border-violet-200 bg-violet-50 p-4">
                      <div className="flex items-center gap-2">
                        <Bot className="h-4 w-4 text-violet-600" />
                        <p className="text-xs font-semibold text-violet-700">
                          AI draft — review and edit before approving
                        </p>
                      </div>

                      {/* Decision toggle */}
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => setAiEditedDecision("completed")}
                          className={cn(
                            "flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors",
                            aiEditedDecision === "completed"
                              ? "border-emerald-300 bg-emerald-50 text-emerald-700"
                              : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                          )}
                        >
                          <Check className="h-3.5 w-3.5" />
                          Approve &amp; Complete
                        </button>
                        <button
                          type="button"
                          onClick={() => setAiEditedDecision("needs_revision")}
                          className={cn(
                            "flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors",
                            aiEditedDecision === "needs_revision"
                              ? "border-amber-300 bg-amber-50 text-amber-700"
                              : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                          )}
                        >
                          <RotateCcw className="h-3.5 w-3.5" />
                          Return for Revision
                        </button>
                      </div>

                      {/* Editable feedback */}
                      <div>
                        <label className="mb-1 block text-xs font-medium text-slate-600">
                          Feedback (edit freely)
                        </label>
                        <textarea
                          rows={3}
                          value={aiEditedFeedback}
                          onChange={(e) => setAiEditedFeedback(e.target.value)}
                          className="w-full rounded-lg border border-violet-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-violet-400 focus:outline-none focus:ring-2 focus:ring-violet-400/20"
                        />
                      </div>

                      {reviewError && (
                        <p className="text-sm text-rose-600">{reviewError}</p>
                      )}

                      {/* Action buttons */}
                      <div className="flex flex-wrap gap-2">
                        <Button
                          size="sm"
                          onClick={approveAiReview}
                          disabled={reviewBusy}
                          className="bg-violet-600 hover:bg-violet-700"
                        >
                          {reviewBusy ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Check className="h-3.5 w-3.5" />
                          )}
                          {reviewBusy
                            ? "Sending…"
                            : "Approve & Send to Employee"}
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            setAiDraft(null);
                            setAiError(null);
                          }}
                          disabled={reviewBusy}
                        >
                          Discard draft
                        </Button>
                      </div>

                      <p className="text-xs text-violet-600">
                        Clicking "Approve &amp; Send" submits the HR review{" "}
                        <strong>and</strong> posts the feedback as a comment the
                        employee can read — nothing is sent automatically.
                      </p>
                    </div>
                  )}
                </Card>
              )}

              {/* ── Comment thread ── */}
              <Card className="flex flex-1 flex-col overflow-hidden">
                <div className="border-b border-slate-200 px-5 py-3">
                  <h2 className="text-sm font-semibold text-slate-900">
                    Comments
                  </h2>
                  <p className="text-xs text-slate-400">
                    Visible to HR and the assigned employee only.
                  </p>
                </div>

                {/* Messages */}
                <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
                  {selected.comments.length === 0 ? (
                    <p className="text-center text-sm text-slate-400 py-6">
                      No comments yet. Start the conversation below.
                    </p>
                  ) : (
                    selected.comments.map((c) => (
                      <Comment
                        key={c.id}
                        comment={c}
                        isOwn={c.author_id === currentUserId}
                      />
                    ))
                  )}
                  <div ref={bottomRef} />
                </div>

                {/* Input */}
                <div className="border-t border-slate-200 px-5 py-3">
                  {commentError && (
                    <p className="mb-2 text-xs text-rose-600">{commentError}</p>
                  )}
                  <div className="flex gap-2">
                    <textarea
                      rows={2}
                      value={commentText}
                      onChange={(e) => setCommentText(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.shiftKey) {
                          e.preventDefault();
                          postComment();
                        }
                      }}
                      placeholder={
                        isHr
                          ? "Write a comment for the employee…"
                          : "Ask HR a question or leave a note…"
                      }
                      disabled={commentBusy}
                      className="min-h-[2.5rem] flex-1 resize-none rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20 disabled:opacity-50"
                    />
                    <Button
                      onClick={postComment}
                      disabled={commentBusy || !commentText.trim()}
                      className="self-end"
                    >
                      {commentBusy ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Send className="h-4 w-4" />
                      )}
                      Send
                    </Button>
                  </div>
                  <p className="mt-1 text-xs text-slate-400">
                    Enter to send · Shift+Enter for new line
                  </p>
                </div>
              </Card>
            </div>
          ) : (
            <div className="flex flex-1 items-center justify-center text-sm text-slate-400">
              Select a task to see its activity.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Comment bubble ───────────────────────────────────────────────────────────

function Comment({
  comment,
  isOwn,
}: {
  comment: CommentRow;
  isOwn: boolean;
}) {
  return (
    <div className={cn("flex gap-2.5", isOwn ? "flex-row-reverse" : "")}>
      {/* Avatar */}
      <div
        className={cn(
          "flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold",
          comment.ai_generated
            ? "bg-violet-100 text-violet-700"
            : isOwn
              ? "bg-brand-100 text-brand-700"
              : "bg-slate-100 text-slate-600"
        )}
      >
        {comment.ai_generated ? (
          <Bot className="h-3.5 w-3.5" />
        ) : (
          <User className="h-3.5 w-3.5" />
        )}
      </div>

      {/* Bubble */}
      <div className={cn("max-w-[75%]", isOwn ? "items-end" : "items-start")}>
        <div className="flex flex-wrap items-center gap-1.5 mb-1">
          <span className="text-xs font-medium text-slate-700">
            {comment.author_name}
          </span>
          {comment.ai_generated && (
            <Badge tone="brand" className="text-[10px]">
              AI assisted
            </Badge>
          )}
          <span className="text-[11px] text-slate-400">
            {formatDate(comment.created_at)}
          </span>
        </div>
        <div
          className={cn(
            "rounded-xl px-3 py-2 text-sm",
            comment.ai_generated
              ? "border border-violet-200 bg-violet-50 text-violet-900"
              : isOwn
                ? "bg-brand-600 text-white"
                : "bg-slate-100 text-slate-800"
          )}
        >
          {comment.body}
        </div>
      </div>
    </div>
  );
}
