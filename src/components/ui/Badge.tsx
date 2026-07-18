import type { HTMLAttributes } from "react";
import { cn } from "@/lib/cn";
import type { TaskStatus } from "@/lib/types";

const TONES = {
  neutral: "bg-slate-100 text-slate-600",
  brand: "bg-brand-50 text-brand-700",
  success: "bg-emerald-50 text-emerald-700",
  warning: "bg-amber-50 text-amber-700",
  danger: "bg-rose-50 text-rose-700",
} as const;

export type BadgeTone = keyof typeof TONES;

export type BadgeProps = HTMLAttributes<HTMLSpanElement> & {
  tone?: BadgeTone;
};

export function Badge({ tone = "neutral", className, ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium",
        TONES[tone],
        className
      )}
      {...props}
    />
  );
}

// Maps a task status to a colored badge with a friendly label.
// Record<TaskStatus, ...> means TypeScript will error if we ever add a status
// to the union and forget to give it a badge here.
const STATUS: Record<TaskStatus, [BadgeTone, string]> = {
  pending: ["neutral", "Pending"],
  in_progress: ["brand", "In progress"],
  submitted: ["warning", "Submitted"],
  completed: ["success", "Completed"],
  needs_revision: ["warning", "Needs revision"],
  overdue: ["danger", "Overdue"],
};

export function StatusBadge({ status }: { status: TaskStatus }) {
  const [tone, label] = STATUS[status] ?? ["neutral", status];
  return <Badge tone={tone}>{label}</Badge>;
}
