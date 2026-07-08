import { cn } from "@/lib/cn";

// A white, rounded, bordered surface. Add padding where you use it.
export function Card({ className, ...props }) {
  return (
    <div
      className={cn("rounded-xl border border-slate-200 bg-white", className)}
      {...props}
    />
  );
}
