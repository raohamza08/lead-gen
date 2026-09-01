"use client";

import { Fragment, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../../../lib/api-client";
import { LoadingRow, Spinner } from "../../../../components/spinner";
import { Button } from "../../../../components/ui/button";
import { ErrorState } from "../../../../components/ui/error-state";
import { StatusBadge } from "../../../../components/ui/status-badge";
import { Table, TableHead, TableHeadRow, Th, TableBody, Tr, Td, TableEmptyRow } from "../../../../components/ui/table";
import { Input } from "../../../../components/ui/input";
import { Select } from "../../../../components/ui/select";

interface AuditLogEntry {
  id: string;
  createdAt: string;
  action: string;
  entityType: string | null;
  entityId: string | null;
  leadId: string | null;
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
 * System Logs — restricted to the org's primary admin (Part: Admin/System
 * Logs, 2026-08-31). The nav item and this page are UX-only gates; the real
 * enforcement is PrimaryAdminGuard on GET /admin/audit-logs, which a normal
 * user (even a Role.ADMIN who isn't the primary admin) gets a 403 from
 * regardless of whether they somehow land on this URL.
 */
export default function SystemLogsPage() {
  const [filters, setFilters] = useState({
    actorId: "", entityType: "", action: "", result: "", leadId: "", dateFrom: "", dateTo: "", search: "",
  });
  const [page, setPage] = useState(1);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const logsQuery = useQuery({
    queryKey: ["audit-logs", filters, page],
    queryFn: () => {
      const params: Record<string, string> = { page: String(page), pageSize: String(PAGE_SIZE) };
      for (const [k, v] of Object.entries(filters)) if (v) params[k] = v;
      return api.getAuditLogs(params) as Promise<{ items: AuditLogEntry[]; total: number }>;
    },
  });

  const items = logsQuery.data?.items ?? [];
  const total = logsQuery.data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  function setFilter(key: keyof typeof filters, value: string) {
    setPage(1);
    setFilters((f) => ({ ...f, [key]: value }));
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <div className="flex items-center gap-2">
          <h1 className="text-lg font-semibold tracking-tight">System Logs</h1>
          {logsQuery.isFetching && !logsQuery.isLoading && <Spinner className="h-3.5 w-3.5" />}
        </div>
        <p className="mt-0.5 text-xs text-ink/55">
          Authentication, user management, permission checks, and lead activity across the organization —
          visible only to the primary administrator.
        </p>
      </div>

      <div className="card grid grid-cols-2 gap-3 p-3 sm:grid-cols-4">
        <Input
          value={filters.search}
          onChange={(e) => setFilter("search", e.target.value)}
          placeholder="Search action or entity id…"
          className="text-xs sm:col-span-2"
        />
        <Input
          value={filters.entityType}
          onChange={(e) => setFilter("entityType", e.target.value)}
          placeholder="Entity type (user, lead, auth…)"
          className="text-xs"
        />
        <Select
          value={filters.result || "ANY"}
          onValueChange={(v) => setFilter("result", v === "ANY" ? "" : v)}
          options={[
            { value: "ANY", label: "Any result" },
            { value: "SUCCESS", label: "Success" },
            { value: "FAILURE", label: "Failure" },
          ]}
        />
        <label className="flex items-center gap-1.5 text-[11px] text-ink/60">
          From
          <Input type="date" value={filters.dateFrom} onChange={(e) => setFilter("dateFrom", e.target.value)} className="text-xs" />
        </label>
        <label className="flex items-center gap-1.5 text-[11px] text-ink/60">
          To
          <Input type="date" value={filters.dateTo} onChange={(e) => setFilter("dateTo", e.target.value)} className="text-xs" />
        </label>
        <Input
          value={filters.leadId}
          onChange={(e) => setFilter("leadId", e.target.value)}
          placeholder="Lead ID"
          className="text-xs"
        />
      </div>

      {logsQuery.isLoading ? (
        <LoadingRow label="Loading system logs…" />
      ) : logsQuery.error ? (
        <ErrorState message={(logsQuery.error as Error).message} onRetry={() => logsQuery.refetch()} />
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
                      <pre className="whitespace-pre-wrap break-all text-[11px] text-ink/70">
                        {JSON.stringify(entry.metadata, null, 2)}
                      </pre>
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
    </div>
  );
}
