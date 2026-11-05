"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../../../lib/api-client";
import { KpiStrip, SectionCard, StatTile, formatCompact } from "../../../../components/chart-kit";
import { LoadingRow, Spinner } from "../../../../components/spinner";
import { PipelineBoard } from "../../../../components/pipeline/pipeline-board";

/**
 * Isolated per-campaign dashboard (Part: proper Campaign system,
 * 2026-11-05) — target vs. actual reported plainly, never hidden: if the
 * Claude subscription's real capacity can't sustain the daily target, that
 * must be visible here immediately, not discovered weeks in. Also the one
 * place to tune claudeAgentCallsPerHour, since that number only makes sense
 * in the context of "is this campaign hitting its target."
 *
 * The pipeline itself is the exact same drag-and-drop board as /pipeline
 * (PipelineBoard, extracted there for this reason) — explicit user request:
 * "proper card and proper pipeline UI like we already have, exactly the
 * same in each campaign" — scoped to just this campaign's leads via
 * campaignId, not a second, lesser implementation.
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

  const dashboardQuery = useQuery({
    queryKey: ["campaign-dashboard", id],
    queryFn: () => api.getCampaignDashboard(id) as Promise<CampaignDashboard>,
  });
  const automationQuery = useQuery({
    queryKey: ["automation-settings"],
    queryFn: () => api.getAutomationSettings() as Promise<AutomationSettings>,
  });

  const budgetMutation = useMutation({
    mutationFn: (claudeAgentCallsPerHour: number) => api.updateAutomationSettings({ claudeAgentCallsPerHour }),
    onSuccess: () => {
      setBudgetDraft(null);
      queryClient.invalidateQueries({ queryKey: ["automation-settings"] });
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

      {/* The exact same drag-and-drop board as /pipeline (PipelineBoard),
          just scoped to this campaign's own leads via campaignId -- not a
          second, lesser pipeline UI. */}
      <PipelineBoard campaignId={id} />
    </div>
  );
}
