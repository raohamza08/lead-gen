"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../../../lib/api-client";
import { SectionCard, DataTable, StatTile, KpiStrip } from "../../../../components/chart-kit";
import { UpworkAgencyConnectionGate, UpworkConnectionStatus } from "../../../../components/upwork-agency-connection-gate";

/** Marketplace Job Postings + Job Details (spec Modules G + S). Part:
 *  Upwork API integration — enterprise UI shell, 2026-10-23. Live
 *  public-marketplace search only — not synced/stored, confirmed real
 *  totalCount in the tens of thousands at any given time. */
export default function MarketplaceJobsPage() {
  const statusQuery = useQuery({ queryKey: ["upwork-api-status"], queryFn: () => api.getUpworkApiStatus() as Promise<UpworkConnectionStatus> });
  const connected = Boolean(statusQuery.data?.connected);
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");

  const jobsQuery = useQuery({
    queryKey: ["upwork-api-marketplace-jobs", query],
    queryFn: () => api.getUpworkApiMarketplaceJobs(query || undefined),
    enabled: connected,
  });
  const jobs = jobsQuery.data;

  if (statusQuery.isLoading) return <p className="text-sm text-ink/55">Loading…</p>;
  if (!connected) return <UpworkAgencyConnectionGate title="Marketplace Jobs" />;

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-lg font-semibold tracking-tight">Marketplace Jobs</h1>
      <p className="text-xs text-ink/50">Live public marketplace data — real third-party job postings, not this agency&apos;s own records. Not synced or stored.</p>

      <SectionCard title="Search">
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            setQuery(search);
          }}
        >
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search public job postings…"
            className="h-9 flex-1 rounded-md border border-[var(--line)] bg-transparent px-2.5 text-sm"
          />
          <button type="submit" className="h-9 rounded-md bg-accent px-4 text-sm text-white">
            Search
          </button>
        </form>
      </SectionCard>

      <SectionCard title="Results">
        {jobsQuery.isLoading && <p className="text-sm text-ink/55">Loading…</p>}
        {jobsQuery.error && <p className="text-sm text-bad">{(jobsQuery.error as Error).message}</p>}
        {jobs && (
          <div className="flex flex-col gap-4">
            <KpiStrip>
              <StatTile label="Total matching (public marketplace)" value={jobs.totalCount ?? "—"} />
            </KpiStrip>
            <DataTable
              rowKey={(j) => j.id}
              columns={[
                { key: "title", header: "Title", render: (j) => <span className="line-clamp-1 max-w-sm">{j.title}</span> },
                { key: "category", header: "Category", render: (j) => j.category ?? "—" },
                { key: "level", header: "Level", render: (j) => j.experienceLevel ?? "—" },
                { key: "budget", header: "Budget", render: (j) => j.budgetDisplay ?? "—", numeric: true },
                { key: "applicants", header: "Applicants", render: (j) => j.totalApplicants, numeric: true },
                { key: "posted", header: "Posted", render: (j) => new Date(j.publishedDateTime).toLocaleDateString() },
              ]}
              rows={jobs.jobs}
            />
          </div>
        )}
      </SectionCard>
    </div>
  );
}
