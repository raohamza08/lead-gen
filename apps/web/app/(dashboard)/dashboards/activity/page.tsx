"use client";

import { Fragment, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../../../lib/api-client";
import { DashboardCenterShell, useDashboardDateRange } from "../../../../components/dashboard-center/dashboard-shell";
import { Input } from "../../../../components/ui/input";
import { Button } from "../../../../components/ui/button";
import { ErrorState } from "../../../../components/ui/error-state";
import { StatusBadge } from "../../../../components/ui/status-badge";
import { Table, TableHead, TableHeadRow, Th, TableBody, Tr, Td, TableEmptyRow } from "../../../../components/ui/table";
import { SkeletonCard } from "../../../../components/ui/skeleton";

interface AuditLogEntry {
  id: string;
  createdAt: string;
  action: string;
  entityType: string | null;
  entityId: string | null;
  result: "SUCCESS" | "FAILURE";
  ipAddress: string | null;
  metadata: Record<string, unknown>;
  actor: { id: string; name: string; email: string } | null;
}

const PAGE_SIZE = 50;

function formatTimestamp(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
}

/**
 * Activity/Audit Dashboard — the Dashboard Center's ADMIN/MANAGER-visible
 * view over the same AuditLogService the stricter, primary-admin-only
 * /admin/system-logs page uses (Part: Dashboard Center). This is
 * deliberately NOT a full replacement for System Logs: write coverage is
 * still partial (see docs/DASHBOARD_CENTER_PLAN.md's Phase 10 gap-analysis)
 * — several creation endpoints don't call auditLog.write() yet, so this
 * table can understate real activity until that sweep is finished.
 */
export default function ActivityDashboardPage() {
  // The shared date-range bar is shown for chrome consistency with every
  // other Dashboard Center page, but /dashboard-center/activity takes its
  // own raw from/to strings (mirroring the existing System Logs filter
  // panel), not the {range, from, to, compare} shape the other endpoints
  // share -- the filter panel below owns the real date filtering here.
  const [dateRange, setDateRange] = useDashboardDateRange();
  const [filters, setFilters] = useState({ actorId: "", entityType: "", action: "", search: "", from: "", to: "" });
  const [page, setPage] = useState(1);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const activityQuery = useQuery({
    queryKey: ["dc-activity", filters, page],
    queryFn: () => {
      const params: Record<string, string> = { page: String(page), pageSize: String(PAGE_SIZE) };
      for (const [k, v] of Object.entries(filters)) if (v) params[k] = v;
      return api.getDashboardActivity(params) as Promise<{ items: AuditLogEntry[]; total: number }>;
    },
  });

  const items = activityQuery.data?.items ?? [];
  const total = activityQuery.data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  function setFilter(key: keyof typeof filters, value: string) {
    setPage(1);
    setFilters((f) => ({ ...f, [key]: value }));
  }

  return (
    <DashboardCenterShell
      title="Activity Dashboard"
      subtitle="Auditable actions across the organization — a partial view while Phase 10's audit-log coverage sweep is still in progress."
      dateRange={dateRange}
      onDateRangeChange={setDateRange}
      onRefresh={() => activityQuery.refetch()}
      refreshing={activityQuery.isFetching}
    >
      <div className="card grid grid-cols-2 gap-3 p-3 sm:grid-cols-4">
        <Input
          value={filters.search}
          onChange={(e) => setFilter("search", e.target.value)}
          placeholder="Search action or entity id…"
          className="text-xs sm:col-span-2"
        />
        <Input value={filters.entityType} onChange={(e) => setFilter("entityType", e.target.value)} placeholder="Entity type" className="text-xs" />
        <Input value={filters.action} onChange={(e) => setFilter("action", e.target.value)} placeholder="Action" className="text-xs" />
        <label className="flex items-center gap-1.5 text-[11px] text-ink/60">
          From
          <Input type="date" value={filters.from} onChange={(e) => setFilter("from", e.target.value)} className="text-xs" />
        </label>
        <label className="flex items-center gap-1.5 text-[11px] text-ink/60">
          To
          <Input type="date" value={filters.to} onChange={(e) => setFilter("to", e.target.value)} className="text-xs" />
        </label>
      </div>

      {activityQuery.isLoading ? (
        <SkeletonCard className="h-64" />
      ) : activityQuery.error ? (
        <ErrorState message={(activityQuery.error as Error).message} onRetry={() => activityQuery.refetch()} />
      ) : (
        <Table>
          <TableHead>
            <TableHeadRow>
              <Th>Time</Th>
              <Th>User</Th>
              <Th>Action</Th>
              <Th>Entity</Th>
              <Th>Result</Th>
              <Th>IP</Th>
            </TableHeadRow>
          </TableHead>
          <TableBody>
            {items.map((entry) => (
              <Fragment key={entry.id}>
                <Tr onClick={() => setExpandedId(expandedId === entry.id ? null : entry.id)}>
                  <Td className="whitespace-nowrap text-ink/60">{formatTimestamp(entry.createdAt)}</Td>
                  <Td>{entry.actor ? entry.actor.name : <span className="text-ink/40">System</span>}</Td>
                  <Td className="font-medium">{entry.action}</Td>
                  <Td className="text-ink/60">
                    {entry.entityType ?? "—"}
                    {entry.entityId && <span className="text-ink/35"> · {entry.entityId.slice(0, 8)}</span>}
                  </Td>
                  <Td>
                    <StatusBadge tone={entry.result === "FAILURE" ? "error" : "success"} label={entry.result} />
                  </Td>
                  <Td className="text-ink/40">{entry.ipAddress ?? "—"}</Td>
                </Tr>
                {expandedId === entry.id && (
                  <tr className="border-b border-[var(--line)] bg-ink/[0.02] last:border-0">
                    <td colSpan={6} className="px-3 py-2">
                      <pre className="whitespace-pre-wrap break-all text-[11px] text-ink/70">{JSON.stringify(entry.metadata, null, 2)}</pre>
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
            {items.length === 0 && <TableEmptyRow colSpan={6}>No matching log entries.</TableEmptyRow>}
          </TableBody>
        </Table>
      )}

      {pageCount > 1 && (
        <div className="flex items-center justify-center gap-3 text-xs text-ink/60">
          <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            Previous
          </Button>
          <span>
            Page {page} of {pageCount} ({total} entries)
          </span>
          <Button variant="secondary" size="sm" disabled={page >= pageCount} onClick={() => setPage((p) => p + 1)}>
            Next
          </Button>
        </div>
      )}
    </DashboardCenterShell>
  );
}
