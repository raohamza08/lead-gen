"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, getCurrentUser } from "../../../../lib/api-client";
import { DashboardCenterShell, useDashboardDateRange } from "../../../../components/dashboard-center/dashboard-shell";
import { dateTime } from "../../../../components/dashboard-center/format";
import { DataTable, SectionCard } from "../../../../components/chart-kit";
import { ErrorState } from "../../../../components/ui/error-state";
import { SkeletonCard } from "../../../../components/ui/skeleton";
import { EmptyState } from "../../../../components/ui/empty-state";
import { Input } from "../../../../components/ui/input";
import { Button } from "../../../../components/ui/button";

interface Benchmark {
  metricKey: string;
  targetValue: number;
  updatedAt: string;
  updatedByUserId: string | null;
}

const EMPTY = { metricKey: "", targetValue: "" };

export default function BenchmarksAdminPage() {
  // Purely a config screen -- no metric here is itself date-ranged, but the
  // shared bar is kept for nav/chrome consistency with the rest of
  // Dashboard Center (Part: Dashboard Center).
  const [dateRange, setDateRange] = useDashboardDateRange();
  const isAdmin = getCurrentUser()?.role === "ADMIN";
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState(EMPTY);
  const [error, setError] = useState<string | null>(null);

  const benchmarksQuery = useQuery({ queryKey: ["dc-benchmarks"], queryFn: () => api.getDashboardBenchmarks() as Promise<Benchmark[]> });
  const benchmarks = benchmarksQuery.data ?? [];

  const setMutation = useMutation({
    mutationFn: () => api.setDashboardBenchmark(draft.metricKey.trim(), Number(draft.targetValue)),
    onSuccess: () => {
      setDraft(EMPTY);
      setError(null);
      queryClient.invalidateQueries({ queryKey: ["dc-benchmarks"] });
    },
    onError: (err) => setError((err as Error).message),
  });

  const removeMutation = useMutation({
    mutationFn: (metricKey: string) => api.deleteDashboardBenchmark(metricKey),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["dc-benchmarks"] }),
  });

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!draft.metricKey.trim() || draft.targetValue === "") {
      setError("Metric key and target value are both required.");
      return;
    }
    setMutation.mutate();
  }

  return (
    <DashboardCenterShell
      title="Benchmarks"
      subtitle="Set a target value per metric. Comparisons render as actual vs. target vs. difference — never a bare good/bad label."
      dateRange={dateRange}
      onDateRangeChange={setDateRange}
    >
      <SectionCard
        title="Configured benchmarks"
        subtitle="Metric key must match the key a Dashboard Center page reports (e.g. leads.conversionRate, email.openRate)"
        actions={isAdmin ? undefined : <span className="text-xs text-ink/45">Admin only</span>}
      >
        {isAdmin && (
          <form onSubmit={submit} className="mb-4 flex flex-wrap items-end gap-3 rounded-lg border border-[var(--line)] p-3">
            <label className="flex flex-col gap-1 text-[11px] text-ink/60">
              Metric key
              <Input
                value={draft.metricKey}
                onChange={(e) => setDraft({ ...draft, metricKey: e.target.value })}
                placeholder="e.g. email.openRate"
                className="w-56"
              />
            </label>
            <label className="flex flex-col gap-1 text-[11px] text-ink/60">
              Target value
              <Input
                type="number"
                step="any"
                value={draft.targetValue}
                onChange={(e) => setDraft({ ...draft, targetValue: e.target.value })}
                placeholder="e.g. 25"
                className="w-32"
              />
            </label>
            <Button type="submit" size="sm" loading={setMutation.isPending}>
              Save
            </Button>
            {error && <span className="text-xs text-error">{error}</span>}
          </form>
        )}

        {benchmarksQuery.isLoading && <SkeletonCard className="h-32" />}
        {benchmarksQuery.error && <ErrorState message={(benchmarksQuery.error as Error).message} onRetry={() => benchmarksQuery.refetch()} />}
        {!benchmarksQuery.isLoading && benchmarks.length === 0 && (
          <EmptyState title="No benchmarks configured yet" description="Add a target above to compare a dashboard's actuals against it." />
        )}
        {benchmarks.length > 0 && (
          <DataTable
            rowKey={(r) => r.metricKey}
            rows={benchmarks}
            columns={[
              { key: "metricKey", header: "Metric", render: (r) => r.metricKey },
              { key: "targetValue", header: "Target", render: (r) => r.targetValue.toLocaleString(), numeric: true },
              { key: "updatedAt", header: "Last updated", render: (r) => dateTime(r.updatedAt) },
              {
                key: "actions",
                header: "",
                render: (r) =>
                  isAdmin ? (
                    <button
                      type="button"
                      onClick={() => confirm(`Remove the benchmark for "${r.metricKey}"?`) && removeMutation.mutate(r.metricKey)}
                      className="text-xs text-error hover:underline"
                    >
                      Remove
                    </button>
                  ) : null,
              },
            ]}
          />
        )}
      </SectionCard>
    </DashboardCenterShell>
  );
}
