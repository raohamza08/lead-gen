"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "../../../../lib/api-client";
import { SectionCard, KpiStrip, StatTile, DataTable } from "../../../../components/chart-kit";
import { UpworkAgencyConnectionGate, UpworkConnectionStatus } from "../../../../components/upwork-agency-connection-gate";

/** Rooms & Messages (spec Module K), read-only. Part: Upwork API
 *  integration — enterprise UI shell, 2026-10-23. No send-message
 *  capability exists anywhere in this app. */
export default function RoomsPage() {
  const statusQuery = useQuery({ queryKey: ["upwork-api-status"], queryFn: () => api.getUpworkApiStatus() as Promise<UpworkConnectionStatus> });
  const connected = Boolean(statusQuery.data?.connected);

  const roomsQuery = useQuery({ queryKey: ["upwork-api-rooms"], queryFn: () => api.getUpworkApiRooms(), enabled: connected });
  const rooms = roomsQuery.data;

  if (statusQuery.isLoading) return <p className="text-sm text-ink/55">Loading…</p>;
  if (!connected) return <UpworkAgencyConnectionGate title="Rooms & Messages" />;

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-lg font-semibold tracking-tight">Rooms & Messages</h1>
      <p className="text-xs text-ink/50">Read-only conversation listing, synced every 30 minutes. No send-message capability exists in this app.</p>

      <SectionCard title="Rooms">
        {roomsQuery.isLoading && <p className="text-sm text-ink/55">Loading…</p>}
        {rooms && rooms.totalCount > 0 && (
          <div className="flex flex-col gap-4">
            <KpiStrip>
              <StatTile label="Rooms" value={rooms.totalCount} />
              <StatTile label="Unread messages" value={rooms.totalUnread} />
            </KpiStrip>
            <DataTable
              rowKey={(r) => r.id}
              columns={[
                { key: "room", header: "Room", render: (r) => r.roomName ?? "—" },
                { key: "type", header: "Type", render: (r) => r.roomType ?? "—" },
                { key: "latest", header: "Latest message", render: (r) => <span className="line-clamp-1 max-w-xs">{r.latestMessage ?? "—"}</span> },
                { key: "from", header: "From", render: (r) => r.latestMessageFrom ?? "—" },
                { key: "unread", header: "Unread", render: (r) => r.numUnread ?? 0, numeric: true },
              ]}
              rows={rooms.rooms}
            />
          </div>
        )}
      </SectionCard>
    </div>
  );
}
