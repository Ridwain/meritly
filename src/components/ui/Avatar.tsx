import { cn } from "@/lib/cn";

function initials(name = ""): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return parts.slice(0, 2).map((w) => w[0]?.toUpperCase()).join("") || "?";
}

export type AvatarProps = {
  name: string;
  className?: string;
};

// Initials circle. Override size/colors via className.
export function Avatar({ name, className }: AvatarProps) {
  return (
    <div
      className={cn(
        "flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-50 text-xs font-medium text-brand-700",
        className
      )}
    >
      {initials(name)}
    </div>
  );
}
