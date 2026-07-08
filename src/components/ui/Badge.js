import { cn } from "@/lib/cn";

const TONES = {
  neutral: "bg-slate-100 text-slate-600",
  brand: "bg-brand-50 text-brand-700",
  success: "bg-emerald-50 text-emerald-700",
  warning: "bg-amber-50 text-amber-700",
  danger: "bg-rose-50 text-rose-700",
};

export function Badge({ tone = "neutral", className, ...props }) {
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
const STATUS = {
  pending: ["neutral", "Pending"],
  in_progress: ["brand", "In progress"],
  submitted: ["warning", "Submitted"],
  completed: ["success", "Completed"],
  needs_revision: ["warning", "Needs revision"],
  overdue: ["danger", "Overdue"],
};

export function StatusBadge({ status }) {
  const [tone, label] = STATUS[status] ?? ["neutral", status];
  return <Badge tone={tone}>{label}</Badge>;
}
