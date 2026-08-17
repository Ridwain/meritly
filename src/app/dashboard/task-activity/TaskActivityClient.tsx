"use client";

// ═══════════════════════════════════════════════════════════════════════════════
// FILE: TaskActivityClient.tsx
// PAGE: Task Activity  (/dashboard/task-activity)
//
// WHAT THIS PAGE DOES (plain English):
//   Think of this page like a messaging app for tasks.
//   - On the LEFT you see a list of tasks (like an inbox).
//   - Click a task → the RIGHT side shows you a chat thread for that task.
//   - HR can also use an "AI Review Assistant" that reads the employee's
//     submitted work and drafts feedback automatically. HR can edit it,
//     then approve and send it — nothing goes to the employee until HR clicks
//     the final "Approve & Send" button.
//
// WHO SEES WHAT:
//   • HR / Admin  → sees ALL tasks, can filter/search, sees AI Review panel.
//   • Employee    → sees only THEIR OWN tasks, can chat with HR.
//
// FILE STRUCTURE (top → bottom):
//   1. Imports
//   2. Small helper functions (format dates, pick badge colours)
//   3. TypeScript types (what shape the data must be)
//   4. Main component: TaskActivityClient
//      a. State variables (what the page "remembers" while you use it)
//      b. Data-fetch functions (talk to the database)
//      c. The JSX layout (what you actually see on screen)
//   5. Comment bubble sub-component (the chat bubbles)
// ═══════════════════════════════════════════════════════════════════════════════

import { useState, useRef, useEffect, useMemo } from "react";
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
  Search,
  Filter,
  AlertCircle,
  CheckCircle2,
  TimerIcon,
  ListTodo,
  SlidersHorizontal,
  XCircle,
} from "lucide-react";
import { createSupabaseBrowserClient } from "@/lib/supabaseClient";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge, type BadgeTone, StatusBadge } from "@/components/ui/Badge";
import { cn } from "@/lib/cn";
import type { ActivityTask, CommentRow } from "./page";
import type { Priority, TaskStatus } from "@/lib/types";

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 1 — HELPER FUNCTIONS
// Small utility functions used throughout the file.
// ─────────────────────────────────────────────────────────────────────────────

// Maps each priority level to a visual colour badge.
// "high" → red,  "medium" → yellow,  "low" → grey
const PRIORITY_TONE: Record<Priority, BadgeTone> = {
  high: "danger",
  medium: "warning",
  low: "neutral",
};

// Converts a database timestamp (e.g. "2025-08-14T10:30:00Z")
// into a human-readable string like "Aug 14, 10:30 AM"
function formatDate(ts: string) {
  return new Date(ts).toLocaleString("en-US", {
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  });
}

// Formats a deadline timestamp into just the date, e.g. "Aug 14, 2026"
function formatDeadline(ts: string) {
  return new Date(ts).toLocaleString("en-US", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

// Returns true if a task's deadline has already passed and it's not done yet.
// Used to show a red "overdue" warning on the task card.
function isOverdue(deadline: string, status: TaskStatus): boolean {
  if (status === "completed") return false;
  return new Date(deadline) < new Date();
}

// Returns a short, friendly label for each task status.
// Used in the stats bar at the top of the page.
const STATUS_LABEL: Record<string, string> = {
  pending: "Pending",
  in_progress: "In Progress",
  submitted: "Submitted",
  completed: "Completed",
  needs_revision: "Needs Revision",
  overdue: "Overdue",
};

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 2 — TYPESCRIPT TYPES
// These describe the exact shape of the data this component expects.
// TypeScript uses these to catch mistakes at compile time (before the app runs).
// ─────────────────────────────────────────────────────────────────────────────

// The AI review draft returned by our Gemini API route (/api/ai-review).
type AiDraft = {
  feedback: string;                          // What the AI wants to say
  decision: "completed" | "needs_revision"; // AI's suggested outcome
};

// All the props (inputs) this component needs from its parent (page.tsx).
export type TaskActivityClientProps = {
  tasks: ActivityTask[];     // The list of tasks to display
  currentUserId: string;     // The logged-in user's database ID
  currentUserName: string;   // The logged-in user's display name
  isHr: boolean;             // Is this person HR or admin?
  canReview: boolean;        // Does this person have "submission.review" permission?
  canWork: boolean;          // Does this person have "submission.create" permission?
};

// The possible values for the status filter dropdown.
type StatusFilter = "all" | TaskStatus;

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 3 — MAIN COMPONENT
// This is the React component that renders the entire Task Activity page.
// ─────────────────────────────────────────────────────────────────────────────

export default function TaskActivityClient({
  tasks,
  currentUserId,
  currentUserName,
  isHr,
  canReview,
  canWork,
}: TaskActivityClientProps) {
  // useRouter lets us refresh the page data after a database write,
  // so the user sees the latest comments without a full page reload.
  const router = useRouter();

  // Supabase browser client — used to read/write the database from the browser.
  const supabase = createSupabaseBrowserClient();

  // A ref attached to the bottom of the comment list so we can auto-scroll
  // to the newest message when the chat updates.
  const bottomRef = useRef<HTMLDivElement>(null);

  // ── STATE VARIABLES ─────────────────────────────────────────────────────────
  // State = things the page "remembers" while you interact with it.
  // When state changes, React re-renders the affected part of the page.

  // Which task is currently selected (open) in the right panel.
  // Defaults to the first task in the list on first load.
  const [selectedId, setSelectedId] = useState<string | null>(
    tasks[0]?.id ?? null
  );

  // The text the user is typing in the comment box.
  const [commentText, setCommentText] = useState("");

  // true while the comment is being saved to the database (disables the button).
  const [commentBusy, setCommentBusy] = useState(false);

  // Any error message from the comment save operation.
  const [commentError, setCommentError] = useState<string | null>(null);

  // Search query typed in the search box (for filtering the task list).
  const [searchQuery, setSearchQuery] = useState("");

  // The status filter value selected from the filter dropdown.
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");

  // ── AI REVIEW STATE ─────────────────────────────────────────────────────────
  // These state variables control the AI Review Assistant panel.

  // true while we are waiting for the Gemini API to respond.
  const [aiLoading, setAiLoading] = useState(false);

  // The AI's draft feedback/decision once it responds.
  const [aiDraft, setAiDraft] = useState<AiDraft | null>(null);

  // Any error from the AI API call.
  const [aiError, setAiError] = useState<string | null>(null);

  // The feedback text HR can edit before approving.
  const [aiEditedFeedback, setAiEditedFeedback] = useState("");

  // The decision HR chooses: "completed" (approved) or "needs_revision" (returned).
  const [aiEditedDecision, setAiEditedDecision] = useState<
    "completed" | "needs_revision"
  >("completed");

  // true while the final review is being saved.
  const [reviewBusy, setReviewBusy] = useState(false);

  // Any error from saving the review.
  const [reviewError, setReviewError] = useState<string | null>(null);

  // ── DERIVED DATA ─────────────────────────────────────────────────────────────
  // These are computed from existing state — not stored separately.

  // The full ActivityTask object for the currently selected task ID.
  const selected = tasks.find((t) => t.id === selectedId) ?? null;

  // Filtered + searched task list shown in the left panel.
  // useMemo means this only recalculates when tasks/searchQuery/statusFilter change.
  const visibleTasks = useMemo(() => {
    return tasks.filter((t) => {
      // Step 1: apply status filter
      const statusMatch =
        statusFilter === "all" || t.status === statusFilter;

      // Step 2: apply search query (case-insensitive match on title or assignee name)
      const query = searchQuery.toLowerCase();
      const searchMatch =
        query === "" ||
        t.title.toLowerCase().includes(query) ||
        t.assignee_name.toLowerCase().includes(query);

      return statusMatch && searchMatch;
    });
  }, [tasks, searchQuery, statusFilter]);

  // Summary counts for the stats bar (e.g. "3 Pending, 2 In Progress").
  const stats = useMemo(() => {
    const total = tasks.length;
    const completed = tasks.filter((t) => t.status === "completed").length;
    const submitted = tasks.filter((t) => t.status === "submitted").length;
    const overdue = tasks.filter((t) =>
      isOverdue(t.deadline, t.status)
    ).length;
    const pending = tasks.filter((t) => t.status === "pending").length;
    return { total, completed, submitted, overdue, pending };
  }, [tasks]);

  // ── SIDE EFFECTS ────────────────────────────────────────────────────────────
  // useEffect runs code in response to state/prop changes.

  // Auto-scroll to the bottom of the comment thread whenever:
  // - The user selects a different task, OR
  // - A new comment is added to the current task.
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [selectedId, selected?.comments.length]);

  // Clear the AI panel whenever the user switches to a different task.
  useEffect(() => {
    setAiDraft(null);
    setAiError(null);
    setReviewError(null);
  }, [selectedId]);

  // ── DATABASE FUNCTIONS ──────────────────────────────────────────────────────

  // Saves a new comment to the database for the currently selected task.
  async function postComment() {
    if (!selected || !commentText.trim()) return;

    setCommentBusy(true);
    setCommentError(null);

    const { error } = await supabase.from("task_comments").insert({
      task_id: selected.id,
      author_id: currentUserId,
      body: commentText.trim(),
      ai_generated: false, // this is a human comment, not AI
    });

    if (error) {
      // Show the error message under the comment box
      setCommentError(error.message);
    } else {
      // Clear the input and refresh the page data
      setCommentText("");
      router.refresh();
    }

    setCommentBusy(false);
  }

  // Calls our backend API route which talks to Google Gemini.
  // Gemini reads the task + employee submission and drafts feedback.
  async function askAi() {
    if (!selected?.submission_note) return;

    setAiLoading(true);
    setAiError(null);
    setAiDraft(null);

    try {
      // POST to our Next.js API route at /api/ai-review
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

      // Store the draft so HR can edit it before approving
      setAiDraft(data as AiDraft);
      setAiEditedFeedback(data.feedback);
      setAiEditedDecision(data.decision);
    } catch (err) {
      setAiError(err instanceof Error ? err.message : "AI request failed.");
    } finally {
      setAiLoading(false);
    }
  }

  // HR has reviewed the AI draft and clicks "Approve & Send".
  // This does TWO things in sequence:
  //   1) Saves the official HR review (changes task status to completed/needs_revision)
  //   2) Posts the feedback as a comment so the employee can read it
  async function approveAiReview() {
    if (!selected?.submission_id || !aiDraft) return;

    setReviewBusy(true);
    setReviewError(null);

    // Step 1: Call the database RPC (stored procedure) that handles
    // the review transaction. It updates the submission AND the task status
    // atomically — if one fails, both are rolled back.
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

    // Step 2: Post the (possibly edited) AI feedback as a visible comment.
    // ai_generated = true adds the "AI assisted" badge to the bubble.
    if (aiEditedFeedback.trim()) {
      await supabase.from("task_comments").insert({
        task_id: selected.id,
        author_id: currentUserId,
        body: `[AI-assisted review] ${aiEditedFeedback.trim()}`,
        ai_generated: true,
      });
    }

    // Clear the draft and refresh
    setAiDraft(null);
    setReviewBusy(false);
    router.refresh();
  }

  // ─────────────────────────────────────────────────────────────────────────
  // RENDER — What the user actually sees on screen.
  // JSX looks like HTML but it's actually JavaScript under the hood.
  // ─────────────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">

      {/* ── PAGE HEADER ──────────────────────────────────────────────────────
          The title + subtitle at the very top of the page.
      ─────────────────────────────────────────────────────────────────────── */}
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
          Task Activity
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          {isHr
            ? "Monitor all task progress, review submissions with AI assistance, and communicate with employees."
            : "Track your assigned tasks and communicate directly with HR."}
        </p>
      </div>

      {/* ── STATS BAR ────────────────────────────────────────────────────────
          A row of quick-glance numbers at the top.
          Each card shows a count, e.g. "3 Pending tasks".
          Only shown if there are tasks to display.
      ─────────────────────────────────────────────────────────────────────── */}
      {tasks.length > 0 && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">

          {/* Total tasks */}
          <StatCard
            icon={<ListTodo className="h-4 w-4 text-slate-500" />}
            label="Total Tasks"
            value={stats.total}
            bg="bg-slate-50"
          />

          {/* Pending tasks (not started yet) */}
          <StatCard
            icon={<TimerIcon className="h-4 w-4 text-amber-500" />}
            label="Pending"
            value={stats.pending}
            bg="bg-amber-50"
            highlight={stats.pending > 0}
          />

          {/* Submitted tasks (waiting for HR review) */}
          <StatCard
            icon={<CheckCircle2 className="h-4 w-4 text-blue-500" />}
            label="Awaiting Review"
            value={stats.submitted}
            bg="bg-blue-50"
            highlight={stats.submitted > 0}
          />

          {/* Overdue tasks (deadline passed, not completed) */}
          <StatCard
            icon={<AlertCircle className="h-4 w-4 text-rose-500" />}
            label="Overdue"
            value={stats.overdue}
            bg="bg-rose-50"
            highlight={stats.overdue > 0}
          />
        </div>
      )}

      {/* ── EMPTY STATE ──────────────────────────────────────────────────────
          Shown when there are no tasks at all.
      ─────────────────────────────────────────────────────────────────────── */}
      {tasks.length === 0 ? (
        <Card className="p-14 text-center">
          <ListTodo className="mx-auto h-10 w-10 text-slate-300" />
          <p className="mt-3 text-base font-medium text-slate-500">
            No tasks yet
          </p>
          <p className="mt-1 text-sm text-slate-400">
            {isHr
              ? "Create tasks from the Tasks page and they will appear here."
              : "Your assigned tasks will appear here once HR assigns them."}
          </p>
        </Card>
      ) : (
        // ── MAIN TWO-PANEL LAYOUT ───────────────────────────────────────────
        // Left panel  = scrollable task list (like an inbox)
        // Right panel = selected task's comment thread + AI review
        <div className="flex gap-4" style={{ minHeight: "74vh" }}>

          {/* ── LEFT PANEL: TASK LIST ──────────────────────────────────────
              Contains:
               - Search box
               - Status filter dropdown
               - List of task cards (click to open in right panel)
          ──────────────────────────────────────────────────────────────── */}
          <div className="flex w-72 shrink-0 flex-col gap-2">

            {/* Search box — filters tasks by title or assignee name */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search tasks…"
                className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-8 pr-3 text-sm text-slate-900 placeholder-slate-400 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-400/20"
              />
              {/* Small "X" button to clear the search */}
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery("")}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                >
                  <XCircle className="h-3.5 w-3.5" />
                </button>
              )}
            </div>

            {/* Status filter — a <select> dropdown to filter by task status */}
            <div className="relative">
              <SlidersHorizontal className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
                className="w-full appearance-none rounded-lg border border-slate-200 bg-white py-2 pl-8 pr-3 text-sm text-slate-700 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-400/20"
              >
                <option value="all">All Statuses</option>
                <option value="pending">Pending</option>
                <option value="in_progress">In Progress</option>
                <option value="submitted">Submitted</option>
                <option value="needs_revision">Needs Revision</option>
                <option value="completed">Completed</option>
                <option value="overdue">Overdue</option>
              </select>
            </div>

            {/* Task count label */}
            <p className="px-1 text-xs text-slate-400">
              {visibleTasks.length} of {tasks.length} task
              {tasks.length !== 1 ? "s" : ""}
            </p>

            {/* Scrollable list of task cards */}
            <div className="flex-1 space-y-1.5 overflow-y-auto pb-2">
              {visibleTasks.length === 0 ? (
                // Shown when the search/filter combination matches nothing
                <div className="rounded-xl border border-dashed border-slate-200 px-4 py-6 text-center text-sm text-slate-400">
                  No tasks match your filter.
                </div>
              ) : (
                visibleTasks.map((t) => {
                  const isSelected = t.id === selectedId;
                  const overdue = isOverdue(t.deadline, t.status);

                  return (
                    // Each task is a button so it's keyboard-accessible.
                    // Clicking it sets selectedId, which opens the right panel.
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => setSelectedId(t.id)}
                      className={cn(
                        "w-full rounded-xl border px-4 py-3 text-left transition-all",
                        isSelected
                          ? "border-brand-300 bg-brand-50 shadow-sm"
                          : overdue
                            ? "border-rose-200 bg-rose-50 hover:border-rose-300"
                            : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50"
                      )}
                    >
                      {/* Task title + chevron (or message icon) */}
                      <div className="flex items-start justify-between gap-2">
                        <p
                          className={cn(
                            "truncate text-sm font-medium",
                            isSelected
                              ? "text-brand-700"
                              : overdue
                                ? "text-rose-700"
                                : "text-slate-900"
                          )}
                        >
                          {t.title}
                        </p>
                        {isSelected ? (
                          <ChevronRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand-500" />
                        ) : t.comments.length > 0 ? (
                          // Show a message icon if there are comments
                          <MessageSquare className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" />
                        ) : null}
                      </div>

                      {/* Status and priority badges */}
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        <StatusBadge status={t.status} />
                        <Badge tone={PRIORITY_TONE[t.priority]}>
                          <span className="capitalize">{t.priority}</span>
                        </Badge>
                        {/* Extra "Overdue" badge if deadline passed */}
                        {overdue && (
                          <Badge tone="danger">Overdue</Badge>
                        )}
                      </div>

                      {/* Assignee name (HR view only) */}
                      {isHr && (
                        <p className="mt-1 truncate text-xs text-slate-500">
                          👤 {t.assignee_name}
                        </p>
                      )}

                      {/* Deadline */}
                      <p
                        className={cn(
                          "mt-0.5 text-xs",
                          overdue ? "font-medium text-rose-500" : "text-slate-400"
                        )}
                      >
                        Due {formatDeadline(t.deadline)}
                      </p>

                      {/* Comment count */}
                      {t.comments.length > 0 && (
                        <p className="mt-1 text-xs text-slate-400">
                          💬 {t.comments.length} comment
                          {t.comments.length !== 1 ? "s" : ""}
                        </p>
                      )}
                    </button>
                  );
                })
              )}
            </div>
          </div>

          {/* ── RIGHT PANEL ────────────────────────────────────────────────
              Shows details + comments for the currently selected task.
              If no task is selected, shows a placeholder.
          ──────────────────────────────────────────────────────────────── */}
          {selected ? (
            <div className="flex min-w-0 flex-1 flex-col gap-4">

              {/* ── TASK INFO BAR ────────────────────────────────────────────
                  A compact bar at the top of the right panel showing the
                  task's title, status, priority, deadline, and assignee.
              ─────────────────────────────────────────────────────────────── */}
              <Card className="px-5 py-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  {/* Title & description */}
                  <div className="min-w-0 flex-1">
                    <h2 className="text-base font-semibold text-slate-900">
                      {selected.title}
                    </h2>
                    {selected.description && (
                      <p className="mt-0.5 text-sm text-slate-500">
                        {selected.description}
                      </p>
                    )}
                  </div>

                  {/* Badges */}
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusBadge status={selected.status} />
                    <Badge tone={PRIORITY_TONE[selected.priority]}>
                      <span className="capitalize">{selected.priority} priority</span>
                    </Badge>
                  </div>
                </div>

                {/* Deadline + assignee meta */}
                <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-slate-500">
                  <span className="flex items-center gap-1">
                    <Clock className="h-3.5 w-3.5" />
                    Due {formatDeadline(selected.deadline)}
                    {isOverdue(selected.deadline, selected.status) && (
                      <span className="ml-1 font-semibold text-rose-500">
                        — Overdue!
                      </span>
                    )}
                  </span>

                  {isHr && (
                    <span className="flex items-center gap-1">
                      <User className="h-3.5 w-3.5" />
                      Assigned to {selected.assignee_name}
                    </span>
                  )}
                </div>
              </Card>

              {/* ── AI REVIEW ASSISTANT ───────────────────────────────────────
                  Only shown when:
                    • The viewer is HR
                    • HR has "submission.review" permission
                    • The selected task's status is "submitted"
                      (meaning the employee has submitted their work)
                  
                  Flow:
                    1. HR clicks "Ask AI to Review"
                    2. We send the task + submission note to Gemini
                    3. Gemini returns a draft decision + feedback
                    4. HR edits if needed, then clicks "Approve & Send"
                    5. The task status updates AND feedback appears as a comment
              ─────────────────────────────────────────────────────────────── */}
              {isHr && canReview && selected.status === "submitted" && (
                <Card className="p-5">
                  {/* Panel header */}
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <div className="flex h-7 w-7 items-center justify-center rounded-full bg-violet-100">
                        <Sparkles className="h-4 w-4 text-violet-600" />
                      </div>
                      <div>
                        <h3 className="text-sm font-semibold text-slate-900">
                          AI Review Assistant
                        </h3>
                        <p className="text-xs text-slate-400">
                          Powered by Google Gemini — you review before anything is sent
                        </p>
                      </div>
                    </div>

                    {/* "Ask AI to Review" button — hidden once a draft exists */}
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
                            Analysing…
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

                  {/* Employee's submission note (what they said when they submitted) */}
                  {selected.submission_note ? (
                    <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
                      <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">
                        Employee Submission
                      </p>
                      <p className="text-sm text-slate-700">
                        {selected.submission_note}
                      </p>
                      {/* Link to download the attached file, if any */}
                      {selected.submission_file_path && (
                        <a
                          href={`/api/work-file?kind=submission&id=${encodeURIComponent(
                            selected.submission_id ?? ""
                          )}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-brand-600 hover:underline"
                        >
                          <Paperclip className="h-3 w-3" />
                          View attached file
                        </a>
                      )}
                    </div>
                  ) : (
                    // No submission yet
                    <p className="mt-3 text-sm text-slate-400">
                      No submission yet — the employee hasn't submitted work.
                    </p>
                  )}

                  {/* Error from AI API */}
                  {aiError && (
                    <div className="mt-3 flex items-start gap-2 rounded-lg bg-rose-50 px-3 py-2">
                      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-500" />
                      <p className="text-sm text-rose-700">{aiError}</p>
                    </div>
                  )}

                  {/* ── AI DRAFT ─────────────────────────────────────────────
                      Shown after Gemini responds.
                      HR can:
                        - Toggle the decision (Approve / Return for Revision)
                        - Edit the feedback text freely
                        - Click "Approve & Send" to finalise
                        - Click "Discard" to throw the draft away
                  ──────────────────────────────────────────────────────────── */}
                  {aiDraft && (
                    <div className="mt-4 space-y-4 rounded-xl border border-violet-200 bg-violet-50 p-4">
                      {/* Draft header */}
                      <div className="flex items-center gap-2">
                        <Bot className="h-4 w-4 text-violet-600" />
                        <p className="text-xs font-semibold text-violet-700">
                          AI Draft — review carefully, then edit or approve below
                        </p>
                      </div>

                      {/* Decision toggle — two buttons, one active at a time */}
                      <div>
                        <p className="mb-2 text-xs font-medium text-slate-600">
                          Your Decision
                        </p>
                        <div className="flex flex-wrap gap-2">
                          {/* "Approve & Complete" option */}
                          <button
                            type="button"
                            onClick={() => setAiEditedDecision("completed")}
                            className={cn(
                              "flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-medium transition-all",
                              aiEditedDecision === "completed"
                                ? "border-emerald-300 bg-emerald-50 text-emerald-700 shadow-sm"
                                : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                            )}
                          >
                            <Check className="h-3.5 w-3.5" />
                            Approve &amp; Mark Complete
                          </button>

                          {/* "Return for Revision" option */}
                          <button
                            type="button"
                            onClick={() => setAiEditedDecision("needs_revision")}
                            className={cn(
                              "flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-medium transition-all",
                              aiEditedDecision === "needs_revision"
                                ? "border-amber-300 bg-amber-50 text-amber-700 shadow-sm"
                                : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                            )}
                          >
                            <RotateCcw className="h-3.5 w-3.5" />
                            Return for Revision
                          </button>
                        </div>
                      </div>

                      {/* Editable feedback textarea */}
                      <div>
                        <label className="mb-1.5 block text-xs font-medium text-slate-600">
                          Feedback to employee{" "}
                          <span className="font-normal text-slate-400">
                            (edit freely — this is the AI's suggestion)
                          </span>
                        </label>
                        <textarea
                          rows={4}
                          value={aiEditedFeedback}
                          onChange={(e) => setAiEditedFeedback(e.target.value)}
                          className="w-full rounded-lg border border-violet-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-violet-400 focus:outline-none focus:ring-2 focus:ring-violet-400/20"
                        />
                      </div>

                      {/* Review save error */}
                      {reviewError && (
                        <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-600">
                          {reviewError}
                        </p>
                      )}

                      {/* Action buttons */}
                      <div className="flex flex-wrap items-center gap-2">
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
                          {reviewBusy ? "Saving…" : "Approve & Send to Employee"}
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

                      {/* Small notice reminding HR that nothing is sent automatically */}
                      <p className="flex items-start gap-1.5 text-xs text-violet-600">
                        <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                        Nothing is sent automatically. Clicking "Approve &amp; Send"
                        updates the task status <strong>and</strong> posts the
                        feedback as a comment the employee can read.
                      </p>
                    </div>
                  )}
                </Card>
              )}

              {/* ── COMMENT THREAD ────────────────────────────────────────────
                  A real-time-style chat thread between HR and the employee.
                  - Messages scroll from top (oldest) to bottom (newest).
                  - The logged-in user's messages appear on the RIGHT in brand colour.
                  - The other person's messages appear on the LEFT in grey.
                  - AI-generated messages appear with a purple tint + "AI assisted" badge.
              ─────────────────────────────────────────────────────────────── */}
              <Card className="flex flex-1 flex-col overflow-hidden">
                {/* Thread header */}
                <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
                  <div>
                    <h3 className="text-sm font-semibold text-slate-900">
                      Comments
                    </h3>
                    <p className="text-xs text-slate-400">
                      Only visible to HR and the assigned employee
                    </p>
                  </div>
                  {selected.comments.length > 0 && (
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
                      {selected.comments.length}
                    </span>
                  )}
                </div>

                {/* Message list */}
                <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
                  {selected.comments.length === 0 ? (
                    // Empty state for the comment thread
                    <div className="flex flex-col items-center justify-center py-10 text-center">
                      <MessageSquare className="h-8 w-8 text-slate-200" />
                      <p className="mt-2 text-sm font-medium text-slate-400">
                        No comments yet
                      </p>
                      <p className="text-xs text-slate-400">
                        {isHr
                          ? "Leave a comment to guide the employee."
                          : "Ask HR a question or leave a note below."}
                      </p>
                    </div>
                  ) : (
                    selected.comments.map((c) => (
                      <CommentBubble
                        key={c.id}
                        comment={c}
                        isOwn={c.author_id === currentUserId}
                      />
                    ))
                  )}
                  {/* Invisible anchor div — scrolled into view on new messages */}
                  <div ref={bottomRef} />
                </div>

                {/* Comment input area */}
                <div className="border-t border-slate-200 px-5 py-3">
                  {commentError && (
                    <p className="mb-2 text-xs text-rose-600">{commentError}</p>
                  )}

                  <div className="flex gap-2">
                    <textarea
                      rows={2}
                      value={commentText}
                      onChange={(e) => setCommentText(e.target.value)}
                      // Pressing Enter (without Shift) sends the comment.
                      // Shift+Enter adds a new line instead.
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
                      className="min-h-[2.5rem] flex-1 resize-none rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20 disabled:opacity-50"
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
                    Press Enter to send · Shift+Enter for new line
                  </p>
                </div>
              </Card>
            </div>

          ) : (
            // ── NO TASK SELECTED ─────────────────────────────────────────────
            // Shown on the right when no task is selected (edge case: after
            // a filter clears the currently selected task from the list).
            <div className="flex flex-1 flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-slate-200 bg-white text-center">
              <ChevronRight className="h-8 w-8 text-slate-200" />
              <p className="text-sm font-medium text-slate-400">
                Select a task to see its activity
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 4 — SUB-COMPONENTS
// Small, reusable UI pieces extracted to keep the main component clean.
// ─────────────────────────────────────────────────────────────────────────────

// ── StatCard ──────────────────────────────────────────────────────────────────
// One tile in the stats bar at the top of the page.
// Shows an icon, a label, and a number.
function StatCard({
  icon,
  label,
  value,
  bg,
  highlight = false,
}: {
  icon: React.ReactNode;  // The lucide icon to show
  label: string;          // The text label below the number
  value: number;          // The count to display
  bg: string;             // Tailwind background colour class
  highlight?: boolean;    // Whether to bold/colour the number when > 0
}) {
  return (
    <div className={cn("rounded-xl border border-slate-200 px-4 py-3", bg)}>
      <div className="flex items-center justify-between">
        {icon}
        <span
          className={cn(
            "text-2xl font-bold",
            highlight && value > 0 ? "text-slate-800" : "text-slate-500"
          )}
        >
          {value}
        </span>
      </div>
      <p className="mt-1 text-xs font-medium text-slate-500">{label}</p>
    </div>
  );
}

// ── CommentBubble ─────────────────────────────────────────────────────────────
// A single chat message bubble in the comment thread.
// Mirrors a standard chat app: your messages on the right, theirs on the left.
function CommentBubble({
  comment,
  isOwn,
}: {
  comment: CommentRow;
  isOwn: boolean;  // true = this message was written by the current user
}) {
  return (
    // isOwn → flex-row-reverse so the bubble sits on the right side
    <div className={cn("flex gap-2.5", isOwn ? "flex-row-reverse" : "")}>

      {/* Avatar circle — purple for AI, brand for self, grey for others */}
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

      {/* Bubble content */}
      <div className={cn("max-w-[75%]", isOwn ? "items-end" : "items-start")}>
        {/* Author name + "AI assisted" badge + timestamp */}
        <div
          className={cn(
            "mb-1 flex flex-wrap items-center gap-1.5",
            isOwn ? "flex-row-reverse" : ""
          )}
        >
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

        {/* The message bubble itself */}
        <div
          className={cn(
            "rounded-xl px-3 py-2 text-sm leading-relaxed",
            comment.ai_generated
              ? "border border-violet-200 bg-violet-50 text-violet-900"  // AI: purple
              : isOwn
                ? "bg-brand-600 text-white"                               // Own: brand blue
                : "bg-slate-100 text-slate-800"                          // Other: grey
          )}
        >
          {comment.body}
        </div>
      </div>
    </div>
  );
}
