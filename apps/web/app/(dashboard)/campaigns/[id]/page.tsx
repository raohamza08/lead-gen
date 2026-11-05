"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../../../lib/api-client";
import { KpiStrip, SectionCard, StatTile, formatCompact } from "../../../../components/chart-kit";
import { LoadingRow, Spinner } from "../../../../components/spinner";

/**
 * Isolated per-campaign dashboard (Part: proper Campaign system,
 * 2026-11-05) — target vs. actual reported plainly, never hidden: if the
 * Claude subscription's real capacity can't sustain the daily target, that
 * must be visible here immediately, not discovered weeks in. Also the one
 * place to tune claudeAgentCallsPerHour, since that number only makes sense
 * in the context of "is this campaign hitting its target."
 */

interface CampaignDashboard {
  campaign: {
    id: string;
    name: string;
    status: "DRAFT" | "ACTIVE" | "PAUSED" | "COMPLETED";
    dailySendTarget: number;
    monthlyEmailTarget: number;
    totalSent: number;
    startedAt: string | null;
    completedAt: string | null;
  };
  leads: { totalLeads?: number; replied?: number; meetings?: number; won?: number; [key: string]: unknown };
  email: {
    performance: { sent: number; opened: number; replied: number; bounced: number; unsubscribed: number; openRate: number; replyRate: number };
    [key: string]: unknown;
  };
  pipeline: { leadRoomCount: number; byStage: { stage: string; count: number }[] };
}

interface CampaignLeadRow {
  id: string;
  companyName: string;
  pipelineState: { stage: string } | null;
}

function stageLabel(stage: string): string {
  return stage.replace(/_/g, " ").toLowerCase().replace(/^./, (c) => c.toUpperCase());
}

interface AutomationSettings {
  autoSendEnabled: boolean;
  claudeAgentCallsPerHour: number;
}

export default function CampaignDashboardPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const queryClient = useQueryClient();
  const [budgetDraft, setBudgetDraft] = useState<number | null>(null);
  const [leadsPage, setLeadsPage] = useState(1);
  const [notice, setNotice] = useState<string | null>(null);
  const LEADS_PAGE_SIZE = 20;

  const dashboardQuery = useQuery({
    queryKey: ["campaign-dashboard", id],
    queryFn: () => api.getCampaignDashboard(id) as Promise<CampaignDashboard>,
  });
  const automationQuery = useQuery({
    queryKey: ["automation-settings"],
    queryFn: () => api.getAutomationSettings() as Promise<AutomationSettings>,
  });
  // The actual leads, not just counts -- "jab compaign ko open kren to
  // wahan proper pipeline show ho jaye hamein k konsi lead kahan hai" (Part:
  // proper Campaign system, 2026-11-05, explicit user request). Reuses the
  // same GET /leads?campaignId=... the Leads page's own Campaign filter
  // uses, so this is the exact same data, not a second implementation.
  const leadsListQuery = useQuery({
    queryKey: ["campaign-leads", id, leadsPage],
    queryFn: () =>
      api.getLeads({ campaignId: id, page: String(leadsPage), pageSize: String(LEADS_PAGE_SIZE) }) as Promise<{
        items: CampaignLeadRow[];
        total: number;
      }>,
  });

  const budgetMutation = useMutation({
    mutationFn: (claudeAgentCallsPerHour: number) => api.updateAutomationSettings({ claudeAgentCallsPerHour }),
    onSuccess: () => {
      setBudgetDraft(null);
      queryClient.invalidateQueries({ queryKey: ["automation-settings"] });
    },
  });

  function invalidatePipeline() {
    queryClient.invalidateQueries({ queryKey: ["campaign-dashboard", id] });
    queryClient.invalidateQueries({ queryKey: ["campaign-leads", id] });
  }
  const promoteMutation = useMutation({
    mutationFn: () => api.promoteLeadsToPipeline({ campaignId: id }) as Promise<{ promoted: number }>,
    onSuccess: (res) => {
      setNotice(`Moved ${res.promoted} lead${res.promoted === 1 ? "" : "s"} to the pipeline — outreach starts for them now.`);
      invalidatePipeline();
    },
  });

  if (dashboardQuery.isLoading) {
    return (
      <div className="flex flex-col gap-6">
        <LoadingRow label="Loading campaign dashboard…" />
      </div>
    );
  }
  if (dashboardQuery.error) {
    return <p className="text-sm text-bad">{(dashboardQuery.error as Error).message}</p>;
  }

  const data = dashboardQuery.data!;
  const { campaign } = data;
  const perf = data.email.performance;
  const monthlyProgressPct = campaign.monthlyEmailTarget > 0 ? Math.round((campaign.totalSent / campaign.monthlyEmailTarget) * 1000) / 10 : 0;
  const currentBudget = automationQuery.data?.claudeAgentCallsPerHour ?? 10;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <Link href="/campaigns" className="text-xs text-ink/50 hover:text-ink/70">
            ← All campaigns
          </Link>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">{campaign.name}</h1>
          <p className="text-sm text-ink/50">
            {campaign.status} {campaign.startedAt && `· started ${new Date(campaign.startedAt).toLocaleDateString()}`}
            {campaign.completedAt && ` · completed ${new Date(campaign.completedAt).toLocaleDateString()}`}
          </p>
        </div>
        {dashboardQuery.isFetching && <Spinner className="h-3.5 w-3.5" />}
      </div>

      {/* Target vs actual -- plainly, never hidden (explicit requirement:
          if Claude capacity can't sustain the target, this must show it
          immediately, not three weeks in). */}
      <SectionCard title="Target vs. actual" subtitle="This month's progress against the campaign's own monthly send target.">
        <KpiStrip>
          <StatTile label="Sent this month" value={formatCompact(campaign.totalSent)} />
          <StatTile label="Monthly target" value={formatCompact(campaign.monthlyEmailTarget)} />
          <StatTile
            label="Progress"
            value={`${monthlyProgressPct}%`}
            tone={monthlyProgressPct >= 100 ? "good" : monthlyProgressPct < 30 ? "bad" : undefined}
          />
          <StatTile label="Daily target" value={formatCompact(campaign.dailySendTarget)} />
        </KpiStrip>
      </SectionCard>

      {notice && <p className="text-sm text-good">{notice}</p>}

      <SectionCard
        title="Pipeline"
        subtitle="Which lead is where, right now — opening this campaign shouldn't require a separate trip to the Leads page."
        actions={
          data.pipeline.leadRoomCount > 0 && (
            <button
              type="button"
              disabled={promoteMutation.isPending}
              onClick={() => promoteMutation.mutate()}
              className="rounded-md bg-accent px-3 py-1.5 text-xs text-white disabled:opacity-50"
            >
              {promoteMutation.isPending ? "Moving…" : `Move ${data.pipeline.leadRoomCount} to pipeline`}
            </button>
          )
        }
      >
        <KpiStrip>
          <StatTile label="Lead Room (not started)" value={formatCompact(data.pipeline.leadRoomCount)} tone={data.pipeline.leadRoomCount > 0 ? "bad" : undefined} />
          {data.pipeline.byStage.map((s) => (
            <StatTile key={s.stage} label={stageLabel(s.stage)} value={formatCompact(s.count)} />
          ))}
        </KpiStrip>

        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--line)] text-left text-xs uppercase tracking-wide text-ink/50">
                <th className="py-2">Company</th>
                <th className="py-2">Stage</th>
              </tr>
            </thead>
            <tbody>
              {(leadsListQuery.data?.items ?? []).map((lead) => (
                <tr key={lead.id} className="border-b border-[var(--line)]">
                  <td className="py-2">
                    <Link href={`/leads/${lead.id}`} className="hover:text-accent">
                      {lead.companyName}
                    </Link>
                  </td>
                  <td className="py-2">
                    {lead.pipelineState ? (
                      <span className="text-xs text-ink/70">{stageLabel(lead.pipelineState.stage)}</span>
                    ) : (
                      <span className="text-xs text-bad">Lead Room</span>
                    )}
                  </td>
                </tr>
              ))}
              {leadsListQuery.data?.items.length === 0 && (
                <tr>
                  <td colSpan={2} className="py-6 text-center text-sm text-ink/50">
                    No leads in this campaign yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {(leadsListQuery.data?.total ?? 0) > LEADS_PAGE_SIZE && (
          <div className="mt-3 flex items-center justify-between text-xs text-ink/50">
            <span>
              Page {leadsPage} of {Math.max(1, Math.ceil((leadsListQuery.data?.total ?? 0) / LEADS_PAGE_SIZE))}
            </span>
            <div className="flex gap-2">
              <button type="button" disabled={leadsPage <= 1} onClick={() => setLeadsPage((p) => p - 1)} className="rounded border border-[var(--line)] px-2 py-1 disabled:opacity-40">
                Prev
              </button>
              <button
                type="button"
                disabled={leadsPage >= Math.ceil((leadsListQuery.data?.total ?? 0) / LEADS_PAGE_SIZE)}
                onClick={() => setLeadsPage((p) => p + 1)}
                className="rounded border border-[var(--line)] px-2 py-1 disabled:opacity-40"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </SectionCard>

      <SectionCard title="Email performance" subtitle="Isolated to this campaign's own leads only.">
        <KpiStrip>
          <StatTile label="Sent" value={formatCompact(perf.sent)} />
          <StatTile label="Opened" value={`${perf.opened} (${perf.openRate}%)`} />
          <StatTile label="Replied" value={`${perf.replied} (${perf.replyRate}%)`} tone={perf.replied > 0 ? "good" : undefined} />
          <StatTile label="Bounced" value={perf.bounced} tone={perf.bounced > 0 ? "bad" : undefined} />
          <StatTile label="Unsubscribed" value={perf.unsubscribed} tone={perf.unsubscribed > 0 ? "bad" : undefined} />
        </KpiStrip>
      </SectionCard>

      <SectionCard
        title="Claude capacity"
        subtitle="How many AI agent calls (lead research, drafting) the drip scheduler can dispatch per hour — shared with your own Claude Code usage on the same login, so this is the one dial that controls both how fast this campaign can realistically hit its target and how much headroom you keep for yourself."
      >
        <div className="flex items-center gap-3">
          <label className="block">
            <span className="mb-1 block text-xs text-ink/60">Calls per hour</span>
            <input
              type="number"
              min={1}
              value={budgetDraft ?? currentBudget}
              onChange={(e) => setBudgetDraft(Number(e.target.value))}
              className="w-32 rounded border border-[var(--line)] bg-transparent px-3 py-2 text-sm"
            />
          </label>
          <button
            type="button"
            disabled={budgetDraft === null || budgetMutation.isPending}
            onClick={() => budgetMutation.mutate(budgetDraft!)}
            className="mt-5 rounded-md bg-accent px-4 py-2 text-sm text-white disabled:opacity-50"
          >
            {budgetMutation.isPending ? "Saving…" : "Save"}
          </button>
        </div>
        <p className="mt-3 text-xs text-ink/50">
          No safe universal default exists — it depends on your actual Claude plan tier. If drafts are falling behind the daily
          target, check whether the rate-limit circuit breaker is tripping before raising this (that means the subscription is
          already saturated, not that the budget is too conservative).
        </p>
      </SectionCard>
    </div>
  );
}
