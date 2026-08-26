"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../../lib/api-client";
import { DataTable, SectionCard, StatTile, formatCompact } from "../../../components/chart-kit";
import { LoadingRow, Spinner } from "../../../components/spinner";

/**
 * Campaign Center.
 *
 * Campaigns are what make performance attributable: without them "best offer"
 * and "best niche" are unanswerable, because every lead looks identical to
 * analytics.
 */

interface CampaignPerformance {
  id: string;
  name: string;
  niche: string;
  country: string | null;
  offer: string | null;
  active: boolean;
  targetLeads: number;
  leads: number;
  replied: number;
  meetings: number;
  won: number;
  pipelineValue: number;
  replyRate: number;
  meetingRate: number;
  winRate: number;
}

interface NicheFilterOption {
  id: string;
  niche: string;
  subNiche: string | null;
}

const EMPTY = {
  name: "",
  niche: "",
  country: "",
  offer: "",
  caseStudy: "",
  goal: "",
  targetLeads: 100,
  filterId: "",
};

export default function CampaignsPage() {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState(EMPTY);
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const performanceQuery = useQuery({
    queryKey: ["campaigns-performance"],
    queryFn: () => api.getCampaignPerformance() as Promise<CampaignPerformance[]>,
  });
  const campaignsQuery = useQuery({
    queryKey: ["campaigns"],
    queryFn: () => api.getCampaigns() as Promise<{ id: string; filterId: string | null }[]>,
  });
  const filtersQuery = useQuery({
    queryKey: ["niche-filters"],
    queryFn: () => api.getNicheFilters() as Promise<NicheFilterOption[]>,
  });

  const rows = performanceQuery.data ?? [];
  const filters = filtersQuery.data ?? [];
  // filterId per campaign, kept separate from `rows` because /campaigns/performance
  // doesn't return it — only /campaigns does.
  const linkedFilter = useMemo(() => {
    const linked: Record<string, string> = {};
    for (const c of campaignsQuery.data ?? []) linked[c.id] = c.filterId ?? "";
    return linked;
  }, [campaignsQuery.data]);

  const isLoading = performanceQuery.isLoading || campaignsQuery.isLoading || filtersQuery.isLoading;
  const isFetching = performanceQuery.isFetching || campaignsQuery.isFetching || filtersQuery.isFetching;

  function invalidateAll() {
    queryClient.invalidateQueries({ queryKey: ["campaigns-performance"] });
    queryClient.invalidateQueries({ queryKey: ["campaigns"] });
  }

  const createMutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) => api.createCampaign(payload),
    onSuccess: () => {
      setDraft(EMPTY);
      setShowForm(false);
      invalidateAll();
    },
    onError: (err) => setError((err as Error).message),
  });
  async function create(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    // Blank optional fields are stripped, so an empty box stores nothing
    // rather than an empty string that later reads as "configured".
    const payload = Object.fromEntries(Object.entries(draft).filter(([, v]) => v !== ""));
    createMutation.mutate(payload);
  }
  const saving = createMutation.isPending;

  /**
   * A campaign only accrues leads/performance once it's linked to the filter
   * that's finding them — every AI-discovered lead now carries the campaignId
   * of whichever campaign points at its filter, so this link is what makes
   * campaign performance non-zero.
   */
  const linkMutation = useMutation({
    mutationFn: ({ campaignId, filterId }: { campaignId: string; filterId: string }) =>
      api.updateCampaign(campaignId, { filterId: filterId || null }),
    onSuccess: (_data, { filterId }) => {
      setNotice(filterId ? "Filter linked. New leads it finds will attribute to this campaign." : "Filter unlinked.");
      invalidateAll();
    },
    onError: (err) => setError((err as Error).message),
  });
  function linkFilter(campaignId: string, filterId: string) {
    setError(null);
    setNotice(null);
    linkMutation.mutate({ campaignId, filterId });
  }
  const linking = linkMutation.isPending ? linkMutation.variables?.campaignId ?? null : null;

  const totals = rows.reduce(
    (acc, r) => ({
      leads: acc.leads + r.leads,
      meetings: acc.meetings + r.meetings,
      won: acc.won + r.won,
      value: acc.value + r.pipelineValue,
    }),
    { leads: 0, meetings: 0, won: 0, value: 0 },
  );

  // Ranked by meeting rate, not lead volume: the campaign that produced the most
  // leads is often just the one that ran longest, which says nothing about
  // whether the offer works.
  const best = [...rows].filter((r) => r.leads >= 5).sort((a, b) => b.meetingRate - a.meetingRate)[0];

  if (isLoading) {
    return (
      <div className="flex flex-col gap-6">
        <LoadingRow label="Loading campaigns…" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-2">{isFetching && <Spinner className="h-3.5 w-3.5" />}</div>
      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile label="Campaigns" value={rows.length} />
        <StatTile label="Leads" value={formatCompact(totals.leads)} />
        <StatTile label="Meetings" value={totals.meetings} tone={totals.meetings > 0 ? "good" : undefined} />
        <StatTile label="Pipeline value" value={`$${formatCompact(totals.value)}`} />
      </section>

      {best && (
        <div className="rounded-xl border border-[var(--line)] px-5 py-4">
          <div className="text-[11px] uppercase tracking-wide text-ink/55">Best performing campaign</div>
          <div className="mt-1 text-2xl font-semibold tracking-tight">{best.name}</div>
          <div className="mt-1 text-xs text-ink/50">
            {best.meetingRate}% meeting rate from {best.leads} leads
            {best.offer ? ` — offer: ${best.offer}` : ""}. Ranked by meeting rate rather than volume, so a
            long-running campaign doesn&apos;t outrank a better offer.
          </div>
        </div>
      )}

      <SectionCard
        title="Campaigns"
        subtitle="A campaign ties a niche and an offer to its outcomes, so performance can be attributed."
        actions={
          <button
            type="button"
            onClick={() => setShowForm((v) => !v)}
            className="rounded-md border border-[var(--line)] px-2.5 py-1 text-xs text-ink/70 transition-colors hover:bg-ink/5"
          >
            {showForm ? "Cancel" : "New campaign"}
          </button>
        }
      >
        {(error || performanceQuery.error || campaignsQuery.error || filtersQuery.error) && (
          <p className="mb-3 text-sm text-bad">
            {error ?? ((performanceQuery.error ?? campaignsQuery.error ?? filtersQuery.error) as Error).message}
          </p>
        )}
        {notice && <p className="mb-3 text-sm text-good">{notice}</p>}

        {showForm && (
          <form onSubmit={create} className="mb-5 grid gap-3 rounded-lg border border-[var(--line)] p-4 sm:grid-cols-2">
            {([
              ["name", "Campaign name *", "Healthcare AI Campaign"],
              ["niche", "Niche *", "Healthcare"],
              ["country", "Country", "United States"],
              ["offer", "Offer", "AI patient support agent"],
              ["caseStudy", "Case study", "Cut response time 60% for a clinic group"],
              ["goal", "Goal", "20 meetings this quarter"],
            ] as const).map(([key, label, placeholder]) => (
              <label key={key} className="block">
                <span className="mb-1 block text-xs text-ink/60">{label}</span>
                <input
                  value={draft[key] as string}
                  onChange={(e) => setDraft((d) => ({ ...d, [key]: e.target.value }))}
                  required={label.endsWith("*")}
                  placeholder={placeholder}
                  className="w-full rounded border border-[var(--line)] bg-transparent px-3 py-2 text-sm"
                />
              </label>
            ))}
            <label className="block">
              <span className="mb-1 block text-xs text-ink/60">Target leads</span>
              <input
                type="number"
                min={1}
                value={draft.targetLeads}
                onChange={(e) => setDraft((d) => ({ ...d, targetLeads: Number(e.target.value) }))}
                className="w-full rounded border border-[var(--line)] bg-transparent px-3 py-2 text-sm"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs text-ink/60">Niche filter</span>
              <select
                value={draft.filterId}
                onChange={(e) => setDraft((d) => ({ ...d, filterId: e.target.value }))}
                className="w-full rounded border border-[var(--line)] bg-transparent px-3 py-2 text-sm"
              >
                <option value="">None yet — link it later</option>
                {filters.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.niche}
                    {f.subNiche ? ` — ${f.subNiche}` : ""}
                  </option>
                ))}
              </select>
            </label>
            <div className="flex items-end">
              <button
                type="submit"
                disabled={saving || !draft.name.trim() || !draft.niche.trim()}
                className="rounded-md bg-accent px-4 py-2 text-sm text-white disabled:opacity-50"
              >
                {saving ? "Creating…" : "Create campaign"}
              </button>
            </div>
          </form>
        )}

        {rows.length === 0 ? (
          <p className="py-8 text-center text-sm text-ink/50">
            No campaigns yet. Create one to start attributing results to a niche and offer.
          </p>
        ) : (
          <DataTable<CampaignPerformance>
            rows={rows}
            rowKey={(r) => r.id}
            columns={[
              { key: "name", header: "Campaign", render: (r) => r.name },
              { key: "niche", header: "Niche", render: (r) => r.niche },
              { key: "country", header: "Country", render: (r) => r.country ?? "—" },
              { key: "offer", header: "Offer", render: (r) => r.offer ?? "—" },
              {
                key: "filterId",
                header: "Linked filter",
                render: (r) => (
                  <select
                    value={linkedFilter[r.id] ?? ""}
                    disabled={linking === r.id}
                    onChange={(e) => linkFilter(r.id, e.target.value)}
                    className="rounded border border-[var(--line)] bg-transparent px-2 py-1 text-xs disabled:opacity-50"
                  >
                    <option value="">Not linked</option>
                    {filters.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.niche}
                        {f.subNiche ? ` — ${f.subNiche}` : ""}
                      </option>
                    ))}
                  </select>
                ),
              },
              {
                key: "leads",
                header: "Leads",
                numeric: true,
                render: (r) => `${r.leads} / ${r.targetLeads}`,
              },
              { key: "replyRate", header: "Reply %", numeric: true, render: (r) => `${r.replyRate}%` },
              { key: "meetingRate", header: "Meeting %", numeric: true, render: (r) => `${r.meetingRate}%` },
              { key: "won", header: "Won", numeric: true, render: (r) => r.won },
              {
                key: "value",
                header: "Pipeline",
                numeric: true,
                render: (r) => `$${formatCompact(r.pipelineValue)}`,
              },
              {
                key: "active",
                header: "Active",
                render: (r) => (r.active ? "Yes" : <span className="text-ink/50">No</span>),
              },
            ]}
          />
        )}
      </SectionCard>
    </div>
  );
}
