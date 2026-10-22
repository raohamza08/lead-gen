"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../../../lib/api-client";
import { SectionCard, KpiStrip, StatTile } from "../../../../components/chart-kit";
import { UpworkAgencyConnectionGate, UpworkConnectionStatus } from "../../../../components/upwork-agency-connection-gate";

interface MeWithReminderSettings {
  upworkChatReminderEnabled: boolean;
  upworkChatReminderThresholdMinutes: number;
}

type NotificationPermissionState = NotificationPermission | "unsupported";

/** "Enable Desktop Notifications" control + threshold (Part: Rooms &
 *  Messages desktop notifications, 2026-10-23, explicit user request).
 *  Mirrors the exact pattern already used on the Profile page's
 *  "Desktop notifications" toggle (same permission-request flow, same
 *  denied/unsupported messaging, never re-prompts once granted/denied)
 *  — this is a more specific, additional opt-in layered on top of that
 *  general one, not a replacement for it. */
function PendingChatReminderSettings() {
  const [me, setMe] = useState<MeWithReminderSettings | null>(null);
  const [permissionState, setPermissionState] = useState<NotificationPermissionState>("default");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.getMe().then((res) => setMe(res as MeWithReminderSettings));
    setPermissionState(typeof window !== "undefined" && "Notification" in window ? window.Notification.permission : "unsupported");
  }, []);

  async function save(patch: Partial<MeWithReminderSettings>) {
    if (!me) return;
    const next = { ...me, ...patch };
    setMe(next);
    setSaving(true);
    setError(null);
    try {
      await api.updateProfile(patch);
    } catch (err) {
      setError((err as Error).message);
      setMe(me); // revert on failure
    } finally {
      setSaving(false);
    }
  }

  async function enable() {
    if (typeof window !== "undefined" && "Notification" in window) {
      const result = await window.Notification.requestPermission();
      setPermissionState(result);
      if (result !== "granted") return; // don't flip the preference on if the browser itself refused
    }
    await save({ upworkChatReminderEnabled: true });
  }

  if (!me) return null;

  return (
    <SectionCard title="Desktop reminders" subtitle="A real desktop notification when a client chat has gone unanswered — not the in-app bell.">
      <div className="flex flex-wrap items-center gap-3">
        {me.upworkChatReminderEnabled ? (
          <button
            type="button"
            disabled={saving}
            onClick={() => save({ upworkChatReminderEnabled: false })}
            className="h-9 rounded-md border border-[var(--line)] px-3.5 text-xs font-medium text-ink/70 transition-colors hover:bg-ink/5 disabled:opacity-50"
          >
            Disable reminders
          </button>
        ) : (
          <button
            type="button"
            disabled={saving}
            onClick={enable}
            className="h-9 rounded-md bg-accent px-3.5 text-xs font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            Enable Desktop Notifications
          </button>
        )}
        <label className="flex items-center gap-1.5 text-xs text-ink/60">
          Remind me after
          <input
            type="number"
            min={1}
            max={240}
            value={me.upworkChatReminderThresholdMinutes}
            onChange={(e) => save({ upworkChatReminderThresholdMinutes: Math.min(240, Math.max(1, Number(e.target.value) || 15)) })}
            className="h-8 w-16 rounded-md border border-[var(--line)] bg-transparent px-2 text-sm"
          />
          minutes unanswered
        </label>
      </div>
      {permissionState === "denied" && (
        <p className="mt-2 text-[11px] text-bad">Blocked at the browser level — enable notifications for this site in your browser settings first.</p>
      )}
      {permissionState === "unsupported" && (
        <p className="mt-2 text-[11px] text-ink/40">Desktop notifications aren&apos;t supported in this browser.</p>
      )}
      {me.upworkChatReminderEnabled && (
        <p className="mt-2 text-[11px] text-ink/40">
          Also requires &quot;Desktop notifications&quot; enabled in your Profile settings — this is an additional, more specific reminder on
          top of that general toggle.
        </p>
      )}
      {error && <p className="mt-2 text-[11px] text-bad">{error}</p>}
    </SectionCard>
  );
}

function initials(name: string | null): string {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

function timeAgo(iso: string | null): string {
  if (!iso) return "—";
  const diffMin = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (diffMin < 1) return "now";
  if (diffMin < 60) return `${diffMin}m`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 7) return `${diffDay}d`;
  return new Date(iso).toLocaleDateString();
}

/** Rooms & Messages (spec Module K), read-only. Part: Upwork API
 *  integration — enterprise UI shell, 2026-10-23. Rebuilt into a 3-panel
 *  chat-app layout to match the user's "Dark Mode Rooms & Messages
 *  Dashboard" reference image, using the app's own orange/near-black dark
 *  tokens rather than the mockup's purple. Every field shown is real
 *  (`UpworkApiRoom`'s stored columns) — the mockup's multi-message
 *  thread, member-status list, shared files, and tasks/activity tabs
 *  have no backing data and are intentionally omitted rather than
 *  fabricated, with a short disclosure instead. No send-message
 *  capability exists anywhere in this app, by explicit instruction. */
export default function RoomsPage() {
  const statusQuery = useQuery({ queryKey: ["upwork-api-status"], queryFn: () => api.getUpworkApiStatus() as Promise<UpworkConnectionStatus> });
  const connected = Boolean(statusQuery.data?.connected);

  const roomsQuery = useQuery({ queryKey: ["upwork-api-rooms"], queryFn: () => api.getUpworkApiRooms(), enabled: connected });
  const rooms = roomsQuery.data;

  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Deep-link from a desktop reminder notification (Part: Rooms & Messages
  // desktop notifications, 2026-10-23) — `?room=<id>` pre-selects the room
  // the reminder was about, same id UpworkRoomsService.listRooms exposes.
  // Read directly off window.location rather than useSearchParams() so this
  // page can stay statically prerendered (useSearchParams forces a Suspense
  // boundary / dynamic rendering for no benefit here — this is a one-time
  // initial value, not something that needs to react to param changes).
  useEffect(() => {
    const room = new URLSearchParams(window.location.search).get("room");
    if (room) setSelectedId(room);
  }, []);

  const allRooms = rooms?.rooms ?? [];
  const types = useMemo(
    () => Array.from(new Set(allRooms.map((r) => r.roomType).filter((t): t is string => Boolean(t)))),
    [allRooms],
  );

  const filtered = useMemo(() => {
    return allRooms
      .filter((r) => (typeFilter === "all" ? true : r.roomType === typeFilter))
      .filter((r) => (unreadOnly ? (r.numUnread ?? 0) > 0 : true))
      .filter((r) => (search ? (r.roomName ?? "").toLowerCase().includes(search.toLowerCase()) : true))
      .sort((a, b) => new Date(b.latestMessageAt ?? 0).getTime() - new Date(a.latestMessageAt ?? 0).getTime());
  }, [allRooms, typeFilter, unreadOnly, search]);

  const selected = filtered.find((r) => r.id === selectedId) ?? filtered[0] ?? null;

  if (statusQuery.isLoading) return <p className="text-sm text-ink/55">Loading…</p>;
  if (!connected) return <UpworkAgencyConnectionGate title="Rooms & Messages" />;

  const roomsWithUnread = allRooms.filter((r) => (r.numUnread ?? 0) > 0).length;
  const totalParticipants = allRooms.reduce((sum, r) => sum + (r.numUsers ?? 0), 0);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-lg font-semibold tracking-tight">Rooms & Messages</h1>
        <p className="mt-0.5 text-xs text-ink/50">
          Read-only conversation listing. Recently active rooms refresh every 15 minutes; the full room list reconciles every 6 hours. No
          send-message capability exists in this app.
        </p>
      </div>

      <PendingChatReminderSettings />

      {roomsQuery.isLoading && <p className="text-sm text-ink/55">Loading…</p>}

      {rooms && rooms.totalCount === 0 && (
        <SectionCard title="Rooms">
          <p className="text-sm text-ink/55">No rooms found.</p>
        </SectionCard>
      )}

      {rooms && rooms.totalCount > 0 && (
        <>
          <KpiStrip>
            <StatTile label="Total rooms" value={rooms.totalCount} />
            <StatTile label="Unread messages" value={rooms.totalUnread} />
            <StatTile label="Rooms with unread" value={roomsWithUnread} active={unreadOnly} onClick={() => setUnreadOnly((v) => !v)} />
            <StatTile label="Total participants" value={totalParticipants} />
          </KpiStrip>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-[360px_1fr_300px]">
            <SectionCard title="All rooms">
              <div className="flex flex-col gap-3">
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search rooms…"
                  className="h-9 w-full rounded-md border border-[var(--line)] bg-transparent px-2.5 text-sm"
                />
                <div className="flex items-center gap-2">
                  {types.length > 0 && (
                    <select
                      value={typeFilter}
                      onChange={(e) => setTypeFilter(e.target.value)}
                      className="h-9 flex-1 rounded-md border border-[var(--line)] bg-transparent px-2.5 text-sm"
                    >
                      <option value="all">All types</option>
                      {types.map((t) => (
                        <option key={t} value={t}>
                          {t}
                        </option>
                      ))}
                    </select>
                  )}
                  <label className="flex shrink-0 items-center gap-1.5 text-xs text-ink/60">
                    <input type="checkbox" checked={unreadOnly} onChange={(e) => setUnreadOnly(e.target.checked)} />
                    Unread only
                  </label>
                </div>
                {(search !== "" || typeFilter !== "all" || unreadOnly) && (
                  <button
                    type="button"
                    onClick={() => {
                      setSearch("");
                      setTypeFilter("all");
                      setUnreadOnly(false);
                    }}
                    className="self-start text-xs text-accent hover:underline"
                  >
                    Clear filters
                  </button>
                )}

                <div className="flex max-h-[520px] flex-col gap-1 overflow-y-auto">
                  {filtered.length === 0 && <p className="py-6 text-center text-sm text-ink/50">No rooms match.</p>}
                  {filtered.map((r) => {
                    const isSelected = selected?.id === r.id;
                    return (
                      <button
                        key={r.id}
                        type="button"
                        onClick={() => setSelectedId(r.id)}
                        className={`flex items-start gap-3 rounded-lg px-2.5 py-2.5 text-left transition-colors ${
                          isSelected ? "border border-accent/30 bg-accent/12" : "border border-transparent hover:bg-ink/[0.04]"
                        }`}
                      >
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent/15 text-xs font-semibold text-accent">
                          {initials(r.roomName)}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center justify-between gap-2">
                            <span className="truncate text-sm font-medium text-ink">{r.roomName ?? "Untitled room"}</span>
                            <span className="shrink-0 text-[10px] text-ink/40">{timeAgo(r.latestMessageAt)}</span>
                          </span>
                          <span className="mt-0.5 flex items-center justify-between gap-2">
                            <span className="truncate text-xs text-ink/50">{r.latestMessage ?? "No messages yet"}</span>
                            {(r.numUnread ?? 0) > 0 && (
                              <span className="shrink-0 rounded-full bg-accent px-1.5 py-0.5 text-[10px] font-semibold text-white">
                                {r.numUnread}
                              </span>
                            )}
                          </span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </SectionCard>

            <SectionCard title={selected ? selected.roomName ?? "Untitled room" : "Conversation"}>
              {!selected ? (
                <p className="text-sm text-ink/50">Select a room to view its latest message.</p>
              ) : (
                <div className="flex flex-col gap-4">
                  <div className="flex items-center gap-3 border-b border-[var(--line)] pb-3">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent/15 text-sm font-semibold text-accent">
                      {initials(selected.roomName)}
                    </span>
                    <div>
                      <p className="text-sm font-medium text-ink">{selected.roomName ?? "Untitled room"}</p>
                      <p className="text-xs text-ink/50">
                        {selected.numUsers ?? "—"} members · {selected.roomType ?? "—"}
                      </p>
                    </div>
                  </div>

                  {selected.latestMessage ? (
                    <div className="flex flex-col gap-1">
                      <div className="max-w-[80%] rounded-xl rounded-tl-sm bg-ink/[0.05] px-3.5 py-2.5 text-sm text-ink">
                        {selected.latestMessage}
                      </div>
                      <p className="px-1 text-[11px] text-ink/40">
                        {selected.latestMessageFrom ?? "Unknown"} ·{" "}
                        {selected.latestMessageAt ? new Date(selected.latestMessageAt).toLocaleString() : "—"}
                      </p>
                    </div>
                  ) : (
                    <p className="text-sm text-ink/50">No messages yet in this room.</p>
                  )}

                  <p className="mt-2 rounded-lg border border-[var(--line)] bg-ink/[0.02] px-3 py-2 text-xs text-ink/45">
                    Only the most recent message per room is synced from Upwork — full conversation history isn&apos;t available here. Sending
                    messages isn&apos;t supported in this app.
                  </p>
                </div>
              )}
            </SectionCard>

            <SectionCard title="Room details">
              {!selected ? (
                <p className="text-sm text-ink/50">Select a room to see its details.</p>
              ) : (
                <div className="flex flex-col gap-4">
                  <div className="flex flex-col items-center gap-2 border-b border-[var(--line)] pb-4 text-center">
                    <span className="flex h-12 w-12 items-center justify-center rounded-full bg-accent/15 text-base font-semibold text-accent">
                      {initials(selected.roomName)}
                    </span>
                    <p className="text-sm font-medium text-ink">{selected.roomName ?? "Untitled room"}</p>
                  </div>

                  <dl className="flex flex-col gap-2.5 text-xs">
                    <div className="flex items-center justify-between">
                      <dt className="text-ink/50">Room type</dt>
                      <dd className="font-medium text-ink">{selected.roomType ?? "—"}</dd>
                    </div>
                    <div className="flex items-center justify-between">
                      <dt className="text-ink/50">Members</dt>
                      <dd className="font-medium text-ink">{selected.numUsers ?? "—"}</dd>
                    </div>
                    <div className="flex items-center justify-between">
                      <dt className="text-ink/50">Unread</dt>
                      <dd className="font-medium text-ink">{selected.numUnread ?? 0}</dd>
                    </div>
                    <div className="flex items-center justify-between">
                      <dt className="text-ink/50">Last activity</dt>
                      <dd className="font-medium text-ink">
                        {selected.latestMessageAt ? new Date(selected.latestMessageAt).toLocaleDateString() : "—"}
                      </dd>
                    </div>
                  </dl>

                  <div className="rounded-lg border border-[var(--line)] bg-ink/[0.02] px-3 py-2 text-[11px] text-ink/45">
                    Member names/online status, shared files, tasks, and activity logs aren&apos;t synced from Upwork for rooms — only the fields
                    above are real.
                  </div>
                </div>
              )}
            </SectionCard>
          </div>
        </>
      )}
    </div>
  );
}
