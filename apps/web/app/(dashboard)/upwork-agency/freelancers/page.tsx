"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../../../lib/api-client";
import { SectionCard, KpiStrip, StatTile, DataTable } from "../../../../components/chart-kit";
import { Modal } from "../../../../components/ui/modal";
import { UpworkAgencyConnectionGate, UpworkConnectionStatus } from "../../../../components/upwork-agency-connection-gate";

interface FreelancerProfile {
  id: string;
  freelancerUserId: string;
  freelancerName: string | null;
  topRatedStatus: string | null;
  totalEarnings: number | null;
  totalJobs: number | null;
  totalFeedback: number | null;
  lastWorkedOn: string | null;
  skills: string[];
}

/** Freelancer Profiles (spec Module H). Part: Upwork API integration —
 *  enterprise UI shell, 2026-10-23. Agency-scoped: only freelancers with
 *  a verified proposal/invite relationship, never the connected user's
 *  own personal profile. Search/filter/sort/detail added as part of the
 *  CRM-functionality pass, 2026-10-23. */
export default function FreelancersPage() {
  const statusQuery = useQuery({ queryKey: ["upwork-api-status"], queryFn: () => api.getUpworkApiStatus() as Promise<UpworkConnectionStatus> });
  const connected = Boolean(statusQuery.data?.connected);

  const profilesQuery = useQuery({ queryKey: ["upwork-api-freelancer-profiles"], queryFn: () => api.getUpworkApiFreelancerProfiles(), enabled: connected });
  const profiles = profilesQuery.data;

  const [search, setSearch] = useState("");
  const [ratedFilter, setRatedFilter] = useState("all");
  const [sortByEarnings, setSortByEarnings] = useState(false);
  const [selected, setSelected] = useState<FreelancerProfile | null>(null);

  const all = (profiles?.profiles ?? []) as FreelancerProfile[];
  const ratedStatuses = useMemo(() => [...new Set(all.map((p) => p.topRatedStatus).filter((s): s is string => Boolean(s)))], [all]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    const list = all
      .filter((p) => (ratedFilter === "all" ? true : p.topRatedStatus === ratedFilter))
      .filter((p) => (q ? (p.freelancerName ?? "").toLowerCase().includes(q) || p.skills.some((s) => s.toLowerCase().includes(q)) : true));
    if (sortByEarnings) list.sort((a, b) => (b.totalEarnings ?? 0) - (a.totalEarnings ?? 0));
    return list;
  }, [all, search, ratedFilter, sortByEarnings]);

  const hasFilters = search !== "" || ratedFilter !== "all";

  if (statusQuery.isLoading) return <p className="text-sm text-ink/55">Loading…</p>;
  if (!connected) return <UpworkAgencyConnectionGate title="Freelancers" />;

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-lg font-semibold tracking-tight">Freelancers</h1>
      <p className="text-xs text-ink/50">Profile aggregates for freelancers with a real, verified relationship to this agency (sourced from proposals/invites). Click a row for full details.</p>

      <SectionCard title="Freelancer profiles">
        {profilesQuery.isLoading && <p className="text-sm text-ink/55">Loading…</p>}
        {profiles && profiles.totalCount === 0 && <p className="text-sm text-ink/55">No freelancers tracked yet.</p>}
        {profiles && profiles.totalCount > 0 && (
          <div className="flex flex-col gap-4">
            <KpiStrip>
              <StatTile label="Freelancers tracked" value={profiles.totalCount} />
            </KpiStrip>

            <div className="flex flex-wrap items-center gap-2">
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search name or skill…"
                className="h-9 w-64 rounded-md border border-[var(--line)] bg-transparent px-2.5 text-sm"
              />
              {ratedStatuses.length > 0 && (
                <select
                  value={ratedFilter}
                  onChange={(e) => setRatedFilter(e.target.value)}
                  className="h-9 rounded-md border border-[var(--line)] bg-transparent px-2.5 text-sm"
                >
                  <option value="all">Any rating</option>
                  {ratedStatuses.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              )}
              <button
                type="button"
                onClick={() => setSortByEarnings((v) => !v)}
                className="h-9 rounded-md border border-[var(--line)] px-3 text-xs text-ink/70 hover:bg-ink/5"
              >
                {sortByEarnings ? "Sorted by earnings ↓" : "Sort by earnings"}
              </button>
              {hasFilters && (
                <button
                  type="button"
                  onClick={() => {
                    setSearch("");
                    setRatedFilter("all");
                  }}
                  className="h-9 rounded-md px-3 text-xs text-accent hover:underline"
                >
                  Clear filters
                </button>
              )}
              <span className="text-xs text-ink/40">
                {filtered.length} of {all.length} shown
              </span>
            </div>

            {filtered.length === 0 ? (
              <p className="py-6 text-center text-sm text-ink/50">No freelancers match these filters.</p>
            ) : (
              <DataTable
                rowKey={(p) => p.id}
                onRowClick={(p) => setSelected(p)}
                columns={[
                  { key: "name", header: "Name", render: (p) => p.freelancerName ?? "—" },
                  { key: "rated", header: "Top Rated", render: (p) => p.topRatedStatus ?? "—" },
                  { key: "earnings", header: "Earnings", render: (p) => (p.totalEarnings != null ? `$${p.totalEarnings.toLocaleString()}` : "—"), numeric: true },
                  { key: "jobs", header: "Jobs", render: (p) => p.totalJobs ?? "—", numeric: true },
                  { key: "skills", header: "Top skills", render: (p) => <span className="line-clamp-1 max-w-xs">{p.skills.slice(0, 4).join(", ") || "—"}</span> },
                ]}
                rows={filtered}
              />
            )}
          </div>
        )}
      </SectionCard>

      <Modal open={Boolean(selected)} onOpenChange={(open) => !open && setSelected(null)} variant="drawer-right" title={selected?.freelancerName ?? "Freelancer"} contentClassName="w-full max-w-lg">
        {selected && (
          <div className="flex flex-col gap-4 text-sm">
            <dl className="grid grid-cols-2 gap-3 text-xs">
              <div>
                <dt className="text-ink/50">Top Rated status</dt>
                <dd className="font-medium text-ink">{selected.topRatedStatus ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-ink/50">Jobs</dt>
                <dd className="font-medium text-ink">{selected.totalJobs ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-ink/50">Earnings</dt>
                <dd className="font-medium text-ink">{selected.totalEarnings != null ? `$${selected.totalEarnings.toLocaleString()}` : "—"}</dd>
              </div>
              <div>
                <dt className="text-ink/50">Feedback</dt>
                <dd className="font-medium text-ink">{selected.totalFeedback != null ? `${selected.totalFeedback}★` : "—"}</dd>
              </div>
              <div className="col-span-2">
                <dt className="text-ink/50">Last worked on</dt>
                <dd className="font-medium text-ink">{selected.lastWorkedOn ? new Date(selected.lastWorkedOn).toLocaleDateString() : "—"}</dd>
              </div>
            </dl>
            {selected.skills.length > 0 && (
              <div>
                <h4 className="mb-1.5 text-xs font-medium uppercase tracking-wide text-ink/55">Skills</h4>
                <div className="flex flex-wrap gap-1.5">
                  {selected.skills.map((s) => (
                    <span key={s} className="rounded-full bg-ink/8 px-2.5 py-1 text-xs text-ink/65">
                      {s}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}
