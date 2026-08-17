"use client";

import type { ComponentType, SVGProps } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  ClipboardList,
  ListChecks,
  Users,
  UserCog,
  ShieldCheck,
  Building2,
  Plug,
  LogOut,
  MessageSquareText,
  Download,
} from "lucide-react";
import { Avatar } from "@/components/ui/Avatar";
import { cn } from "@/lib/cn";
import type { NotificationItem } from "@/lib/types";
import NotificationBell from "./NotificationBell";

// Icon per nav route. usePathname() (client-only) tells us which link is active.
// Record<string, IconComponent> lets us look up by any href and fall back.
type IconComponent = ComponentType<SVGProps<SVGSVGElement>>;

const ICONS: Record<string, IconComponent> = {
  "/dashboard": LayoutDashboard,
  "/dashboard/tasks": ClipboardList,
  "/dashboard/my-tasks": ListChecks,
  "/dashboard/task-activity": MessageSquareText,
  "/dashboard/employees": Users,
  "/dashboard/export": Download,
  "/dashboard/users": UserCog,
  "/dashboard/roles": ShieldCheck,
  "/dashboard/departments": Building2,
  "/dashboard/connected-apps": Plug,
};

export type NavItem = {
  href: string;
  label: string;
};

export type SidebarProps = {
  nav: NavItem[];
  notificationUserId: string;
  initialNotifications: NotificationItem[];
  initialUnreadCount: number;
  user: {
    full_name: string;
    roleLabel: string;
  };
};

export default function Sidebar({
  nav,
  notificationUserId,
  initialNotifications,
  initialUnreadCount,
  user,
}: SidebarProps) {
  const pathname = usePathname();

  return (
    <aside className="sticky top-0 flex h-screen w-60 flex-col border-r border-slate-200 bg-white">
      <div className="flex items-center justify-between px-5 py-3.5">
        <span className="text-sm font-semibold uppercase tracking-[0.2em] text-brand-600">
          Meritly
        </span>
        <NotificationBell
          userId={notificationUserId}
          initialNotifications={initialNotifications}
          initialUnreadCount={initialUnreadCount}
        />
      </div>

      <nav className="flex-1 space-y-0.5 px-3">
        {nav.map((item) => {
          const Icon = ICONS[item.href] ?? LayoutDashboard;
          const active = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                active
                  ? "bg-brand-50 text-brand-700"
                  : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
              )}
            >
              <Icon className="h-[18px] w-[18px]" strokeWidth={2} />
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-slate-200 p-3">
        <div className="flex items-center gap-3 px-2 py-2">
          <Avatar name={user.full_name} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-slate-900">
              {user.full_name}
            </p>
            <p className="text-xs text-slate-500">{user.roleLabel}</p>
          </div>
        </div>
        <form action="/auth/signout" method="post">
          <button
            type="submit"
            className="mt-1 flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900"
          >
            <LogOut className="h-[18px] w-[18px]" strokeWidth={2} />
            Sign out
          </button>
        </form>
      </div>
    </aside>
  );
}
