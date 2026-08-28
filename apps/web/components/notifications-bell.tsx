"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { api } from "../lib/api-client";
import { useRealtimeEvent } from "../lib/realtime";

interface Notification {
  id: string;
  type: string;
  severity: "ERROR" | "WARNING";
  message: string;
  leadId: string | null;
  conversationId: string | null;
  read: boolean;
  createdAt: string;
}

function timeAgo(iso: string): string {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

/**
 * The escalation path for "autonomous recovery could not fix this on its
 * own" (Part: autonomous system) — an agent-dispatch job that exhausted its
 * retries, an email that permanently failed to send. Everyday agent activity
 * never lands here; only what genuinely needs a person's attention does.
 */
export function NotificationsBell() {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  function load() {
    api
      .getNotifications()
      .then((res) => setNotifications(res as Notification[]))
      .catch(() => undefined);
  }

  useEffect(load, []);

  useRealtimeEvent<Notification>("notification.created", (n) => {
    setNotifications((prev) => [n, ...prev].slice(0, 50));
  });

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  const unread = notifications.filter((n) => !n.read).length;

  async function markAllRead() {
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
    await api.markAllNotificationsRead().catch(() => undefined);
  }

  async function markRead(id: string) {
    setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, read: true } : n)));
    await api.markNotificationRead(id).catch(() => undefined);
  }

  async function clearAll() {
    setNotifications([]);
    await api.clearAllNotifications().catch(() => undefined);
  }

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label="Notifications"
        className="relative rounded-lg p-2 text-ink/70 transition-colors hover:bg-ink/5"
      >
        <span aria-hidden>🔔</span>
        {unread > 0 && (
          <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-bad px-1 text-[10px] font-semibold text-white">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 z-30 mt-2 w-80 rounded-xl border border-[var(--line)] bg-[var(--paper)] shadow-lg">
          <div className="flex items-center justify-between border-b border-[var(--line)] px-3 py-2">
            <span className="text-xs font-semibold uppercase tracking-wide text-ink/50">Notifications</span>
            <div className="flex items-center gap-2.5">
              {unread > 0 && (
                <button onClick={markAllRead} className="text-[11px] text-accent hover:underline">
                  Mark all read
                </button>
              )}
              {notifications.length > 0 && (
                <button onClick={clearAll} className="text-[11px] text-ink/50 hover:text-bad hover:underline">
                  Clear all
                </button>
              )}
            </div>
          </div>
          <div className="max-h-96 overflow-y-auto">
            {notifications.length === 0 && (
              <p className="px-3 py-6 text-center text-xs text-ink/40">
                Nothing here — this only fills up when automatic recovery genuinely needs a person.
              </p>
            )}
            {notifications.map((n) => (
              <div
                key={n.id}
                onClick={() => !n.read && markRead(n.id)}
                className={`cursor-pointer border-b border-[var(--line)] px-3 py-2.5 text-xs last:border-0 hover:bg-ink/5 ${
                  n.read ? "opacity-60" : ""
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <span className={n.severity === "ERROR" ? "text-bad" : "text-gold"}>
                    {n.severity === "ERROR" ? "●" : "▲"}
                  </span>
                  <span className="flex-1 text-ink/80">{n.message}</span>
                </div>
                <div className="mt-1 flex items-center justify-between text-[10px] text-ink/40">
                  <span>{timeAgo(n.createdAt)}</span>
                  {n.conversationId ? (
                    <Link href={`/social-inbox?conversationId=${n.conversationId}`} className="text-accent hover:underline">
                      View conversation
                    </Link>
                  ) : n.leadId ? (
                    <Link href={`/leads/${n.leadId}`} className="text-accent hover:underline">
                      View lead
                    </Link>
                  ) : (
                    n.type === "POSSIBLE_LEAD_EMAIL" && (
                      <Link href="/email-hub?view=leads" className="text-accent hover:underline">
                        View in Email Hub
                      </Link>
                    )
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
