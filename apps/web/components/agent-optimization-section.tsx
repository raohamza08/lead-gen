"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api-client";
import { DataTable, SectionCard, StatTile } from "./chart-kit";

interface AppliedChange {
  agent: string;
  promptBefore: string;
  promptAfter: string;
  rationale: string;
  confidence: string;
}

interface OptimizationCycle {
  id: string;
  runAt: string;
  score: number;
  previousScore: number | null;
  verdict: string | null;
  changesApplied: AppliedChange[];
  reverted: boolean;
}

const VERDICT_LABEL: Record<string, string> = {
  FIRST_RUN: "First cycle",
  IMPROVED: "Improved",
  WORSENED: "Worsened (auto-reverted)",
  FLAT: "No real change",
};

const VERDICT_TONE: Record<string, "good" | "bad" | undefined> = {
  IMPROVED: "good",
  WORSENED: "bad",
};

/**
 * Agent Optimization (Part: Agent Optimization, 2026-09-29) — the automatic
 * 15-day loop that scores email performance, judges the previous cycle's
 * prompt changes against it (auto-reverting if things got worse), and
 * applies a fresh round of LearningAgent-recommended email-step rewrites.
 * "Run now" bypasses the 15-day gate for testing or an immediate need,
 * same reasoning as niche filters' own Run now button.
 */
export function AgentOptimizationSection() {
  const queryClient = useQueryClient();
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [revertingId, setRevertingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { data: cycles } = useQuery({
    queryKey: ["agent-optimization-cycles"],
    queryFn: () => api.getAgentOptimizationCycles() as Promise<OptimizationCycle[]>,
  });

  async function runNow() {
    setRunning(true);
    setError(null);
    try {
      await api.runAgentOptimizationNow();
      queryClient.invalidateQueries({ queryKey: ["agent-optimization-cycles"] });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setRunning(false);
    }
  }

  async function revert(id: string) {
    if (!window.confirm("Revert this cycle's prompt changes back to what they were before it ran?")) return;
    setRevertingId(id);
    setError(null);
    try {
      await api.revertAgentOptimizationCycle(id);
      queryClient.invalidateQueries({ queryKey: ["agent-optimization-cycles"] });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setRevertingId(null);
    }
  }

  const latest = cycles?.[0];

  return (
    <SectionCard
      title="Agent Optimization"
      subtitle="Automatic every 15 days — scores email performance, judges the last round of prompt changes against it, and applies a new round if the evidence supports it."
      actions={
        <button
          type="button"
          onClick={runNow}
          disabled={running}
          className="rounded-md border border-[var(--line)] px-3 py-1.5 text-xs text-ink/70 transition-colors hover:bg-ink/5 disabled:opacity-50"
        >
          {running ? "Running…" : "Run now"}
        </button>
      }
    >
      {error && (
        <div className="mb-3 rounded-lg border border-[rgb(var(--bad-rgb)/0.4)] bg-[rgb(var(--bad-rgb)/0.06)] px-3 py-2 text-sm text-bad">
          {error}
        </div>
      )}

      {latest && (
        <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
          <StatTile label="Current score" value={`${latest.score}%`} />
          <StatTile
            label="Last verdict"
            value={latest.verdict ? (VERDICT_LABEL[latest.verdict] ?? latest.verdict) : "—"}
            tone={latest.verdict ? VERDICT_TONE[latest.verdict] : undefined}
          />
          <StatTile label="Changes this cycle" value={latest.changesApplied.length} />
        </div>
      )}

      {!cycles || cycles.length === 0 ? (
        <p className="py-8 text-center text-sm text-ink/50">
          No cycles yet — the first automatic run happens once there&apos;s 15 days of email history, or click
          &quot;Run now&quot;.
        </p>
      ) : (
        <DataTable
          rows={cycles}
          rowKey={(r) => r.id}
          columns={[
            { key: "runAt", header: "Date", render: (r) => new Date(r.runAt).toLocaleDateString() },
            { key: "score", header: "Score", numeric: true, render: (r) => `${r.score}%` },
            {
              key: "verdict",
              header: "Verdict",
              render: (r) => (r.verdict ? VERDICT_LABEL[r.verdict] ?? r.verdict : "—"),
            },
            {
              key: "changes",
              header: "Changes",
              render: (r) =>
                r.changesApplied.length === 0 ? (
                  "—"
                ) : (
                  <button
                    type="button"
                    onClick={() => setExpandedId(expandedId === r.id ? null : r.id)}
                    className="text-accent hover:underline"
                  >
                    {r.changesApplied.length} change(s) {expandedId === r.id ? "▾" : "▸"}
                  </button>
                ),
            },
            {
              key: "actions",
              header: "",
              render: (r) =>
                r.changesApplied.length === 0 || r.reverted ? (
                  r.reverted ? <span className="text-ink/40">Reverted</span> : null
                ) : (
                  <button
                    disabled={revertingId === r.id}
                    onClick={() => revert(r.id)}
                    className="text-bad hover:underline disabled:opacity-50"
                  >
                    Revert
                  </button>
                ),
            },
          ]}
        />
      )}

      {expandedId &&
        (() => {
          const cycle = cycles?.find((c) => c.id === expandedId);
          if (!cycle) return null;
          return (
            <div className="mt-3 flex flex-col gap-3 border-t border-[var(--line)] pt-3">
              {cycle.changesApplied.map((c, i) => (
                <div key={i} className="rounded-lg border border-[var(--line)] p-3 text-xs">
                  <div className="mb-1 font-medium">
                    {c.agent} <span className="text-ink/45">({c.confidence} confidence)</span>
                  </div>
                  <div className="mb-2 text-ink/60">{c.rationale}</div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <div>
                      <div className="mb-1 text-[10px] uppercase tracking-wide text-ink/45">Before</div>
                      <pre className="whitespace-pre-wrap rounded bg-ink/5 p-2 text-[11px]">{c.promptBefore}</pre>
                    </div>
                    <div>
                      <div className="mb-1 text-[10px] uppercase tracking-wide text-ink/45">After</div>
                      <pre className="whitespace-pre-wrap rounded bg-ink/5 p-2 text-[11px]">{c.promptAfter}</pre>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          );
        })()}
    </SectionCard>
  );
}
