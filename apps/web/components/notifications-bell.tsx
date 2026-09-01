"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api-client";
import { useRealtimeEvent } from "../lib/realtime";
import { playNotificationTone, unlockNotificationAudio, SoundTone } from "../lib/notification-sounds";

interface NotificationItem {
  id: string;
  category: string;
  type: string;
  title: string;
  severity: "ERROR" | "WARNING";
  message: string;
  actionUrl: string | null;
  read: boolean;
  createdAt: string;
}

interface Preferences {
  inAppEnabled: boolean;
  desktopEnabled: boolean;
  soundEnabled: boolean;
  soundTone: SoundTone;
  emailEnabled: boolean;
  leadsEnabled: boolean;
  agentsEnabled: boolean;
  automationsEnabled: boolean;
  socialEnabled: boolean;
  systemEnabled: boolean;
}

const NOTIFICATIONS_QUERY_KEY = ["notifications", "list"] as const;
const UNREAD_COUNT_QUERY_KEY = ["notifications", "unread-count"] as const;
const PREFERENCES_QUERY_KEY = ["notifications", "preferences"] as const;

/** Every real category a notification can carry — see NotificationCategory
 *  in schema.prisma. ERRORS/SECURITY/OTHER fold into "All" rather than
 *  getting their own tab: ERRORS always rides along with the module that
 *  raised it, SECURITY only ever appears for the primary admin, and OTHER
 *  is a rare catch-all — three more tabs for a handful of notifications
 *  each would just be clutter. */
const CATEGORY_TABS: { key: string; label: string }[] = [
  { key: "", label: "All" },
  { key: "EMAIL", label: "Email" },
  { key: "LEADS", label: "Leads" },
  { key: "AGENTS", label: "Agents" },
  { key: "AUTOMATIONS", label: "Automations" },
  { key: "SOCIAL", label: "Social" },
  { key: "SYSTEM", label: "System" },
];

const PREFERENCE_KEY_BY_CATEGORY: Partial<Record<string, keyof Preferences>> = {
  EMAIL: "emailEnabled",
  LEADS: "leadsEnabled",
  AGENTS: "agentsEnabled",
  AUTOMATIONS: "automationsEnabled",
  SOCIAL: "socialEnabled",
  SYSTEM: "systemEnabled",
};

function timeAgo(iso: string): string {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

/**
 * Notification Center (Part: Notification Center, 2026-08-31; converted to
 * React Query Part: performance audit, 2026-09-02). Previously this fetched
 * fresh from the server on every single tab click (`useEffect(() =>
 * loadList(category), [category])`) with no caching at all — an outlier in
 * an app that uses TanStack Query everywhere else. Now: one query fetches
 * every notification this user is eligible for (already filtered
 * server-side, same as before — nothing client-visible here was ever
 * unauthorized), and every category tab is just a client-side filter over
 * that same cached array — switching tabs never touches the network.
 * Realtime events patch the query cache directly (`setQueryData`) instead
 * of triggering a refetch, so one new notification never re-fetches the
 * other 49.
 */
export function NotificationsBell() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  const notificationsQuery = useQuery({
    queryKey: NOTIFICATIONS_QUERY_KEY,
    queryFn: () => api.getNotifications({}) as Promise<{ items: NotificationItem[] }>,
  });
  const unreadQuery = useQuery({
    queryKey: UNREAD_COUNT_QUERY_KEY,
    queryFn: () => api.getUnreadNotificationCount() as Promise<{ total: number }>,
  });
  const preferencesQuery = useQuery({
    queryKey: PREFERENCES_QUERY_KEY,
    queryFn: () => api.getNotificationPreferences() as Promise<Preferences>,
  });

  const allItems = notificationsQuery.data?.items ?? [];
  const items = category === "" ? allItems : allItems.filter((n) => n.category === category);
  const unreadTotal = unreadQuery.data?.total ?? 0;
  const preferences = preferencesQuery.data ?? null;

  // Browsers block Web Audio playback until a user gesture happens anywhere
  // on the page — this just unlocks it the first time one does, so a sound
  // is ready to play the moment a real notification arrives rather than
  // silently failing on the very first one.
  useEffect(() => {
    const unlock = () => {
      unlockNotificationAudio();
      document.removeEventListener("pointerdown", unlock);
    };
    document.addEventListener("pointerdown", unlock);
    return () => document.removeEventListener("pointerdown", unlock);
  }, []);

  useRealtimeEvent<NotificationItem>("notification.created", (n) => {
    queryClient.setQueryData(NOTIFICATIONS_QUERY_KEY, (old?: { items: NotificationItem[] }) =>
      old ? { ...old, items: [n, ...old.items].slice(0, 50) } : old,
    );
    queryClient.setQueryData(UNREAD_COUNT_QUERY_KEY, (old?: { total: number }) =>
      old ? { ...old, total: old.total + 1 } : old,
    );

    const prefKey = PREFERENCE_KEY_BY_CATEGORY[n.category];
    const categoryAllowed = !prefKey || preferences?.[prefKey] !== false;
    if (!categoryAllowed || preferences?.inAppEnabled === false) return;

    if (preferences?.soundEnabled !== false) {
      playNotificationTone(preferences?.soundTone ?? "DEFAULT");
    }

    // Desktop notifications only fire off this exact real event — never
    // fabricated, never on send/queue/deliver, matching the same principle
    // applied to email-open tracking. Requires explicit opt-in
    // (desktopEnabled, off by default) AND the browser's own permission AND
    // the tab being out of focus — no point interrupting someone already
    // looking at the page.
    if (
      preferences?.desktopEnabled &&
      typeof window !== "undefined" &&
      "Notification" in window &&
      window.Notification.permission === "granted" &&
      document.hidden
    ) {
      const desktop = new window.Notification(n.title || "EurosHub", { body: n.message, tag: n.id });
      desktop.onclick = () => {
        window.focus();
        if (n.actionUrl) router.push(n.actionUrl);
        desktop.close();
      };
    }
  });

  // Keeps a second open tab in sync the instant this user reads/dismisses
  // something in the first one — no page in this app should need a manual
  // refresh to reflect the user's own action elsewhere. Unread count is
  // invalidated (background refetch) rather than patched locally here,
  // since a cross-tab "mark all read" doesn't carry enough info in this
  // payload to compute the new count without just asking the server.
  useRealtimeEvent<{ ids: string[]; readAt?: string; dismissedAt?: string }>("notification.userStateChanged", (payload) => {
    queryClient.setQueryData(NOTIFICATIONS_QUERY_KEY, (old?: { items: NotificationItem[] }) => {
      if (!old) return old;
      if (payload.dismissedAt) {
        return { ...old, items: old.items.filter((n) => !payload.ids.includes(n.id)) };
      }
      if (payload.readAt) {
        return { ...old, items: old.items.map((n) => (payload.ids.includes(n.id) ? { ...n, read: true } : n)) };
      }
      return old;
    });
    queryClient.invalidateQueries({ queryKey: UNREAD_COUNT_QUERY_KEY });
  });

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  const markReadMutation = useMutation({
    mutationFn: (id: string) => api.markNotificationRead(id),
  });

  function openNotification(n: NotificationItem) {
    if (!n.read) {
      // Optimistic (Part: performance audit #36 — safe, reversible, low-risk
      // action): the UI flips immediately, the request runs behind it; a
      // failure here just leaves it unread again on the next real fetch,
      // no data was ever at risk.
      queryClient.setQueryData(NOTIFICATIONS_QUERY_KEY, (old?: { items: NotificationItem[] }) =>
        old ? { ...old, items: old.items.map((x) => (x.id === n.id ? { ...x, read: true } : x)) } : old,
      );
      queryClient.setQueryData(UNREAD_COUNT_QUERY_KEY, (old?: { total: number }) =>
        old ? { ...old, total: Math.max(0, old.total - 1) } : old,
      );
      markReadMutation.mutate(n.id);
    }
    if (n.actionUrl) {
      setOpen(false);
      router.push(n.actionUrl);
    }
  }

  const markAllReadMutation = useMutation({
    mutationFn: () => api.markAllNotificationsRead(category || undefined),
  });

  function markAllRead() {
    queryClient.setQueryData(NOTIFICATIONS_QUERY_KEY, (old?: { items: NotificationItem[] }) =>
      old
        ? { ...old, items: old.items.map((n) => (category === "" || n.category === category ? { ...n, read: true } : n)) }
        : old,
    );
    queryClient.invalidateQueries({ queryKey: UNREAD_COUNT_QUERY_KEY });
    markAllReadMutation.mutate();
  }

  const dismissAllMutation = useMutation({
    mutationFn: () => api.clearAllNotifications(category || undefined),
  });

  function dismissAll() {
    queryClient.setQueryData(NOTIFICATIONS_QUERY_KEY, (old?: { items: NotificationItem[] }) =>
      old ? { ...old, items: old.items.filter((n) => !(category === "" || n.category === category)) } : old,
    );
    dismissAllMutation.mutate(undefined, {
      onSettled: () => queryClient.invalidateQueries({ queryKey: UNREAD_COUNT_QUERY_KEY }),
    });
  }

  const unreadVisible = items.some((n) => !n.read);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label="Notifications"
        className="relative rounded-lg p-2 text-ink/70 transition-colors hover:bg-ink/5"
      >
        <span aria-hidden>🔔</span>
        {unreadTotal > 0 && (
          <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-bad px-1 text-[10px] font-semibold text-white">
            {unreadTotal > 99 ? "99+" : unreadTotal}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 z-30 mt-2 w-[26rem] rounded-xl border border-[var(--line)] bg-[var(--paper)] shadow-lg">
          <div className="flex items-center justify-between border-b border-[var(--line)] px-3 py-2">
            <span className="text-xs font-semibold uppercase tracking-wide text-ink/50">Notifications</span>
            <div className="flex items-center gap-2.5">
              {unreadVisible && (
                <button onClick={markAllRead} className="text-[11px] text-accent hover:underline">
                  Mark all read
                </button>
              )}
              {items.length > 0 && (
                <button onClick={dismissAll} className="text-[11px] text-ink/50 hover:text-bad hover:underline">
                  Clear all
                </button>
              )}
            </div>
          </div>
          <div className="flex gap-1 overflow-x-auto border-b border-[var(--line)] px-2 py-1.5">
            {CATEGORY_TABS.map((tab) => (
              <button
                key={tab.key}
                onClick={() => setCategory(tab.key)}
                className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors ${
                  category === tab.key ? "bg-accent text-white" : "text-ink/55 hover:bg-ink/5"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
          <div className="max-h-96 overflow-y-auto">
            {items.length === 0 && (
              <p className="px-3 py-6 text-center text-xs text-ink/40">
                {notificationsQuery.isLoading ? "Loading…" : "Nothing here right now."}
              </p>
            )}
            {items.map((n) => (
              <div
                key={n.id}
                onClick={() => openNotification(n)}
                className={`cursor-pointer border-b border-[var(--line)] px-3 py-2.5 text-xs last:border-0 hover:bg-ink/5 ${
                  n.read ? "opacity-60" : ""
                }`}
              >
                <div className="flex items-start gap-2">
                  <span className={`mt-0.5 shrink-0 ${n.severity === "ERROR" ? "text-bad" : "text-gold"}`}>
                    {n.severity === "ERROR" ? "●" : "▲"}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate font-semibold text-ink/85">{n.title || n.type}</span>
                      {!n.read && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />}
                    </div>
                    <p className="mt-0.5 text-ink/70">{n.message}</p>
                    <div className="mt-1 flex items-center justify-between text-[10px] text-ink/40">
                      <span>{timeAgo(n.createdAt)}</span>
                      {n.actionUrl && <span className="text-accent">View →</span>}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
