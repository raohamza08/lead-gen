"use client";

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import {
  CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { api } from "../lib/api-client";
import { AXIS_PROPS, DataTable, GRID_PROPS, Legend, SectionCard, SERIES, StatTile, TOOLTIP_STYLE } from "./chart-kit";

interface SubmitterRow { submittedBy: string; total: number; won: number; lost: number; connectsUsed: number }
interface CloserRow { closedBy: string; won: number; lost: number; other: number }

interface UpworkStats {
  total: number;
  byType: { BIDDING: number; INVITE: number };
  won: number;
  lost: number;
  winRate: number | null;
  connectsUsed: number;
  avgConnectsPerBid: number;
  byCategory: { category: string; count: number }[];
  bySubmitter: { BIDDING: SubmitterRow[]; INVITE: SubmitterRow[] };
  byCloser: { BIDDING: CloserRow[]; INVITE: CloserRow[] };
  trend: { date: string; bidding: number; invite: number }[];
}

const RATE_STORAGE_KEY = "upwork-cost-per-connect";
const DEFAULT_RATE = 0.15; // Upwork's standard list price per connect — adjust below if your account's rate differs.

/** Upwork Proposals reporting tab (Part: Upwork Proposals, 2026-09-29) — the
 *  full report: pipeline totals, connects spent and their estimated cost,
 *  who's submitting the most, who's closing the most, and where the spend
 *  is going. Cost-per-connect is a client-side, editable estimate (persisted
 *  to localStorage) rather than a hardcoded number, since Upwork's real rate
 *  varies per account/category and this app has no billing integration to
 *  read it from. */
export function UpworkOverviewSection() {
  const { data: stats } = useQuery({
    queryKey: ["overview", "upwork-stats"],
    queryFn: () => api.getUpworkStats() as Promise<UpworkStats>,
  });

  const [rate, setRate] = useState(DEFAULT_RATE);
  useEffect(() => {
    const stored = window.localStorage.getItem(RATE_STORAGE_KEY);
    if (stored) setRate(parseFloat(stored));
  }, []);
  function updateRate(value: string) {
    const n = parseFloat(value);
    if (!isNaN(n) && n >= 0) {
      setRate(n);
      window.localStorage.setItem(RATE_STORAGE_KEY, String(n));
    }
  }

  if (!stats) return <p className="py-10 text-center text-sm text-ink/45">Loading…</p>;
  if (stats.total === 0) {
    return (
      <p className="py-10 text-center text-sm text-ink/45">
        No Upwork proposals logged yet.{" "}
        <Link href="/upwork/bidding" className="text-accent hover:underline">Log your first one</Link>.
      </p>
    );
  }

  const estimatedCost = stats.connectsUsed * rate;
  const topBiddersByConnects = [...stats.bySubmitter.BIDDING].sort((a, b) => b.connectsUsed - a.connectsUsed);

  return (
    <div className="flex flex-col gap-4">
      <section className="card p-5">
        <h2 className="text-section-title text-ink">Upwork Proposals — Overview</h2>
        <p className="mb-4 mt-0.5 text-xs text-ink/50">Bidding and invite proposals combined.</p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <StatTile label="Total proposals" value={stats.total} />
          <StatTile label="Bidding" value={stats.byType.BIDDING} />
          <StatTile label="Invite" value={stats.byType.INVITE} />
          <StatTile label="Won" value={stats.won} tone="good" />
          <StatTile label="Lost" value={stats.lost} tone={stats.lost > 0 ? "bad" : undefined} />
          <StatTile label="Win rate" value={stats.winRate !== null ? `${stats.winRate}%` : "—"} />
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-ink/55">
          <Link href="/upwork/bidding" className="text-accent hover:underline">Open Bidding →</Link>
          <Link href="/upwork/invite" className="text-accent hover:underline">Open Invite →</Link>
        </div>
      </section>

      <section className="card p-5">
        <h2 className="text-section-title text-ink">Connects spend</h2>
        <p className="mb-4 mt-0.5 text-xs text-ink/50">
          Live-account bidding only — Training bids and their connects are excluded from this whole
          dashboard entirely (they&apos;re practice, not real pipeline). Cost is an estimate: set your
          account&apos;s real rate per connect below.
        </p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatTile label="Connects used" value={stats.connectsUsed} />
          <StatTile label="Avg per bid" value={stats.avgConnectsPerBid} />
        </div>
        <div className="mt-4 flex flex-wrap items-end gap-3 border-t border-[var(--line)] pt-3">
          <div>
            <div className="text-[11px] uppercase tracking-wide text-ink/55">Estimated cost</div>
            <div className="mt-1 text-2xl font-semibold tracking-tight text-ink">${estimatedCost.toFixed(2)}</div>
          </div>
          <label className="ml-auto flex items-center gap-1.5 text-xs text-ink/60">
            $ per connect
            <input
              type="number"
              step="0.01"
              min={0}
              value={rate}
              onChange={(e) => updateRate(e.target.value)}
              className="w-20 rounded border border-[var(--line)] bg-transparent px-2 py-1 text-xs"
            />
          </label>
        </div>
      </section>

      <SectionCard title="Proposals over time" subtitle="Last 30 days, bidding vs invite.">
        {stats.trend.length === 0 ? (
          <p className="py-6 text-center text-sm text-ink/50">No recent activity.</p>
        ) : (
          <>
            <Legend items={[{ label: "Bidding", color: SERIES[0] }, { label: "Invite", color: SERIES[1] }]} />
            <div className="h-56 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={stats.trend} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                  <CartesianGrid {...GRID_PROPS} />
                  <XAxis dataKey="date" {...AXIS_PROPS} minTickGap={24} tickFormatter={(d: string) => d.slice(5)} />
                  <YAxis allowDecimals={false} width={32} {...AXIS_PROPS} />
                  <Tooltip {...TOOLTIP_STYLE} />
                  <Line type="monotone" dataKey="bidding" name="Bidding" stroke={SERIES[0]} strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="invite" name="Invite" stroke={SERIES[1]} strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </>
        )}
      </SectionCard>

      {/* Bidding and Invite are kept in fully separate sections rather than
          one merged table — "how many bids did X do" and "how many invites
          did X receive" are different questions, and combining them (or
          combining who-closed-what across both) actively hid the answer to
          "same for the bidding, who did how many bids and who closed how
          many projects." */}
      <SectionCard title="Bidding — by team member" subtitle="Live-account bids only. Submitted, won/lost, and connects spent.">
        {stats.bySubmitter.BIDDING.length === 0 ? (
          <p className="py-6 text-center text-sm text-ink/50">No bids logged yet.</p>
        ) : (
          <DataTable
            rows={stats.bySubmitter.BIDDING}
            rowKey={(r) => r.submittedBy}
            columns={[
              { key: "submittedBy", header: "Name", render: (r) => r.submittedBy },
              { key: "total", header: "Bids", numeric: true, render: (r) => r.total },
              { key: "won", header: "Won", numeric: true, render: (r) => r.won },
              { key: "lost", header: "Lost", numeric: true, render: (r) => r.lost },
              { key: "connects", header: "Connects", numeric: true, render: (r) => r.connectsUsed },
            ]}
          />
        )}
      </SectionCard>

      <div className="grid gap-4 lg:grid-cols-2">
        <SectionCard title="Bidding — who closed the most projects" subtitle="By closer, bidding proposals only.">
          {stats.byCloser.BIDDING.length === 0 ? (
            <p className="py-6 text-center text-sm text-ink/50">No closer recorded on any bid yet.</p>
          ) : (
            <DataTable
              rows={stats.byCloser.BIDDING}
              rowKey={(r) => r.closedBy}
              columns={[
                { key: "closedBy", header: "Name", render: (r) => r.closedBy },
                { key: "won", header: "Won", numeric: true, render: (r) => r.won },
                { key: "lost", header: "Lost", numeric: true, render: (r) => r.lost },
              ]}
            />
          )}
        </SectionCard>

        <SectionCard title="Bidding — who spent the most connects" subtitle="Same bidders, ranked by connects instead of volume.">
          {topBiddersByConnects.every((r) => r.connectsUsed === 0) ? (
            <p className="py-6 text-center text-sm text-ink/50">No connects recorded yet.</p>
          ) : (
            <DataTable
              rows={topBiddersByConnects.slice(0, 10)}
              rowKey={(r) => r.submittedBy}
              columns={[
                { key: "submittedBy", header: "Name", render: (r) => r.submittedBy },
                { key: "connects", header: "Connects", numeric: true, render: (r) => r.connectsUsed },
                { key: "cost", header: "Est. cost", numeric: true, render: (r) => `$${(r.connectsUsed * rate).toFixed(2)}` },
                { key: "bids", header: "Bids", numeric: true, render: (r) => r.total },
              ]}
            />
          )}
        </SectionCard>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <SectionCard title="Invite — by team member" subtitle="Invites received and how they closed.">
          {stats.bySubmitter.INVITE.length === 0 ? (
            <p className="py-6 text-center text-sm text-ink/50">No invites logged yet.</p>
          ) : (
            <DataTable
              rows={stats.bySubmitter.INVITE}
              rowKey={(r) => r.submittedBy}
              columns={[
                { key: "submittedBy", header: "Name", render: (r) => r.submittedBy },
                { key: "total", header: "Invites", numeric: true, render: (r) => r.total },
                { key: "won", header: "Won", numeric: true, render: (r) => r.won },
                { key: "lost", header: "Lost", numeric: true, render: (r) => r.lost },
              ]}
            />
          )}
        </SectionCard>

        <SectionCard title="Invite — who closed the most projects" subtitle="By closer, invite proposals only.">
          {stats.byCloser.INVITE.length === 0 ? (
            <p className="py-6 text-center text-sm text-ink/50">No closer recorded on any invite yet.</p>
          ) : (
            <DataTable
              rows={stats.byCloser.INVITE}
              rowKey={(r) => r.closedBy}
              columns={[
                { key: "closedBy", header: "Name", render: (r) => r.closedBy },
                { key: "won", header: "Won", numeric: true, render: (r) => r.won },
                { key: "lost", header: "Lost", numeric: true, render: (r) => r.lost },
              ]}
            />
          )}
        </SectionCard>
      </div>

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
    </div>
  );
}
