"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../../lib/api-client";
import { SectionCard, StatTile } from "../../../components/chart-kit";
import { Spinner } from "../../../components/spinner";

interface Stats {
  connectedAccounts: number;
  draft: number;
  pendingReview: number;
  scheduled: number;
  published: number;
  failed: number;
}

/**
 * Social Media Overview — the module's landing page (Part: Social Media
 * Management, Overview Dashboard). Every tile links somewhere real rather
 * than being a static number, same convention as the Automation page's
 * StatTiles.
 */
export default function SocialMediaOverviewPage() {
  const statsQuery = useQuery({
    queryKey: ["social-media-stats"],
    queryFn: () => api.getSocialStats() as Promise<Stats>,
  });
  const stats = statsQuery.data ?? null;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <div className="flex items-center gap-2">
          <h1 className="text-lg font-semibold tracking-tight">Social Media</h1>
          {statsQuery.isFetching && !statsQuery.isLoading && <Spinner className="h-3.5 w-3.5" />}
        </div>
        <p className="mt-0.5 text-xs text-ink/50">
          Connect accounts, draft and schedule posts across platforms, and automate what happens when a
          new lead comes in.
        </p>
      </div>

      {statsQuery.error ? (
        <p className="text-sm text-bad">{(statsQuery.error as Error).message}</p>
      ) : !stats ? (
        <p className="text-sm text-ink/50">Loading…</p>
      ) : (
        <section className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <Link href="/social-media/accounts">
            <StatTile label="Connected accounts" value={stats.connectedAccounts} />
          </Link>
          <Link href="/social-media/posts?status=DRAFT">
            <StatTile label="Drafts" value={stats.draft} />
          </Link>
          <Link href="/social-media/posts?status=PENDING_REVIEW">
            <StatTile label="Pending review" value={stats.pendingReview} tone={stats.pendingReview > 0 ? "gold" : undefined} />
          </Link>
          <Link href="/social-media/posts?status=SCHEDULED">
            <StatTile label="Scheduled" value={stats.scheduled} />
          </Link>
          <Link href="/social-media/posts?status=PUBLISHED">
            <StatTile label="Published" value={stats.published} tone="good" />
          </Link>
          <Link href="/social-media/posts?status=FAILED">
            <StatTile label="Failed" value={stats.failed} tone={stats.failed > 0 ? "bad" : undefined} />
          </Link>
        </section>
      )}

      <SectionCard title="Get started" subtitle="The usual path through the module, in order.">
        <div className="grid gap-3 sm:grid-cols-3">
          <Link href="/social-media/accounts" className="card card-interactive p-4">
            <h3 className="text-sm font-semibold">1. Connect accounts</h3>
            <p className="mt-1 text-xs text-ink/50">
              Add an Instagram, Facebook, LinkedIn, X, TikTok or YouTube account per brand you manage.
            </p>
          </Link>
          <Link href="/social-media/create" className="card card-interactive p-4">
            <h3 className="text-sm font-semibold">2. Create a post</h3>
            <p className="mt-1 text-xs text-ink/50">
              Write or generate platform-specific content, attach media, and submit for review or
              schedule directly.
            </p>
          </Link>
          <Link href="/social-media/automations" className="card card-interactive p-4">
            <h3 className="text-sm font-semibold">3. Automate</h3>
            <p className="mt-1 text-xs text-ink/50">
              Auto-draft a post whenever a new lead comes in, so there&apos;s never a blank page.
            </p>
          </Link>
        </div>
      </SectionCard>
    </div>
  );
}
