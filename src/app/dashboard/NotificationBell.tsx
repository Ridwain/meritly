"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Bell, CheckCheck } from "lucide-react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/cn";
import { createSupabaseBrowserClient } from "@/lib/supabaseClient";
import type { NotificationItem } from "@/lib/types";

type NotificationBellProps = {
  userId: string;
  initialNotifications: NotificationItem[];
  initialUnreadCount: number;
};

const SAFE_DESTINATIONS = new Set([
  "/dashboard/my-tasks",
  "/dashboard/tasks",
]);

function formatDhakaTime(value: string): string {
  return new Intl.DateTimeFormat("en-BD", {
    timeZone: "Asia/Dhaka",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

export default function NotificationBell({
  userId,
  initialNotifications,
  initialUnreadCount,
}: NotificationBellProps) {
  const router = useRouter();
  const containerRef = useRef<HTMLDivElement>(null);
  // One browser client is reused for queries and the Realtime subscription.
  const [supabase] = useState(() => createSupabaseBrowserClient());
  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState(initialNotifications);
  const [unreadCount, setUnreadCount] = useState(initialUnreadCount);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refreshNotifications = useCallback(async () => {
    const [listResult, countResult] = await Promise.all([
      supabase
        .from("notifications")
        .select("id, kind, title, message, href, read_at, created_at")
        .order("created_at", { ascending: false })
        .limit(10),
      supabase
        .from("notifications")
        .select("id", { count: "exact", head: true })
        .is("read_at", null),
    ]);

    if (listResult.error || countResult.error) return;

    setNotifications(
      (listResult.data ?? []) as unknown as NotificationItem[]
    );
    setUnreadCount(countResult.count ?? 0);
  }, [supabase]);

  useEffect(() => {
    function closeOnOutsideClick(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    }

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }

    document.addEventListener("mousedown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const channel = supabase.channel(`notifications:${userId}`, {
      config: { private: true },
    });

    async function subscribe() {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (cancelled || !session) return;

      // Private Realtime policies evaluate this access token.
      await supabase.realtime.setAuth(session.access_token);
      channel
        .on("broadcast", { event: "INSERT" }, () => {
          void refreshNotifications();
        })
        .subscribe((status) => {
          if (status === "SUBSCRIBED") {
            // Catches an event created between the server render and socket join.
            void refreshNotifications();
          }
        });
    }

    void subscribe();
    return () => {
      cancelled = true;
      void supabase.removeChannel(channel);
    };
  }, [refreshNotifications, supabase, userId]);

  async function markAllAsRead() {
    setBusy(true);
    setError(null);
    const readAt = new Date().toISOString();
    const { error: updateError } = await supabase
      .from("notifications")
      .update({ read_at: readAt })
      .is("read_at", null);

    if (updateError) {
      setError("Could not mark notifications as read. Please try again.");
    } else {
      // The database write already succeeded, so keep the UI accurate even if
      // the optional follow-up refetch loses network connectivity.
      setNotifications((current) =>
        current.map((item) => ({ ...item, read_at: item.read_at ?? readAt }))
      );
      setUnreadCount(0);
      await refreshNotifications();
    }
    setBusy(false);
  }

  async function openNotification(notification: NotificationItem) {
    setError(null);
    if (!SAFE_DESTINATIONS.has(notification.href)) {
      setError("This notification has an invalid destination.");
      return;
    }

    if (!notification.read_at) {
      const { error: updateError } = await supabase
        .from("notifications")
        .update({ read_at: new Date().toISOString() })
        .eq("id", notification.id);

      if (updateError) {
        setError("Could not mark this notification as read. Please try again.");
        return;
      }

      await refreshNotifications();
    }

    setOpen(false);
    router.push(notification.href);
  }

  const badge = unreadCount > 99 ? "99+" : String(unreadCount);

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        aria-label={
          unreadCount > 0
            ? `Notifications, ${unreadCount} unread`
            : "Notifications"
        }
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => {
          setOpen((current) => !current);
          setError(null);
        }}
        className="relative flex h-9 w-9 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-800 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-2"
      >
        <Bell className="h-[19px] w-[19px]" strokeWidth={2} />
        {unreadCount > 0 && (
          <span className="absolute -right-1 -top-1 min-w-5 rounded-full bg-red-500 px-1 text-center text-[10px] font-semibold leading-5 text-white">
            {badge}
          </span>
        )}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Recent notifications"
          className="absolute left-0 top-11 z-50 w-[22rem] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl"
        >
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
            <div>
              <h2 className="text-sm font-semibold text-slate-900">
                Notifications
              </h2>
              <p className="text-xs text-slate-500">Recent activity</p>
            </div>
            {unreadCount > 0 && (
              <button
                type="button"
                disabled={busy}
                onClick={() => void markAllAsRead()}
                className="flex items-center gap-1.5 text-xs font-medium text-brand-600 hover:text-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <CheckCheck className="h-4 w-4" />
                Mark all as read
              </button>
            )}
          </div>

          {error && (
            <p role="alert" className="bg-red-50 px-4 py-2 text-xs text-red-700">
              {error}
            </p>
          )}

          <div className="max-h-[26rem] overflow-y-auto">
            {notifications.length === 0 ? (
              <p className="px-4 py-10 text-center text-sm text-slate-500">
                No notifications yet.
              </p>
            ) : (
              notifications.map((notification) => (
                <button
                  key={notification.id}
                  type="button"
                  onClick={() => void openNotification(notification)}
                  className={cn(
                    "flex w-full gap-3 border-b border-slate-100 px-4 py-3 text-left transition-colors last:border-b-0 hover:bg-slate-50",
                    !notification.read_at && "bg-brand-50/60"
                  )}
                >
                  <span
                    aria-hidden="true"
                    className={cn(
                      "mt-1.5 h-2 w-2 shrink-0 rounded-full",
                      notification.read_at ? "bg-transparent" : "bg-brand-500"
                    )}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium text-slate-900">
                      {notification.title}
                    </span>
                    <span className="mt-0.5 block text-xs leading-5 text-slate-600">
                      {notification.message}
                    </span>
                    <span className="mt-1 block text-[11px] text-slate-400">
                      {formatDhakaTime(notification.created_at)} · Dhaka
                    </span>
                  </span>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
