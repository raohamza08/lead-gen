"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../../../lib/api-client";
import { SectionCard, StatTile, formatCompact } from "../../../../components/chart-kit";
import { Spinner } from "../../../../components/spinner";

const PLATFORMS = ["INSTAGRAM", "FACEBOOK", "LINKEDIN", "X", "TIKTOK", "YOUTUBE", "WHATSAPP"] as const;
type Platform = (typeof PLATFORMS)[number];

interface Snapshot {
  capturedAt: string;
  followerCount: number | null;
  followingCount: number | null;
  postsCount: number | null;
  reach: number | null;
  impressions: number | null;
  engagementRate: number | null;
  likeCount: number | null;
  commentCount: number | null;
}

interface AccountAnalytics {
  account: { id: string; platform: Platform; username: string; displayName: string | null; profileImageUrl: string | null };
  latest: Snapshot | null;
  followerChange: number | null;
  postsPublishedByUs: number;
}

function timeAgo(iso: string): string {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

/** Follower count with an up/down delta since the previous 6-hourly snapshot
 *  — undefined/null (not 0) whenever the platform's own API didn't return a
 *  value, so "no data" never looks identical to "zero followers." */
function FollowerStat({ value, change }: { value: number | null | undefined; change: number | null }) {
  if (value == null) return <StatTile label="Followers" value="—" hint="Not reported by this platform" />;
  const hint = change == null || change === 0 ? undefined : `${change > 0 ? "+" : ""}${change} since last sync`;
  return <StatTile label="Followers" value={formatCompact(value)} hint={hint} tone={change != null && change > 0 ? "good" : change != null && change < 0 ? "bad" : undefined} />;
}

/**
 * Social Hub Analytics (Part: Social Hub Analytics, 2026-09-07) — reads
 * SocialAnalyticsSyncWorker's snapshots, never calls a platform API
 * directly (so this page is always fast and never burns a rate-limited
 * insights call on load). A connected account with no snapshot yet (just
 * connected, first 6-hour sync hasn't run) or on a platform that doesn't
 * support analytics (LinkedIn/TikTok/WhatsApp — capabilities.analytics is
 * false) shows that honestly instead of a fabricated zero.
 */
export default function SocialAnalyticsPage() {
  const [platform, setPlatform] = useState<Platform | "">("");

  const analyticsQuery = useQuery({
    queryKey: ["social-media-analytics", platform],
    queryFn: () => api.getSocialAnalytics(platform ? { platform } : {}) as Promise<AccountAnalytics[]>,
  });
  const rows = analyticsQuery.data ?? [];
  const error = analyticsQuery.error ? (analyticsQuery.error as Error).message : null;

  const withData = rows.filter((r) => r.latest);
  const totals = withData.reduce(
    (acc, r) => ({
      followers: acc.followers + (r.latest?.followerCount ?? 0),
      posts: acc.posts + r.postsPublishedByUs,
    }),
    { followers: 0, posts: 0 },
  );

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-lg font-semibold tracking-tight">Analytics</h1>
            {analyticsQuery.isFetching && !analyticsQuery.isLoading && <Spinner className="h-3.5 w-3.5" />}
          </div>
          <p className="mt-0.5 text-xs text-ink/50">
            Synced every 6 hours from each platform&apos;s own API — not live on every page load.
          </p>
        </div>
        <select
          value={platform}
          onChange={(e) => setPlatform(e.target.value as Platform | "")}
          className="rounded border border-[var(--line)] bg-transparent px-3 py-2 text-sm"
        >
          <option value="">All platforms</option>
          {PLATFORMS.map((p) => (
            <option key={p} value={p}>{p}</option>
          ))}
        </select>
      </div>

      {error && (
        <div className="rounded-lg border border-[rgb(var(--bad-rgb)/0.4)] bg-[rgb(var(--bad-rgb)/0.06)] px-3 py-2 text-sm text-bad">
          {error}
        </div>
      )}

      {rows.length > 0 && (
        <SectionCard title="Across every connected, visible account">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatTile label="Connected accounts" value={rows.length} />
            <StatTile label="Total followers" value={withData.length > 0 ? formatCompact(totals.followers) : "—"} hint={withData.length < rows.length ? `${withData.length}/${rows.length} reporting` : undefined} />
            <StatTile label="Posts published" value={totals.posts} hint="from our own records, every platform" />
            <StatTile label="Not yet synced" value={rows.length - withData.length} />
          </div>
        </SectionCard>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {rows.map(({ account, latest, followerChange, postsPublishedByUs }) => (
          <div key={account.id} className="card p-4">
            <div className="flex items-center gap-2">
              {account.profileImageUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={account.profileImageUrl} alt="" className="h-8 w-8 rounded-full object-cover" />
              )}
              <div className="min-w-0">
                <div className="text-xs uppercase tracking-wide text-ink/45">{account.platform}</div>
                <div className="truncate text-sm font-semibold">{account.displayName || account.username}</div>
              </div>
            </div>

            {latest ? (
              <>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <FollowerStat value={latest.followerCount} change={followerChange} />
                  <StatTile label="Posts published" value={postsPublishedByUs} hint="our own records" />
                  {latest.engagementRate != null && (
                    <StatTile label="Engagement rate" value={`${latest.engagementRate.toFixed(1)}%`} hint="recent posts" />
                  )}
                  {latest.reach != null && <StatTile label="Reach" value={formatCompact(latest.reach)} />}
                  {latest.impressions != null && <StatTile label="Impressions" value={formatCompact(latest.impressions)} />}
                  {latest.likeCount != null && <StatTile label="Likes" value={formatCompact(latest.likeCount)} hint="recent posts" />}
                  {latest.commentCount != null && <StatTile label="Comments" value={formatCompact(latest.commentCount)} hint="recent posts" />}
                </div>
                <p className="mt-3 text-[11px] text-ink/40">As of {timeAgo(latest.capturedAt)}</p>
              </>
            ) : (
              <div className="mt-3 flex flex-col gap-2">
                <StatTile label="Posts published" value={postsPublishedByUs} hint="our own records — always available" />
                <p className="text-xs text-ink/45">
                  No platform metrics yet — either this account was just connected (next sync within 6 hours) or{" "}
                  {account.platform} doesn&apos;t support analytics via its official API.
                </p>
              </div>
            )}
          </div>
        ))}
        {rows.length === 0 && !analyticsQuery.isLoading && (
          <p className="col-span-full py-8 text-center text-sm text-ink/50">
            No visible connected accounts. Connect one in{" "}
            <a href="/social-media/accounts" className="text-accent hover:underline">Accounts</a>.
          </p>
        )}
      </div>
    </div>
  );
}
