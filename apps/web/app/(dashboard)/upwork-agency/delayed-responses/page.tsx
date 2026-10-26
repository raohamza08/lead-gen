"use client";

import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../../../lib/api-client";
import { SectionCard } from "../../../../components/chart-kit";
import { UpworkAgencyConnectionGate, UpworkConnectionStatus } from "../../../../components/upwork-agency-connection-gate";
import { ConversationThread, timeAgo } from "../../../../components/upwork-room-conversation";
import { InitialsAvatar } from "../../../../components/avatar";
import { RecordRow, RecordListPanel, DetailPanelHeader } from "../../../../components/record-list";
import { Button } from "../../../../components/ui/button";

type ProfileGroup = "GRAPHICS" | "TECH";
type GroupTab = "ALL" | ProfileGroup | "UNASSIGNED";

interface DelayedRoom {
  id: string;
  roomName: string | null;
  roomType: string | null;
  numUsers: number | null;
  numUnread: number | null;
  latestMessage: string | null;
  latestMessageAt: string | null;
  latestMessageFrom: string | null;
  minutesPending: number | null;
  groups: ProfileGroup[];
}

const GROUP_LABEL: Record<ProfileGroup, string> = { GRAPHICS: "Graphics", TECH: "Tech" };

function pendingLabel(minutes: number | null): string {
  if (minutes == null) return "—";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

/** Delayed Responses (Part: Rooms & Messages, 2026-10-23, explicit user
 *  request — "create another module named as delayed responses, and
 *  the chats that are unanswered for last 15 mins or more for one week
 *  should go there"; rebuilt into the same 3-panel layout as Rooms &
 *  Messages 2026-10-23 — "update the delayed responses tab same like
 *  the rooms messages tab" — rather than a plain table). Corrected
 *  2026-10-23 same day, explicit user feedback — opening a room here no
 *  longer removes it from the list; the backend's own
 *  `listDelayedResponses` (see UpworkRoomsService's docblock) already
 *  only drops a room once the freelancer has actually replied on
 *  Upwork, via message direction, not a local "read" flag. Still marks
 *  the room read in Outly for Rooms & Messages' own unread badge, but
 *  that no longer has any effect on whether it stays in THIS list.
 *  "Mark as responded" added 2026-10-26, explicit user request — a
 *  manual override (`markDelayedResponseHandled`) for when the reply
 *  happened somewhere the sync hasn't picked up yet; see
 *  UpworkApiRoom.delayedResponseDismissedAt's docblock for why it
 *  self-reverts instead of permanently hiding the room. The original
 *  15-minute pending threshold was removed the same day, explicit user
 *  request — "remove the time delay and it should work in realtime" —
 *  see UpworkRoomsService.listDelayedResponses' own docblock for the
 *  one real limit left on "realtime": Outly's own 15-minute sync tick
 *  against Upwork, which this change doesn't touch.
 *
 *  Graphics/Tech team inboxes added 2026-10-26, explicit user request —
 *  "creating two different inboxes within the same module... so that's
 *  how we can see which team is working properly and which's not". Each
 *  room's `groups` comes pre-computed from the backend (matched against
 *  UpworkFreelancerProfile.group via UpworkRoomsService) — this page only
 *  filters client-side on a value the server already resolved, it never
 *  re-derives group membership itself. A room can appear in BOTH tabs if
 *  it has assigned freelancers from both groups (explicit user decision
 *  — "show in both inboxes... so neither team misses it"), and
 *  Unassigned exists so a room whose assigned freelancer has no group
 *  set (or doesn't match any known profile) never just silently vanishes
 *  from view. */
export default function DelayedResponsesPage() {
  const queryClient = useQueryClient();
  const statusQuery = useQuery({ queryKey: ["upwork-api-status"], queryFn: () => api.getUpworkApiStatus() as Promise<UpworkConnectionStatus> });
  const connected = Boolean(statusQuery.data?.connected);

  const delayedQuery = useQuery({
    queryKey: ["upwork-api-delayed-responses"],
    queryFn: () => api.getUpworkApiDelayedResponses(),
    enabled: connected,
  });
  const data = delayedQuery.data as
    | { totalCount: number; counts: { GRAPHICS: number; TECH: number; UNASSIGNED: number }; rooms: DelayedRoom[] }
    | undefined;

  const [search, setSearch] = useState("");
  const [groupTab, setGroupTab] = useState<GroupTab>("ALL");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [respondingId, setRespondingId] = useState<string | null>(null);

  const allRooms = data?.rooms ?? [];
  const filtered = useMemo(
    () =>
      allRooms.filter((r) => {
        if (search && !(r.roomName ?? "").toLowerCase().includes(search.toLowerCase())) return false;
        if (groupTab === "ALL") return true;
        if (groupTab === "UNASSIGNED") return r.groups.length === 0;
        return r.groups.includes(groupTab);
      }),
    [allRooms, search, groupTab],
  );

  const selected = filtered.find((r) => r.id === selectedId) ?? filtered[0] ?? null;

  // Marks read in Outly for Rooms & Messages' own unread badge only —
  // does NOT remove the room from this list. This list only drops a room
  // once the freelancer actually replies on Upwork (backend-determined by
  // message direction), not because someone merely opened it here.
  function selectRoom(id: string) {
    setSelectedId(id);
    api.markUpworkApiRoomRead(id).then(() => {
      queryClient.invalidateQueries({ queryKey: ["upwork-api-rooms"] });
    });
  }

  // Manual override for "the freelancer actually replied, but Outly's sync
  // hasn't caught up yet / they handled it outside Upwork" — drops the room
  // from this list right away rather than waiting for the next sync tick.
  // Self-reverts on the backend if the client sends a genuinely new message
  // after this, so it's a one-time dismiss, not a permanent mute.
  async function markResponded(id: string) {
    setRespondingId(id);
    try {
      await api.markUpworkApiDelayedResponseHandled(id);
      if (selectedId === id) setSelectedId(null);
      await queryClient.invalidateQueries({ queryKey: ["upwork-api-delayed-responses"] });
    } finally {
      setRespondingId(null);
    }
  }

  if (statusQuery.isLoading) return <p className="text-sm text-ink/55">Loading…</p>;
  if (!connected) return <UpworkAgencyConnectionGate title="Delayed Responses" />;

  const counts = data?.counts ?? { GRAPHICS: 0, TECH: 0, UNASSIGNED: 0 };
  const tabs: { key: GroupTab; label: string; count: number }[] = [
    { key: "ALL", label: "All", count: data?.totalCount ?? 0 },
    { key: "GRAPHICS", label: "Graphics", count: counts.GRAPHICS },
    { key: "TECH", label: "Tech", count: counts.TECH },
    { key: "UNASSIGNED", label: "Unassigned", count: counts.UNASSIGNED },
  ];

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-lg font-semibold tracking-tight">Delayed Responses</h1>
      </div>

      {data && data.totalCount > 0 && (
        <div className="flex flex-wrap gap-2">
          {tabs.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setGroupTab(t.key)}
              className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                groupTab === t.key
                  ? "border-accent bg-accent text-white"
                  : "border-[var(--line)] text-ink/65 hover:bg-ink/5"
              }`}
            >
              {t.label} <span className={groupTab === t.key ? "opacity-80" : "text-ink/45"}>{t.count}</span>
            </button>
          ))}
        </div>
      )}

      {delayedQuery.isLoading && <p className="text-sm text-ink/55">Loading…</p>}
      {delayedQuery.error && <p className="text-sm text-bad">{(delayedQuery.error as Error).message}</p>}

      {data && data.totalCount === 0 && (
        <SectionCard title="Delayed">
          <p className="py-6 text-center text-sm text-ink/55">Nothing delayed — every room is already answered.</p>
        </SectionCard>
      )}

      {data && data.totalCount > 0 && (
        <div
          className="grid grid-cols-1 gap-4 lg:grid-cols-[360px_1fr_300px]"
          style={{ height: "calc(100vh - 220px)", minHeight: 480 }}
        >
          <div className="card min-h-0 overflow-hidden">
            <RecordListPanel
              title="Delayed rooms"
              count={filtered.length}
              actions={
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search rooms…"
                  className="h-8 w-full rounded border border-[var(--line)] bg-transparent px-2.5 text-sm"
                />
              }
            >
              {filtered.length === 0 && <p className="py-6 text-center text-sm text-ink/50">No rooms match.</p>}
              {filtered.map((r) => {
                const isSelected = selected?.id === r.id;
                return (
                  <RecordRow
                    key={r.id}
                    onClick={() => selectRoom(r.id)}
                    selected={isSelected}
                    unread={Boolean(r.numUnread && r.numUnread > 0)}
                    avatar={<InitialsAvatar seed={r.id} label={r.roomName ?? "?"} sizeClass="h-9 w-9 text-xs" />}
                    primary={r.roomName ?? "Untitled room"}
                    timestamp={timeAgo(r.latestMessageAt)}
                    timestampUnread={Boolean(r.numUnread && r.numUnread > 0)}
                    secondary={r.latestMessage ?? "No messages yet"}
                    secondaryUnread={Boolean(r.numUnread && r.numUnread > 0)}
                    footer={
                      <span className="flex items-center gap-1">
                        <span className="rounded-full bg-bad/15 px-1.5 py-0.5 text-[10px] font-semibold text-bad">
                          pending {pendingLabel(r.minutesPending)}
                        </span>
                        {r.groups.length === 0 ? (
                          <span className="rounded-full bg-ink/10 px-1.5 py-0.5 text-[10px] font-medium text-ink/50">Unassigned</span>
                        ) : (
                          r.groups.map((g) => (
                            <span key={g} className="rounded-full bg-accent/10 px-1.5 py-0.5 text-[10px] font-medium text-accent">
                              {GROUP_LABEL[g]}
                            </span>
                          ))
                        )}
                      </span>
                    }
                  />
                );
              })}
            </RecordListPanel>
          </div>

          <div className="card min-h-0 overflow-y-auto p-6">
            {!selected ? (
              <p className="text-sm text-ink/50">Select a room to view its conversation.</p>
            ) : (
              <div className="flex flex-col gap-4">
                <div className="flex items-start justify-between gap-3">
                  <DetailPanelHeader
                    title={selected.roomName ?? "Untitled room"}
                    avatar={<InitialsAvatar seed={selected.id} label={selected.roomName ?? "?"} sizeClass="h-9 w-9 text-sm" />}
                    identity={`${selected.numUsers ?? "—"} members · ${selected.roomType ?? "—"}`}
                    meta={`pending for ${pendingLabel(selected.minutesPending)}`}
                  />
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={respondingId === selected.id}
                    loading={respondingId === selected.id}
                    onClick={() => markResponded(selected.id)}
                  >
                    Mark as responded
                  </Button>
                </div>

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
                    <dt className="text-ink/50">Pending for</dt>
                    <dd className="font-medium text-bad">{pendingLabel(selected.minutesPending)}</dd>
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
      )}
    </div>
  );
}
