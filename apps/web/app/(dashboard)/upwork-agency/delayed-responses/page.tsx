"use client";

import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../../../lib/api-client";
import { SectionCard } from "../../../../components/chart-kit";
import { UpworkAgencyConnectionGate, UpworkConnectionStatus } from "../../../../components/upwork-agency-connection-gate";
import { ConversationThread, initials, timeAgo } from "../../../../components/upwork-room-conversation";

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
}

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
 *  the rooms messages tab" — rather than a plain table). Reuses
 *  UpworkApiRoom's real `numUnread`/`latestMessageAt` — no new sync,
 *  same "pending" definition as the desktop reminder worker. Opening a
 *  room here marks it read in Outly (same local-overlay mechanism as
 *  Rooms & Messages) and removes it from this list, since it's no
 *  longer pending once viewed. */
export default function DelayedResponsesPage() {
  const queryClient = useQueryClient();
  const statusQuery = useQuery({ queryKey: ["upwork-api-status"], queryFn: () => api.getUpworkApiStatus() as Promise<UpworkConnectionStatus> });
  const connected = Boolean(statusQuery.data?.connected);

  const delayedQuery = useQuery({
    queryKey: ["upwork-api-delayed-responses"],
    queryFn: () => api.getUpworkApiDelayedResponses(),
    enabled: connected,
  });
  const data = delayedQuery.data as { totalCount: number; rooms: DelayedRoom[] } | undefined;

  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const allRooms = data?.rooms ?? [];
  const filtered = useMemo(
    () => allRooms.filter((r) => (search ? (r.roomName ?? "").toLowerCase().includes(search.toLowerCase()) : true)),
    [allRooms, search],
  );

  const selected = filtered.find((r) => r.id === selectedId) ?? filtered[0] ?? null;

  // Marks read in Outly and drops the room out of this list immediately —
  // once viewed it's no longer "delayed", mirroring Rooms & Messages' own
  // optimistic badge-clear but removing the row entirely here instead.
  function selectRoom(id: string) {
    setSelectedId(id);
    api.markUpworkApiRoomRead(id).then(() => {
      queryClient.setQueryData(["upwork-api-delayed-responses"], (old: typeof data) =>
        old ? { totalCount: Math.max(0, old.totalCount - 1), rooms: old.rooms.filter((r) => r.id !== id) } : old,
      );
      queryClient.invalidateQueries({ queryKey: ["upwork-api-rooms"] });
    });
  }

  if (statusQuery.isLoading) return <p className="text-sm text-ink/55">Loading…</p>;
  if (!connected) return <UpworkAgencyConnectionGate title="Delayed Responses" />;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-lg font-semibold tracking-tight">Delayed Responses</h1>
        <p className="mt-0.5 text-xs text-ink/50">
          Rooms with a real unread message 15+ minutes old, from the last 7 days. Opening one here marks it read and clears it from this list.
        </p>
      </div>

      {delayedQuery.isLoading && <p className="text-sm text-ink/55">Loading…</p>}
      {delayedQuery.error && <p className="text-sm text-bad">{(delayedQuery.error as Error).message}</p>}

      {data && data.totalCount === 0 && (
        <SectionCard title="Delayed">
          <p className="py-6 text-center text-sm text-ink/55">Nothing delayed — every room with an unread message is under 15 minutes old.</p>
        </SectionCard>
      )}

      {data && data.totalCount > 0 && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[360px_1fr_300px]">
          <SectionCard title={`Delayed rooms (${filtered.length})`}>
            <div className="flex flex-col gap-3">
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search rooms…"
                className="h-9 w-full rounded-md border border-[var(--line)] bg-transparent px-2.5 text-sm"
              />

              <div className="flex max-h-[520px] flex-col gap-1 overflow-y-auto">
                {filtered.length === 0 && <p className="py-6 text-center text-sm text-ink/50">No rooms match.</p>}
                {filtered.map((r) => {
                  const isSelected = selected?.id === r.id;
                  return (
                    <button
                      key={r.id}
                      type="button"
                      onClick={() => selectRoom(r.id)}
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
                          <span className="shrink-0 rounded-full bg-bad/15 px-1.5 py-0.5 text-[10px] font-semibold text-bad">
                            pending {pendingLabel(r.minutesPending)}
                          </span>
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
              <p className="text-sm text-ink/50">Select a room to view its conversation.</p>
            ) : (
              <div className="flex flex-col gap-4">
                <div className="flex items-center gap-3 border-b border-[var(--line)] pb-3">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent/15 text-sm font-semibold text-accent">
                    {initials(selected.roomName)}
                  </span>
                  <div>
                    <p className="text-sm font-medium text-ink">{selected.roomName ?? "Untitled room"}</p>
                    <p className="text-xs text-ink/50">
                      {selected.numUsers ?? "—"} members · {selected.roomType ?? "—"} · pending for {pendingLabel(selected.minutesPending)}
                    </p>
                  </div>
                </div>

                <ConversationThread roomId={selected.id} />

                <p className="mt-2 rounded-lg border border-[var(--line)] bg-ink/[0.02] px-3 py-2 text-xs text-ink/45">
                  Sending messages isn&apos;t supported in this app.
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
