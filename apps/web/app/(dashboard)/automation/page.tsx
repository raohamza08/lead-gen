"use client";

import { useEffect, useState } from "react";
import { api } from "../../../lib/api-client";
import { DataTable, SectionCard, StatTile } from "../../../components/chart-kit";

/**
 * Automation / AI Performance dashboard.
 *
 * Shows what the agent fleet is actually doing. Before this existed an agent
 * degrading silently looked exactly like one working, because the only visible
 * output was the lead count at the end of a run.
 */

interface AgentHealth {
  agent: string;
  total: number;
  failed: number;
  degraded: number;
  avgDurationMs: number;
  failureRate: number;
  degradedRate: number;
}

interface HealthReport {
  windowHours: number;
  totalRuns: number;
  totalFailures: number;
  agents: AgentHealth[];
}

interface AgentRun {
  id: string;
  agent: string;
  status: string;
  durationMs: number;
  attempts: number;
  error: string | null;
  startedAt: string;
}

interface FleetAgent {
  name: string;
  responsibility: string;
  requires: string[];
  provides: string[];
  critical: boolean;
}

interface FleetReport {
  agents: FleetAgent[];
  pipelines: Record<string, string[]>;
}

/** Pipelines actually invoked at runtime: `lead_acquisition` per candidate,
 *  `manual_lead_enrichment` when a manual lead is created or re-enriched
 *  (POST /lead-gen/enrich — includes agent_review, the AI's own review-note
 *  draft), `email_only` behind every waiting stage of the 5-email sequence,
 *  `linkedin_draft` behind the lead detail page's "Generate LinkedIn copy"
 *  button, and `optimisation` behind the Analytics page's "Run analysis"
 *  button.
 *
 *  Three defined pipelines still have no caller anywhere in the codebase —
 *  confirmed by grepping for every `build("<name>", ...)` call, not just
 *  assumed: `outreach` (review->email->linkedin->scheduler as one combined
 *  chain — email and LinkedIn drafting are triggered independently instead),
 *  `lead_enrichment` (re-enrich an existing lead without re-verifying it —
 *  `manual_lead_enrichment` is used everywhere that need comes up, making
 *  this a strict subset nothing currently reaches), and `rescore` (intended
 *  to re-run scoring after a human edits the review note, per its own
 *  comment in registry.py — genuinely un-wired, not just unreached: even if
 *  something called it today, LeadScoringAgent doesn't read reviewNote, so
 *  it would recompute an identical score). Shown rather than hidden, since
 *  an agent/pipeline that never runs should be visible as such, not
 *  silently indistinguishable from one that does. */
const LIVE_PIPELINES = new Set([
  "lead_acquisition",
  "manual_lead_enrichment",
  "email_only",
  "linkedin_draft",
  "optimisation",
]);

const WINDOWS = [1, 24, 168] as const;
const WINDOW_LABELS: Record<number, string> = { 1: "1h", 24: "24h", 168: "7d" };

const fmtMs = (ms: number) => (ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`);

/** Status carries meaning here, so it ships with a label rather than colour alone. */
function StatusBadge({ status }: { status: string }) {
  const tone =
    status === "OK" ? "text-good"
      : status === "DEGRADED" ? "text-gold"
      : status === "SKIPPED" ? "text-ink/50"
      : "text-bad";
  return <span className={`font-medium ${tone}`}>{status}</span>;
}

export default function AutomationPage() {
  const [hours, setHours] = useState<number>(24);
  const [health, setHealth] = useState<HealthReport | null>(null);
  const [runs, setRuns] = useState<AgentRun[]>([]);
  const [fleet, setFleet] = useState<FleetReport | null>(null);
  const [fleetError, setFleetError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setRefreshing(true);
    Promise.all([api.getAgentHealth(hours), api.getRecentAgentRuns(50)])
      .then(([h, r]) => {
        if (cancelled) return;
        setHealth(h as HealthReport);
        setRuns(r as AgentRun[]);
        setError(null);
      })
      .catch((err) => !cancelled && setError((err as Error).message))
      .finally(() => !cancelled && setRefreshing(false));
    return () => { cancelled = true; };
  }, [hours]);

  // Fetched once, not per window — the roster itself doesn't change with the
  // time window, only the run history does.
  useEffect(() => {
    let cancelled = false;
    api
      .getAgentFleet()
      .then((f) => !cancelled && setFleet(f as FleetReport))
      .catch((err) => !cancelled && setFleetError((err as Error).message));
    return () => { cancelled = true; };
  }, []);

  if (error) return <p className="text-bad">{error}</p>;
  if (!health) return <p className="text-ink/60">Loading…</p>;

  const failureRate = health.totalRuns
    ? Math.round((health.totalFailures / health.totalRuns) * 1000) / 10
    : 0;
  const slowest = [...health.agents].sort((a, b) => b.avgDurationMs - a.avgDurationMs)[0];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs uppercase tracking-wide text-ink/55">Window</span>
        <div className="flex rounded-lg border border-[var(--line)] p-0.5">
          {WINDOWS.map((w) => (
            <button
              key={w}
              type="button"
              onClick={() => setHours(w)}
              aria-pressed={hours === w}
              className={`rounded-md px-3 py-1 text-xs transition-colors ${
                hours === w ? "bg-ink/10 font-medium text-ink" : "text-ink/60 hover:bg-ink/5"
              }`}
            >
              {WINDOW_LABELS[w]}
            </button>
          ))}
        </div>
      </div>

      <div className={`flex flex-col gap-6 transition-opacity ${refreshing ? "opacity-60" : ""}`}>
        <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatTile label="Agent runs" value={health.totalRuns} />
          <StatTile
            label="Failures"
            value={health.totalFailures}
            tone={health.totalFailures > 0 ? "bad" : "good"}
          />
          <StatTile
            label="Failure rate"
            value={`${failureRate}%`}
            tone={failureRate > 20 ? "bad" : failureRate > 5 ? "gold" : "good"}
          />
          <StatTile
            label="Slowest agent"
            value={slowest ? fmtMs(slowest.avgDurationMs) : "—"}
            hint={slowest?.agent}
          />
        </section>

        <SectionCard
          title="Agent performance"
          subtitle={`Per-agent volume, reliability and latency over the last ${WINDOW_LABELS[health.windowHours] ?? `${health.windowHours}h`}.`}
        >
          {health.agents.length === 0 ? (
            <p className="py-8 text-center text-sm text-ink/50">
              No agent activity in this window. Run a niche filter to populate it.
            </p>
          ) : (
            <DataTable<AgentHealth>
              rows={health.agents}
              rowKey={(a) => a.agent}
              columns={[
                { key: "agent", header: "Agent", render: (a) => a.agent },
                { key: "total", header: "Runs", numeric: true, render: (a) => a.total },
                {
                  key: "failureRate",
                  header: "Failure %",
                  numeric: true,
                  render: (a) => (
                    <span className={a.failureRate > 20 ? "text-bad" : a.failureRate > 5 ? "text-gold" : ""}>
                      {a.failureRate}%
                    </span>
                  ),
                },
                {
                  key: "degradedRate",
                  header: "Degraded %",
                  numeric: true,
                  render: (a) => (
                    <span className={a.degradedRate > 30 ? "text-gold" : ""}>{a.degradedRate}%</span>
                  ),
                },
                { key: "avg", header: "Avg time", numeric: true, render: (a) => fmtMs(a.avgDurationMs) },
              ]}
            />
          )}
        </SectionCard>

        <SectionCard title="Recent activity" subtitle="Newest first.">
          {runs.length === 0 ? (
            <p className="py-8 text-center text-sm text-ink/50">Nothing recorded yet.</p>
          ) : (
            <DataTable<AgentRun>
              rows={runs}
              rowKey={(r) => r.id}
              columns={[
                {
                  key: "startedAt",
                  header: "When",
                  render: (r) => new Date(r.startedAt).toLocaleTimeString(),
                },
                { key: "agent", header: "Agent", render: (r) => r.agent },
                { key: "status", header: "Status", render: (r) => <StatusBadge status={r.status} /> },
                { key: "duration", header: "Time", numeric: true, render: (r) => fmtMs(r.durationMs) },
                { key: "attempts", header: "Tries", numeric: true, render: (r) => r.attempts },
                {
                  key: "error",
                  header: "Error",
                  // Truncated: an agent error can carry a full model response,
                  // and the table stays readable only if one row is one line.
                  render: (r) => (
                    <span className="text-ink/60" title={r.error ?? ""}>
                      {r.error ? `${r.error.slice(0, 70)}${r.error.length > 70 ? "…" : ""}` : "—"}
                    </span>
                  ),
                },
              ]}
            />
          )}
        </SectionCard>

        <SectionCard
          title="Agent roster"
          subtitle="Every agent registered in the fleet, read live from the workers — not a hand-maintained list."
        >
          {fleetError ? (
            <p className="py-8 text-center text-sm text-bad">{fleetError}</p>
          ) : !fleet ? (
            <p className="py-8 text-center text-sm text-ink/50">Loading…</p>
          ) : (
            <div className="flex flex-col gap-2">
              {fleet.agents.map((a) => {
                const pipelines = Object.entries(fleet.pipelines)
                  .filter(([, steps]) => steps.includes(a.name))
                  .map(([name]) => name);
                const live = pipelines.some((p) => LIVE_PIPELINES.has(p));
                return (
                  <div key={a.name} className="rounded-lg border border-[var(--line)] p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-ink/85">{a.name}</span>
                        {a.critical && (
                          <span className="rounded-full bg-ink/8 px-2 py-0.5 text-[10px] uppercase tracking-wide text-ink/55">
                            critical
                          </span>
                        )}
                      </div>
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] uppercase tracking-wide ${
                          live ? "bg-good/15 text-good" : "bg-ink/8 text-ink/50"
                        }`}
                        title={
                          live
                            ? `Runs in: ${pipelines.join(", ")}`
                            : "Registered and contract-tested, but no live caller invokes it yet"
                        }
                      >
                        {live ? "live" : "not wired up"}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-ink/60">{a.responsibility}</p>
                  </div>
                );
              })}
            </div>
          )}
        </SectionCard>
      </div>
    </div>
  );
}
