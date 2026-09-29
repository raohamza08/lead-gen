"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { api } from "../lib/api-client";
import { DataTable, SectionCard, StatTile } from "./chart-kit";

interface UpworkStats {
  total: number;
  byType: { BIDDING: number; INVITE: number };
  won: number;
  lost: number;
  winRate: number | null;
  connectsUsed: number;
  byCategory: { category: string; count: number }[];
  bySubmitter: { submittedBy: string; total: number; won: number; lost: number }[];
}

/** Upwork Proposals reporting tab (Part: Upwork Proposals, 2026-09-29). */
export function UpworkOverviewSection() {
  const { data: stats } = useQuery({
    queryKey: ["overview", "upwork-stats"],
    queryFn: () => api.getUpworkStats() as Promise<UpworkStats>,
  });

  if (!stats) return <p className="py-10 text-center text-sm text-ink/45">Loading…</p>;
  if (stats.total === 0) {
    return (
      <p className="py-10 text-center text-sm text-ink/45">
        No Upwork proposals logged yet.{" "}
        <Link href="/upwork/bidding" className="text-accent hover:underline">Log your first one</Link>.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <section className="card p-5">
        <h2 className="text-section-title text-ink">Upwork Proposals</h2>
        <p className="mb-4 mt-0.5 text-xs text-ink/50">Every proposal logged, bidding and invite combined.</p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <StatTile label="Total" value={stats.total} />
          <StatTile label="Bidding" value={stats.byType.BIDDING} />
          <StatTile label="Invite" value={stats.byType.INVITE} />
          <StatTile label="Won" value={stats.won} tone="good" />
          <StatTile label="Lost" value={stats.lost} tone={stats.lost > 0 ? "bad" : undefined} />
          <StatTile label="Win rate" value={stats.winRate !== null ? `${stats.winRate}%` : "—"} />
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-ink/55">
          <span>Connects used on bidding: {stats.connectsUsed}</span>
          <Link href="/upwork/bidding" className="text-accent hover:underline">Open Bidding →</Link>
          <Link href="/upwork/invite" className="text-accent hover:underline">Open Invite →</Link>
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <SectionCard title="By category" subtitle="Top job categories proposals were submitted under.">
          {stats.byCategory.length === 0 ? (
            <p className="py-6 text-center text-sm text-ink/50">No data yet.</p>
          ) : (
            <DataTable
              rows={stats.byCategory}
              rowKey={(r) => r.category}
              columns={[
                { key: "category", header: "Category", render: (r) => r.category },
                { key: "count", header: "Proposals", numeric: true, render: (r) => r.count },
              ]}
            />
          )}
        </SectionCard>

        <SectionCard title="By team member" subtitle="Who submitted what, and how it closed.">
          {stats.bySubmitter.length === 0 ? (
            <p className="py-6 text-center text-sm text-ink/50">No data yet.</p>
          ) : (
            <DataTable
              rows={stats.bySubmitter}
              rowKey={(r) => r.submittedBy}
              columns={[
                { key: "submittedBy", header: "Submitted by", render: (r) => r.submittedBy },
                { key: "total", header: "Total", numeric: true, render: (r) => r.total },
                { key: "won", header: "Won", numeric: true, render: (r) => r.won },
                { key: "lost", header: "Lost", numeric: true, render: (r) => r.lost },
              ]}
            />
          )}
        </SectionCard>
      </div>
    </div>
  );
}
