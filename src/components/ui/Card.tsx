import type { HTMLAttributes } from "react";
import { cn } from "@/lib/cn";

// A white, rounded, bordered surface. Add padding where you use it.
export type CardProps = HTMLAttributes<HTMLDivElement>;

export function Card({ className, ...props }: CardProps) {
  return (
    <div
      className={cn("rounded-xl border border-slate-200 bg-white", className)}
      {...props}
    />
  );
}
