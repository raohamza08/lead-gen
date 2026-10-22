"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../../../lib/api-client";
import { SectionCard, KpiStrip, StatTile, DataTable } from "../../../../components/chart-kit";
import { UpworkAgencyConnectionGate, UpworkConnectionStatus } from "../../../../components/upwork-agency-connection-gate";

interface DelayedRoom {
  id: string;
  roomName: string | null;
  roomType: string | null;
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
 *  should go there"). Reuses UpworkApiRoom's real `numUnread`/
 *  `latestMessageAt` — no new sync, same "pending" definition as the
 *  desktop reminder worker (see its own docblock for why numUnread>0 is
 *  the honest proxy available, in the absence of a true per-message
 *  reply trace). */
export default function DelayedResponsesPage() {
  const statusQuery = useQuery({ queryKey: ["upwork-api-status"], queryFn: () => api.getUpworkApiStatus() as Promise<UpworkConnectionStatus> });
  const connected = Boolean(statusQuery.data?.connected);

  const delayedQuery = useQuery({
    queryKey: ["upwork-api-delayed-responses"],
    queryFn: () => api.getUpworkApiDelayedResponses(),
    enabled: connected,
  });
  const data = delayedQuery.data;

  if (statusQuery.isLoading) return <p className="text-sm text-ink/55">Loading…</p>;
  if (!connected) return <UpworkAgencyConnectionGate title="Delayed Responses" />;

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-lg font-semibold tracking-tight">Delayed Responses</h1>
      <p className="text-xs text-ink/50">
        Rooms with a real unread message 15+ minutes old, from the last 7 days — click a row to open it in Rooms & Messages.
      </p>

      <SectionCard title="Delayed">
        {delayedQuery.isLoading && <p className="text-sm text-ink/55">Loading…</p>}
        {delayedQuery.error && <p className="text-sm text-bad">{(delayedQuery.error as Error).message}</p>}
        {data && (
          <div className="flex flex-col gap-4">
            <KpiStrip>
              <StatTile label="Delayed rooms" value={data.totalCount} />
            </KpiStrip>
            {data.totalCount === 0 ? (
              <p className="py-6 text-center text-sm text-ink/55">Nothing delayed — every room with an unread message is under 15 minutes old.</p>
            ) : (
              <DataTable
                rowKey={(r: DelayedRoom) => r.id}
                columns={[
                  {
                    key: "room",
                    header: "Room",
                    render: (r: DelayedRoom) => (
                      <Link href={`/upwork-agency/rooms?room=${r.id}`} className="text-accent hover:underline">
                        {r.roomName ?? "Untitled room"}
                      </Link>
                    ),
                  },
                  { key: "latest", header: "Latest message", render: (r: DelayedRoom) => <span className="line-clamp-1 max-w-xs">{r.latestMessage ?? "—"}</span> },
                  { key: "from", header: "From", render: (r: DelayedRoom) => r.latestMessageFrom ?? "—" },
                  { key: "pending", header: "Pending for", render: (r: DelayedRoom) => pendingLabel(r.minutesPending) },
                  { key: "unread", header: "Unread", render: (r: DelayedRoom) => r.numUnread ?? 0, numeric: true },
                ]}
                rows={data.rooms}
              />
            )}
          </div>
        )}
      </SectionCard>
    </div>
  );
}
