"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../../../lib/api-client";
import { SectionCard } from "../../../../components/chart-kit";
import { UpworkAgencyConnectionGate, UpworkConnectionStatus } from "../../../../components/upwork-agency-connection-gate";
import { ConversationThread, timeAgo } from "../../../../components/upwork-room-conversation";
import { InitialsAvatar } from "../../../../components/avatar";
import { RecordRow, RecordListPanel, DetailPanelHeader } from "../../../../components/record-list";

interface MeWithReminderSettings {
  upworkChatReminderEnabled: boolean;
}

type NotificationPermissionState = NotificationPermission | "unsupported";

/** "Enable Desktop Notifications" control, fixed 15-minute threshold
 *  (Part: Rooms & Messages desktop notifications, 2026-10-23; simplified
 *  2026-10-23 per explicit user feedback — "hide this section by making
 *  the timer fixed to 10 or 15 mins"). No longer exposes an editable
 *  threshold (the backend default of 15 minutes just stands, unedited,
 *  via upworkChatReminderThresholdMinutes' own column default). Once
 *  enabled this renders nothing at all — "once the user has enabled the
 *  notifications using the button, then you should immediately hide it,
 *  it can be turned off from the settings" — the general "Desktop
 *  notifications" toggle on the Profile page is that off-switch. */
function PendingChatReminderSettings() {
  const [me, setMe] = useState<MeWithReminderSettings | null>(null);
  const [permissionState, setPermissionState] = useState<NotificationPermissionState>("default");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.getMe().then((res) => setMe(res as MeWithReminderSettings));
    setPermissionState(typeof window !== "undefined" && "Notification" in window ? window.Notification.permission : "unsupported");
  }, []);

  // One click does everything needed for a real popup to actually fire
  // (Part: desktop-notification fix, 2026-10-23, explicit user feedback —
  // "the notifications are still coming in the application, i asked you
  // for the desktop notifications"): browser permission, this specific
  // reminder's own opt-in, AND the general NotificationPreference.desktopEnabled
  // switch the shared bell component gates every desktop popup on — without
  // this third step the first two alone still only ever land in the in-app
  // bell, which is exactly the bug that was reported.
  async function enable() {
    if (typeof window !== "undefined" && "Notification" in window) {
      const result = await window.Notification.requestPermission();
      setPermissionState(result);
      if (result !== "granted") return; // don't flip the preference on if the browser itself refused
    }
    setSaving(true);
    setError(null);
    try {
      await Promise.all([api.updateProfile({ upworkChatReminderEnabled: true }), api.updateNotificationPreferences({ desktopEnabled: true })]);
      setMe({ upworkChatReminderEnabled: true });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  if (!me || me.upworkChatReminderEnabled) return null;

  return (
    <div className="flex flex-col gap-1.5">
      <button
        type="button"
        disabled={saving}
        onClick={enable}
        className="h-9 w-fit rounded-md bg-accent px-3.5 text-xs font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
      >
        Enable Desktop Notifications
      </button>
      {permissionState === "denied" && (
        <p className="text-[11px] text-bad">Blocked at the browser level — enable notifications for this site in your browser settings first.</p>
      )}
      {permissionState === "unsupported" && <p className="text-[11px] text-ink/40">Desktop notifications aren&apos;t supported in this browser.</p>}
      {error && <p className="text-[11px] text-bad">{error}</p>}
    </div>
  );
}

/** Rooms & Messages (spec Module K), read-only. Part: Upwork API
 *  integration — enterprise UI shell, 2026-10-23. Rebuilt into a 3-panel
 *  chat-app layout to match the user's "Dark Mode Rooms & Messages
 *  Dashboard" reference image, using the app's own orange/near-black dark
 *  tokens rather than the mockup's purple. Real chat history added
 *  2026-10-23 (see ConversationThread above) — every field shown is
 *  real; member-status list, shared files, and tasks/activity tabs have
 *  no backing data and are intentionally omitted rather than fabricated,
 *  with a short disclosure instead. No send-message capability exists
 *  anywhere in this app, by explicit instruction. KPI strip removed
 *  2026-10-23 per explicit user feedback ("remove this from the rooms
 *  module top"). */
export default function RoomsPage() {
  const queryClient = useQueryClient();
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

  // Marks the room read in Outly the moment it's opened (Part: Rooms &
  // Messages read state, 2026-10-23, explicit user request — "after
  // opening the chat, the count badge is not going, make sure it works
  // properly"). Optimistically zeroes the badge in the cached list too,
  // so it clears instantly instead of waiting for a refetch.
  function selectRoom(id: string) {
    setSelectedId(id);
    api.markUpworkApiRoomRead(id).then(() => {
      queryClient.setQueryData(["upwork-api-rooms"], (old: typeof rooms) =>
        old
          ? {
              ...old,
              totalUnread: Math.max(0, old.totalUnread - (old.rooms.find((r) => r.id === id)?.numUnread ?? 0)),
              rooms: old.rooms.map((r) => (r.id === id ? { ...r, numUnread: 0 } : r)),
            }
          : old,
      );
    });
  }

  if (statusQuery.isLoading) return <p className="text-sm text-ink/55">Loading…</p>;
  if (!connected) return <UpworkAgencyConnectionGate title="Rooms & Messages" />;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-lg font-semibold tracking-tight">Rooms & Messages</h1>
      </div>

      <PendingChatReminderSettings />

      {roomsQuery.isLoading && <p className="text-sm text-ink/55">Loading…</p>}

      {rooms && rooms.totalCount === 0 && (
        <SectionCard title="Rooms">
          <p className="text-sm text-ink/55">No rooms found.</p>
        </SectionCard>
      )}

      {rooms && rooms.totalCount > 0 && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[360px_1fr_300px]">
          <div className="card overflow-hidden">
            <RecordListPanel
              title="All rooms"
              count={filtered.length}
              actions={
                <div className="flex flex-col gap-2">
                  <input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search rooms…"
                    className="h-8 w-full rounded border border-[var(--line)] bg-transparent px-2.5 text-sm"
                  />
                  <div className="flex items-center gap-2">
                    {types.length > 0 && (
                      <select
                        value={typeFilter}
                        onChange={(e) => setTypeFilter(e.target.value)}
                        className="h-8 flex-1 rounded border border-[var(--line)] bg-transparent px-2.5 text-sm"
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
                </div>
              }
            >
              {filtered.length === 0 && <p className="py-6 text-center text-sm text-ink/50">No rooms match.</p>}
              {filtered.map((r) => {
                const isSelected = selected?.id === r.id;
                const unread = (r.numUnread ?? 0) > 0;
                return (
                  <RecordRow
                    key={r.id}
                    onClick={() => selectRoom(r.id)}
                    selected={isSelected}
                    unread={unread}
                    avatar={<InitialsAvatar seed={r.id} label={r.roomName ?? "?"} sizeClass="h-9 w-9 text-xs" />}
                    primary={r.roomName ?? "Untitled room"}
                    timestamp={timeAgo(r.latestMessageAt)}
                    timestampUnread={unread}
                    secondary={r.latestMessage ?? "No messages yet"}
                    secondaryUnread={unread}
                    footer={
                      unread ? (
                        <span className="rounded-full bg-accent px-1.5 py-0.5 text-[10px] font-semibold text-white">{r.numUnread}</span>
                      ) : undefined
                    }
                  />
                );
              })}
            </RecordListPanel>
          </div>

          <div className="card p-6">
            {!selected ? (
              <p className="text-sm text-ink/50">Select a room to view its conversation.</p>
            ) : (
              <div className="flex flex-col gap-4">
                <DetailPanelHeader
                  title={selected.roomName ?? "Untitled room"}
                  avatar={<InitialsAvatar seed={selected.id} label={selected.roomName ?? "?"} sizeClass="h-9 w-9 text-sm" />}
                  identity={`${selected.numUsers ?? "—"} members · ${selected.roomType ?? "—"}`}
                />

                <ConversationThread roomId={selected.id} />

                <p className="mt-2 rounded-lg border border-[var(--line)] bg-ink/[0.02] px-3 py-2 text-xs text-ink/45">
                  Sending messages isn&apos;t supported in this app.
                </p>
              </div>
            )}
          </div>

          <SectionCard title="Room details">
            {!selected ? (
              <p className="text-sm text-ink/50">Select a room to see its details.</p>
            ) : (
              <div className="flex flex-col gap-4">
                <div className="flex flex-col items-center gap-2 border-b border-[var(--line)] pb-4 text-center">
                  <InitialsAvatar seed={selected.id} label={selected.roomName ?? "?"} sizeClass="h-12 w-12 text-base" />
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
              </div>
            )}
          </SectionCard>
        </div>
      )}
    </div>
  );
}
