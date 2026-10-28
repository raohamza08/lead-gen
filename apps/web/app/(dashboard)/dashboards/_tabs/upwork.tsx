"use client";

import { ReactNode, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, RadialBar, RadialBarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api, getCurrentUser } from "../../../../lib/api-client";
import { DashboardCenterShell, useDashboardDateRange } from "../../../../components/dashboard-center/dashboard-shell";
import { dashboardRangeToQuery } from "../../../../components/dashboard-center/date-range-bar";
import { num, pct, money, dateTime } from "../../../../components/dashboard-center/format";
import { MetricDetail } from "../../../../components/dashboard-center/metric-detail";
import { AXIS_PROPS, ChartWithTable, DashboardIcons, DataTable, DonutBreakdown, formatCompact, GRID_PROPS, KpiStrip, Legend, SectionCard, SERIES, StatTile, TOOLTIP_STYLE } from "../../../../components/chart-kit";
import { ErrorState } from "../../../../components/ui/error-state";
import { SkeletonCard } from "../../../../components/ui/skeleton";
import { EmptyState } from "../../../../components/ui/empty-state";
import { Input } from "../../../../components/ui/input";
import { Button } from "../../../../components/ui/button";
import { Modal } from "../../../../components/ui/modal";

interface UpworkKpis {
  range: { from: string; to: string };
  totalBids: number;
  previousTotalBids?: number;
  totalBidsDeltaPct: number | null;
  totalInvites: number;
  totalInvitesDeltaPct: number | null;
  invitesAccepted: number;
  invitesRejected: number;
  clientsWon: number;
  previousClientsWon?: number;
  clientsWonDeltaPct: number | null;
  clientsLost: number;
  wonBids: number;
  wonInvites: number;
  lostBids: number;
  lostInvites: number;
  wonBidsDeltaPct: number | null;
  lostBidsDeltaPct: number | null;
  wonInvitesDeltaPct: number | null;
  lostInvitesDeltaPct: number | null;
  bidsInDiscussionDeltaPct: number | null;
  invitesInDiscussionDeltaPct: number | null;
  conversionRateBidding?: number;
  conversionRateInvites?: number;
  // Auto-matched from the real Upwork transaction ledger by client name,
  // never manually entered (Part: Upwork earnings-by-client matching,
  // 2026-10-28) -- see UpworkDashboardService.getWonClientEarnings.
  biddingTotalClientEarnings: number;
  biddingTotalServiceFees: number;
  biddingTotalNetEarnings: number;
  biddingEarningsMissingCount: number;
  inviteTotalClientEarnings: number;
  inviteTotalServiceFees: number;
  inviteTotalNetEarnings: number;
  inviteEarningsMissingCount: number;
  bidsViewed: number;
  invitesViewed: number;
  bidsInDiscussion: number;
  invitesInDiscussion: number;
  connectsUsed: number;
  connectsUsedSource: "manual_entry" | "real_ledger" | "hybrid";
  connectsUsedInvites: number;
  inviteConnectCost: number;
  costPerInvite?: number;
  avgConnectsPerInvite?: number;
  costPerClientInvites?: number;
  connectCostAvailable: boolean;
  connectCostBasis: "actual_purchases" | "flat_rate_estimate";
  connectUnitCost: number;
  connectCost?: number;
  costPerBid?: number;
  costPerClientBids?: number;
  connectsPerClient?: number;
  avgConnectsPerBid?: number;
  conversionRate?: number;
}

interface MonthlyRow {
  month: string;
  bids: number;
  invites: number;
  connectsUsed: number;
  clientsWon: number;
  connectsPurchased?: number;
  purchaseCost?: number;
  estimatedUsageCost: number;
  bidsPerClient?: number;
  connectsPerClient?: number;
}

interface UpworkRequestsSummary {
  requestedHours: number;
  biddingHours: number;
  inviteHours: number;
  totalOnboardedHours: number;
  remainingHours: number;
  pendingReview: number;
  approvedCount: number;
  rejectedCount: number;
  byProjectManager: { projectManagerId: string; name: string; requestedHours: number }[];
  // The weekly target belongs to whichever Business Developer approves a
  // request, not the requesting Project Manager (explicit user decision) —
  // this is the real performance breakdown; byProjectManager above is just
  // "who asked."
  byBusinessDeveloper: { businessDeveloperId: string; name: string; requestedHours: number; achievedHours: number }[];
  byProfile: { profileName: string; requestedHours: number; achievedHours: number }[];
}

interface SubmitterRow {
  name: string;
  profileName: string;
  bids: number;
  invites: number;
  connects: number;
  won: number;
  lost: number;
  onboardedHours: number;
  conversionRate?: number;
  connectsPerClient?: number;
  estimatedCost: number;
}

interface ConnectPurchase {
  id: string;
  purchasedAt: string;
  connectsAmount: number;
  totalCost: number;
  currency: string;
  notes: string | null;
}

const EMPTY_PURCHASE = { purchasedAt: "", connectsAmount: "", totalCost: "", currency: "USD", notes: "" };

/** Bidding/Invites card redesign (Part: Connects usage monitoring, 2026-10-28,
 *  explicit user request against a supplied reference mockup — "Dark SaaS
 *  Bidding and Invites Dashboard": a header with an icon badge + date-range
 *  pill, a progress ring + trend chart, three circular "milestone" stats
 *  (Won/Lost/Viewed), a row of four square mini-stats, and a closing cost
 *  row. The pieces below are purpose-built for this one layout rather than
 *  routed through chart-kit's existing generic primitives (StatTile,
 *  RadialProgress) because the mockup's center-of-ring content (label + big
 *  number + delta, stacked) and the icon-badge shapes don't fit those
 *  components' existing contracts without changing them for every other
 *  caller. */

function deltaPill(deltaPct: number | null | undefined) {
  if (deltaPct === null || deltaPct === undefined) return null;
  const good = deltaPct >= 0;
  return (
    <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[11px] font-medium ${good ? "bg-good/15 text-good" : "bg-bad/15 text-bad"}`}>
      {good ? "↑" : "↓"} {Math.abs(deltaPct).toFixed(0)}%
    </span>
  );
}

function formatDateShort(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

/** One icon-badge stat used for both the 3-wide "milestone" row (Won/Lost/
 *  Viewed — `shape="circle"`) and the 4-wide mini-stat row plus the closing
 *  cost row (`shape="square"`). `deltaPct` and `caption` are mutually
 *  exclusive in the reference mockup (a tile shows one or neither, never
 *  both) but nothing here enforces that — callers just pass what they have. */
function IconStat({
  icon,
  iconColor,
  shape = "square",
  label,
  value,
  deltaPct,
  caption,
  detail,
}: {
  icon: ReactNode;
  iconColor: string;
  shape?: "circle" | "square";
  label: string;
  value: string;
  deltaPct?: number | null;
  caption?: string;
  /** When given, the tile becomes clickable and opens a modal with this
   *  content (Part: Upwork earnings tracking, 2026-10-28) — same "clickable
   *  tile opens a modal with the data" contract as StatTile's own `detail`
   *  prop in chart-kit.tsx; added here specifically so the Won tile can
   *  surface its earnings breakdown without a separate panel elsewhere on
   *  the app (explicit user correction — earnings belong inside this stat,
   *  "not any where else"). */
  detail?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const body = (
    <div className="card flex items-center gap-3 p-4">
      <span
        aria-hidden
        className={`flex h-11 w-11 shrink-0 items-center justify-center ${shape === "circle" ? "rounded-full" : "rounded-xl"}`}
        style={{ background: `color-mix(in srgb, ${iconColor} 16%, transparent)`, color: iconColor }}
      >
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-xs text-ink/55">{label}</div>
        <div className="flex items-center gap-2">
          <span className="text-xl font-semibold tracking-tight text-ink">{value}</span>
          {deltaPill(deltaPct)}
        </div>
        {caption && <div className="mt-0.5 truncate text-[11px] text-ink/45">{caption}</div>}
      </div>
    </div>
  );
  if (!detail) return body;
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="block w-full text-left">
        {body}
      </button>
      <Modal open={open} onOpenChange={setOpen} title={label} contentClassName="w-full max-w-md">
        {detail}
      </Modal>
    </>
  );
}

/** The ring + trend-chart row at the top of each card. The ring's fill
 *  percentage is the real conversion rate (won ÷ total) for that type —
 *  not a decorative/arbitrary fill — with the raw count, label, and
 *  period-over-period delta stacked in the center. The chart to its right
 *  plots the same real monthly bids/invites counts the "Monthly trend"
 *  table further down this page is built from, so the two can never
 *  disagree. */
function PerformanceRing({
  color,
  totalLabel,
  totalValue,
  deltaPct,
  ringPercent,
  chartData,
  chartDataKey,
  legendLabel,
}: {
  color: string;
  totalLabel: string;
  totalValue: number;
  deltaPct: number | null;
  ringPercent: number;
  chartData: { month: string; bids: number; invites: number }[];
  chartDataKey: "bids" | "invites";
  legendLabel: string;
}) {
  const clamped = Math.max(0, Math.min(100, ringPercent));
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
      <div className="relative mx-auto h-[180px] w-[180px] shrink-0 sm:mx-0">
        <ResponsiveContainer width="100%" height="100%">
          <RadialBarChart data={[{ value: clamped }]} innerRadius="78%" outerRadius="100%" startAngle={90} endAngle={-270} barSize={12}>
            <RadialBar dataKey="value" cornerRadius={8} fill={color} background={{ fill: "var(--chart-grid)" }} isAnimationActive={false} />
          </RadialBarChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-1">
          <span className="text-xs text-ink/55">{totalLabel}</span>
          <span className="text-3xl font-bold tracking-tight text-ink">{num(totalValue)}</span>
          {deltaPill(deltaPct)}
        </div>
      </div>
      <div className="min-w-0 flex-1">
        <div className="mb-1 flex items-center gap-1.5 text-xs text-ink/55">
          <span aria-hidden className="h-2 w-2 rounded-full" style={{ background: color }} />
          {legendLabel}
        </div>
        {chartData.length > 1 ? (
          <ResponsiveContainer width="100%" height={160}>
            <AreaChart data={chartData}>
              <defs>
                <linearGradient id={`perf-ring-${chartDataKey}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={color} stopOpacity={0.35} />
                  <stop offset="100%" stopColor={color} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid {...GRID_PROPS} />
              <XAxis dataKey="month" {...AXIS_PROPS} />
              <Tooltip {...TOOLTIP_STYLE} />
              <Area type="monotone" dataKey={chartDataKey} stroke={color} strokeWidth={2} fill={`url(#perf-ring-${chartDataKey})`} dot={false} isAnimationActive={false} />
            </AreaChart>
          </ResponsiveContainer>
        ) : (
          <div className="flex h-[160px] items-center justify-center text-xs text-ink/40">Not enough history yet for a trend line</div>
        )}
      </div>
    </div>
  );
}

const { Gavel: GavelIcon, Mail: MailIcon, Check: CheckIcon, X: XIcon, Eye: EyeIcon, Users: UsersIcon, Link: LinkIcon, Coins: CoinsIcon, Wallet: WalletIcon, Tag: TagIcon, User: UserIcon } = DashboardIcons;

export function UpworkTab() {
  const [dateRange, setDateRange] = useDashboardDateRange();
  const query = dashboardRangeToQuery(dateRange);
  const isAdmin = getCurrentUser()?.role === "ADMIN";
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState(EMPTY_PURCHASE);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  // Caps the purchase ledger at 5 rows by default (Part: premium dark
  // theme pass v4, 2026-10-19, explicit user request — "the purchase
  // ledger in the upwork tab should be collapsed, it should only show 5
  // entries by default"), same "cap long lists, View all" convention used
  // elsewhere in the app rather than always rendering every purchase ever
  // recorded.
  const PURCHASE_PAGE_SIZE = 5;
  const [showAllPurchases, setShowAllPurchases] = useState(false);

  const kpisQuery = useQuery({ queryKey: ["dc-upwork-kpis", query], queryFn: () => api.getDashboardUpworkKpis(query) as Promise<UpworkKpis> });
  const monthlyQuery = useQuery({ queryKey: ["dc-upwork-monthly"], queryFn: () => api.getDashboardUpworkMonthly() as Promise<MonthlyRow[]> });
  const submittersQuery = useQuery({
    queryKey: ["dc-upwork-submitters", query],
    queryFn: () => api.getDashboardUpworkSubmitters(query) as Promise<SubmitterRow[]>,
  });
  const purchasesQuery = useQuery({
    queryKey: ["dc-upwork-purchases"],
    queryFn: () => api.getDashboardUpworkConnectPurchases() as Promise<ConnectPurchase[]>,
  });
  // Part: Upwork Requests, 2026-10-01 -- reuses this page's own shared date
  // range control rather than a second filter bar, per the feature's UI/UX
  // requirement to stay consistent with existing dashboard components.
  const requestsQuery = useQuery({
    queryKey: ["dc-upwork-requests-summary", query],
    queryFn: () => api.getUpworkRequestsDashboardSummary(query) as Promise<UpworkRequestsSummary>,
  });

  const createMutation = useMutation({
    mutationFn: () =>
      api.createDashboardUpworkConnectPurchase({
        purchasedAt: draft.purchasedAt,
        connectsAmount: Number(draft.connectsAmount),
        totalCost: Number(draft.totalCost),
        currency: draft.currency || "USD",
        notes: draft.notes || undefined,
      }),
    onSuccess: () => {
      setDraft(EMPTY_PURCHASE);
      setShowForm(false);
      setError(null);
      queryClient.invalidateQueries({ queryKey: ["dc-upwork-purchases"] });
      queryClient.invalidateQueries({ queryKey: ["dc-upwork-kpis"] });
      queryClient.invalidateQueries({ queryKey: ["dc-upwork-monthly"] });
    },
    onError: (err) => setError((err as Error).message),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.deleteDashboardUpworkConnectPurchase(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["dc-upwork-purchases"] });
      queryClient.invalidateQueries({ queryKey: ["dc-upwork-kpis"] });
      queryClient.invalidateQueries({ queryKey: ["dc-upwork-monthly"] });
    },
  });

  const [importNotice, setImportNotice] = useState<string | null>(null);
  const importMutation = useMutation({
    mutationFn: (csv: string) => api.importDashboardUpworkConnectPurchases(csv),
    onSuccess: (result) => {
      setError(null);
      const skippedNote = result.skipped.length > 0 ? ` ${result.skipped.length} row(s) skipped (see console).` : "";
      setImportNotice(
        `Imported ${result.imported} new purchase(s) from ${result.connectRowsFound} connect transaction(s) found${
          result.alreadyImported > 0 ? ` (${result.alreadyImported} already on record)` : ""
        }.${skippedNote}`,
      );
      if (result.skipped.length > 0) console.warn("Upwork connect-purchase import: skipped rows", result.skipped);
      queryClient.invalidateQueries({ queryKey: ["dc-upwork-purchases"] });
      queryClient.invalidateQueries({ queryKey: ["dc-upwork-kpis"] });
      queryClient.invalidateQueries({ queryKey: ["dc-upwork-monthly"] });
    },
    onError: (err) => setError((err as Error).message),
  });

  function handleImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-selecting the same file later
    if (!file) return;
    setError(null);
    setImportNotice(null);
    const reader = new FileReader();
    reader.onload = () => importMutation.mutate(String(reader.result ?? ""));
    reader.onerror = () => setError("Could not read that file.");
    reader.readAsText(file);
  }

  function submitPurchase(e: React.FormEvent) {
    e.preventDefault();
    if (!draft.purchasedAt || !draft.connectsAmount || !draft.totalCost) {
      setError("Date, connects amount, and total cost are all required.");
      return;
    }
    createMutation.mutate();
  }

  const kpis = kpisQuery.data;
  const monthly = monthlyQuery.data ?? [];
  const submitters = submittersQuery.data ?? [];
  const purchases = purchasesQuery.data ?? [];

  // This-month summary for the ledger card (Part: Dashboard Center,
  // 2026-09-30 — "after uploading the csv the summary should be there").
  // Reuses the same monthly rollup the Monthly Trend table below is built
  // from, just picked out for the current calendar month, so this can never
  // disagree with that table.
  const now = new Date();
  const currentMonthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const thisMonth = monthly.find((m) => m.month === currentMonthKey);

  return (
    <DashboardCenterShell
      compact
      title="Upwork Dashboard"
      dateRange={dateRange}
      onDateRangeChange={setDateRange}
      onRefresh={() => {
        kpisQuery.refetch();
        monthlyQuery.refetch();
        submittersQuery.refetch();
        purchasesQuery.refetch();
        requestsQuery.refetch();
      }}
      refreshing={kpisQuery.isFetching || monthlyQuery.isFetching || submittersQuery.isFetching || purchasesQuery.isFetching || requestsQuery.isFetching}
    >
      {kpisQuery.isLoading && <SkeletonCard className="h-32" />}
      {kpisQuery.error && <ErrorState message={(kpisQuery.error as Error).message} onRetry={() => kpisQuery.refetch()} />}

      {/* Bidding/Invites cards, redesigned to match a supplied reference
          mockup (Part: Connects usage monitoring, 2026-10-28, explicit user
          request: "i have downloaded an image for the invites and bidding
          tab ui... get the ui done as it" — "Dark SaaS Bidding and Invites
          Dashboard.png"). Structure per card: header (icon badge, title,
          subtitle, real resolved date range) → progress ring (conversion
          rate) + trend chart → three circular milestone stats (Won/Lost/
          Viewed) → four square mini-stats (In Interview/Connects Used/
          Average Connects/Connect Cost) → closing cost-per-unit row. Blue
          for Bidding, green for Invites throughout, matching the mockup;
          every number is real data, not decorative — see PerformanceRing's
          and IconStat's own docblocks above for what each piece actually
          plots. */}
      {kpis && (
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="card flex flex-col gap-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex items-start gap-3">
                <span
                  aria-hidden
                  className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-white"
                  style={{ background: "var(--series-1)" }}
                >
                  <GavelIcon />
                </span>
                <div>
                  <h2 className="text-base font-semibold tracking-tight text-ink">Bidding Stats</h2>
                  <p className="text-xs text-ink/55">Performance overview of your bids this period</p>
                </div>
              </div>
              <span className="rounded-full border border-[var(--line)] px-3 py-1.5 text-xs text-ink/60">
                {formatDateShort(kpis.range.from)} – {formatDateShort(kpis.range.to)}
              </span>
            </div>

            <PerformanceRing
              color="var(--series-1)"
              totalLabel="Total Bids"
              totalValue={kpis.totalBids}
              deltaPct={kpis.totalBidsDeltaPct}
              ringPercent={kpis.conversionRateBidding ?? 0}
              chartData={monthly}
              chartDataKey="bids"
              legendLabel="Bids"
            />

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <IconStat
                shape="circle"
                icon={<CheckIcon />}
                iconColor="rgb(var(--good-rgb))"
                label="Client Won"
                value={num(kpis.wonBids)}
                deltaPct={kpis.wonBidsDeltaPct}
                caption={`Success rate: ${pct(kpis.conversionRateBidding)}`}
                detail={
                  <MetricDetail
                    definition="Earnings for bids won in this period, auto-matched against Upwork's own transaction ledger by client name -- never manually entered."
                    rows={[
                      { label: "Clients Won", value: num(kpis.wonBids) },
                      { label: "Total Client Earnings", value: money(kpis.biddingTotalClientEarnings) },
                      { label: "Total Upwork Service Fees", value: money(kpis.biddingTotalServiceFees) },
                      { label: "Total Net Earnings", value: money(kpis.biddingTotalNetEarnings) },
                    ]}
                    footnote={
                      kpis.biddingEarningsMissingCount > 0
                        ? `${kpis.biddingEarningsMissingCount} won bid(s) have no matching Upwork transaction yet (either the sync hasn't caught up, or the client name doesn't match) -- excluded from the totals above.`
                        : undefined
                    }
                  />
                }
              />
              <IconStat
                shape="circle"
                icon={<XIcon />}
                iconColor="rgb(var(--bad-rgb))"
                label="Lost"
                value={num(kpis.lostBids)}
                deltaPct={kpis.lostBidsDeltaPct}
              />
              <IconStat shape="circle" icon={<EyeIcon />} iconColor="#8b5cf6" label="Viewed" value={num(kpis.bidsViewed)} />
            </div>

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <IconStat
                icon={<UsersIcon />}
                iconColor="var(--series-1)"
                label="In Interview"
                value={num(kpis.bidsInDiscussion)}
                deltaPct={kpis.bidsInDiscussionDeltaPct}
              />
              <IconStat
                icon={<LinkIcon />}
                iconColor="#ec4899"
                label="Connects Used"
                value={num(kpis.connectsUsed)}
                caption={kpis.connectsUsedSource === "manual_entry" ? "From manual log" : kpis.connectsUsedSource === "real_ledger" ? "From sync start" : "Manual + synced"}
              />
              <IconStat icon={<CoinsIcon />} iconColor="var(--series-4)" label="Avg. Connects / Bid" value={num(kpis.avgConnectsPerBid)} />
              <IconStat
                icon={<WalletIcon />}
                iconColor="#6366f1"
                label="Connects Cost"
                value={money(kpis.connectCost)}
                caption={`${money(kpis.connectUnitCost)} per connect`}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <IconStat icon={<TagIcon />} iconColor="var(--ink-muted)" label="Cost / Bid" value={money(kpis.costPerBid)} />
              <IconStat icon={<UserIcon />} iconColor="var(--ink-muted)" label="Cost / Client" value={money(kpis.costPerClientBids)} />
            </div>
          </div>

          <div className="card flex flex-col gap-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex items-start gap-3">
                <span
                  aria-hidden
                  className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-white"
                  style={{ background: "var(--series-3)" }}
                >
                  <MailIcon />
                </span>
                <div>
                  <h2 className="text-base font-semibold tracking-tight text-ink">Invites Stats</h2>
                  <p className="text-xs text-ink/55">Performance overview of your invites this period</p>
                </div>
              </div>
              <span className="rounded-full border border-[var(--line)] px-3 py-1.5 text-xs text-ink/60">
                {formatDateShort(kpis.range.from)} – {formatDateShort(kpis.range.to)}
              </span>
            </div>

            <PerformanceRing
              color="var(--series-3)"
              totalLabel="Total Invites"
              totalValue={kpis.totalInvites}
              deltaPct={kpis.totalInvitesDeltaPct}
              ringPercent={kpis.conversionRateInvites ?? 0}
              chartData={monthly}
              chartDataKey="invites"
              legendLabel="Invites"
            />

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <IconStat
                shape="circle"
                icon={<CheckIcon />}
                iconColor="rgb(var(--good-rgb))"
                label="Client Won"
                value={num(kpis.wonInvites)}
                deltaPct={kpis.wonInvitesDeltaPct}
                caption={`Win rate: ${pct(kpis.conversionRateInvites)}`}
                detail={
                  <MetricDetail
                    definition="Earnings for invites won in this period, auto-matched against Upwork's own transaction ledger by client name -- never manually entered."
                    rows={[
                      { label: "Clients Won", value: num(kpis.wonInvites) },
                      { label: "Total Client Earnings", value: money(kpis.inviteTotalClientEarnings) },
                      { label: "Total Upwork Service Fees", value: money(kpis.inviteTotalServiceFees) },
                      { label: "Total Net Earnings", value: money(kpis.inviteTotalNetEarnings) },
                    ]}
                    footnote={
                      kpis.inviteEarningsMissingCount > 0
                        ? `${kpis.inviteEarningsMissingCount} won invite(s) have no matching Upwork transaction yet (either the sync hasn't caught up, or the client name doesn't match) -- excluded from the totals above.`
                        : undefined
                    }
                  />
                }
              />
              <IconStat
                shape="circle"
                icon={<XIcon />}
                iconColor="rgb(var(--bad-rgb))"
                label="Lost"
                value={num(kpis.lostInvites)}
                deltaPct={kpis.lostInvitesDeltaPct}
              />
              <IconStat shape="circle" icon={<EyeIcon />} iconColor="#8b5cf6" label="Viewed" value={num(kpis.invitesViewed)} />
            </div>

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <IconStat
                icon={<UsersIcon />}
                iconColor="var(--series-3)"
                label="In Interview"
                value={num(kpis.invitesInDiscussion)}
                deltaPct={kpis.invitesInDiscussionDeltaPct}
              />
              <IconStat
                icon={<LinkIcon />}
                iconColor="#ec4899"
                label="Connects Used"
                value={num(kpis.connectsUsedInvites)}
                caption="From boosted-profile billable clicks"
              />
              <IconStat icon={<CoinsIcon />} iconColor="var(--series-4)" label="Avg. Connects / Invite" value={num(kpis.avgConnectsPerInvite)} />
              <IconStat
                icon={<WalletIcon />}
                iconColor="#6366f1"
                label="Connect Cost"
                value={money(kpis.inviteConnectCost)}
                caption={`${money(kpis.connectUnitCost)} per connect`}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <IconStat icon={<TagIcon />} iconColor="var(--ink-muted)" label="Cost / Invite" value={money(kpis.costPerInvite)} />
              <IconStat icon={<UserIcon />} iconColor="var(--ink-muted)" label="Cost / Client" value={money(kpis.costPerClientInvites)} />
            </div>
          </div>
        </div>
      )}

      {/* Real-chart pass, round 2 (Part: Dashboard Center, 2026-10-20,
          explicit user request — "these are less charts and graphs, I need
          more"). Won/Lost/Viewed/In Discussion are each a distinct
          UpworkProposal status (confirmed by the KPI strip's own
          MetricDetail text above: "status WON", "status LOST", "status
          Viewed", "status In Discussion") — mutually exclusive by
          definition, so safe to chart as a donut. "Other" absorbs every bid
          not in one of those four named statuses (e.g. freshly submitted,
          still pending) rather than silently dropping it — the center total
          always matches totalBids/totalInvites exactly. */}
      {kpis && kpis.totalBids > 0 && (
        <div className="grid gap-4 lg:grid-cols-2">
          <SectionCard title="Bidding Status" subtitle={`${num(kpis.totalBids)} bids this period`}>
            <DonutBreakdown
              data={[
                { label: "Won", value: kpis.wonBids, color: "rgb(var(--good-rgb))" },
                { label: "Lost", value: kpis.lostBids, color: "rgb(var(--bad-rgb))" },
                { label: "Viewed", value: kpis.bidsViewed, color: SERIES[1] },
                { label: "In Discussion", value: kpis.bidsInDiscussion, color: SERIES[2] },
                { label: "Other", value: Math.max(0, kpis.totalBids - kpis.wonBids - kpis.lostBids - kpis.bidsViewed - kpis.bidsInDiscussion), color: SERIES[3] },
              ]}
              centerValue={num(kpis.totalBids)}
              centerLabel="Total bids"
            />
          </SectionCard>
          {kpis.totalInvites > 0 && (
            <SectionCard title="Invite Status" subtitle={`${num(kpis.totalInvites)} invites this period`}>
              <DonutBreakdown
                data={[
                  { label: "Won", value: kpis.wonInvites, color: "rgb(var(--good-rgb))" },
                  { label: "Lost", value: kpis.lostInvites, color: "rgb(var(--bad-rgb))" },
                  { label: "In Discussion", value: kpis.invitesInDiscussion, color: SERIES[2] },
                  { label: "Other", value: Math.max(0, kpis.totalInvites - kpis.wonInvites - kpis.lostInvites - kpis.invitesInDiscussion), color: SERIES[3] },
                ]}
                centerValue={num(kpis.totalInvites)}
                centerLabel="Total invites"
              />
            </SectionCard>
          )}
        </div>
      )}

      <SectionCard title="Requests" expandable>
        {requestsQuery.isLoading && <SkeletonCard className="h-32" />}
        {requestsQuery.error && <ErrorState message={(requestsQuery.error as Error).message} onRetry={() => requestsQuery.refetch()} />}
        {requestsQuery.data && (
          <>
            <KpiStrip>
              <StatTile label="Requested Hours" value={num(requestsQuery.data.requestedHours)} />
              <StatTile label="Bidding Hours" value={num(requestsQuery.data.biddingHours)} />
              <StatTile label="Invite Hours" value={num(requestsQuery.data.inviteHours)} />
              <StatTile label="Total Onboarded" value={num(requestsQuery.data.totalOnboardedHours)} tone="good" />
              <StatTile label="Remaining Target" value={num(requestsQuery.data.remainingHours)} tone={requestsQuery.data.remainingHours > 0 ? "gold" : "good"} />
              <StatTile label="Pending Review" value={num(requestsQuery.data.pendingReview)} />
              <StatTile label="Approved / Rejected" value={`${num(requestsQuery.data.approvedCount)} / ${num(requestsQuery.data.rejectedCount)}`} />
            </KpiStrip>

            {requestsQuery.data.byBusinessDeveloper.length > 0 && (
              <div className="mt-4">
                <p className="mb-1.5 text-xs font-medium text-ink/60">By Business Developer (the target owner)</p>
                <DataTable
                  rowKey={(r) => r.businessDeveloperId}
                  rows={requestsQuery.data.byBusinessDeveloper}
                  columns={[
                    { key: "name", header: "Business Developer", render: (r) => r.name, sortValue: (r) => r.name },
                    { key: "requestedHours", header: "Target Hours", numeric: true, render: (r) => num(r.requestedHours), sortValue: (r) => r.requestedHours },
                    { key: "achievedHours", header: "Achieved", numeric: true, render: (r) => num(r.achievedHours), sortValue: (r) => r.achievedHours },
                  ]}
                />
              </div>
            )}

            {requestsQuery.data.byProjectManager.length > 0 && (
              <div className="mt-4">
                <p className="mb-1.5 text-xs font-medium text-ink/60">By Project Manager (who asked)</p>
                <DataTable
                  rowKey={(r) => r.projectManagerId}
                  rows={requestsQuery.data.byProjectManager}
                  columns={[
                    { key: "name", header: "Project Manager", render: (r) => r.name, sortValue: (r) => r.name },
                    { key: "requestedHours", header: "Approved Requested Hours", numeric: true, render: (r) => num(r.requestedHours), sortValue: (r) => r.requestedHours },
                  ]}
                />
              </div>
            )}

            {requestsQuery.data.byProfile.length > 0 && (
              <div className="mt-4">
                <DataTable
                  rowKey={(r) => r.profileName}
                  rows={requestsQuery.data.byProfile}
                  columns={[
                    { key: "profileName", header: "Profile/ID", render: (r) => r.profileName, sortValue: (r) => r.profileName },
                    { key: "requestedHours", header: "Requested", numeric: true, render: (r) => num(r.requestedHours), sortValue: (r) => r.requestedHours },
                    { key: "achievedHours", header: "Achieved", numeric: true, render: (r) => num(r.achievedHours), sortValue: (r) => r.achievedHours },
                  ]}
                />
              </div>
            )}

            {requestsQuery.data.byProjectManager.length === 0 && (
              <EmptyState title="No approved requests in this period" description="Requests are created from the Requests tab under Upwork Proposals." />
            )}
          </>
        )}
      </SectionCard>

      <SectionCard
        title="Connect purchase ledger"
        actions={
          isAdmin ? (
            <div className="flex items-center gap-2">
              <label className="cursor-pointer rounded-md border border-[var(--line)] px-2.5 py-1 text-xs text-ink/70 transition-colors hover:bg-ink/5">
                {importMutation.isPending ? "Importing…" : "Upload CSV"}
                <input type="file" accept=".csv,text/csv" onChange={handleImportFile} disabled={importMutation.isPending} className="hidden" />
              </label>
              <Button variant="secondary" size="sm" onClick={() => setShowForm((v) => !v)}>
                {showForm ? "Cancel" : "Add purchase"}
              </Button>
            </div>
          ) : undefined
        }
      >
        {importNotice && (
          <div className="mb-3 rounded-lg border border-[rgb(var(--good-rgb)/0.4)] bg-[rgb(var(--good-rgb)/0.06)] px-3 py-2 text-xs text-good">
            {importNotice}
          </div>
        )}
        {error && !showForm && (
          <div className="mb-3 rounded-lg border border-[rgb(var(--bad-rgb)/0.4)] bg-[rgb(var(--bad-rgb)/0.06)] px-3 py-2 text-xs text-error">{error}</div>
        )}

        <div className="mb-4 grid grid-cols-3 gap-3">
          <StatTile
            label="Connects Purchased (This Month)"
            value={num(thisMonth?.connectsPurchased ?? 0)}
            detail={
              <MetricDetail
                definition="Sum of every UpworkConnectPurchase.connectsAmount recorded this calendar month, whether entered manually or via CSV import."
                rows={[{ label: "This month", value: num(thisMonth?.connectsPurchased ?? 0) }]}
              />
            }
          />
          <StatTile
            label="Spent on Connects (This Month)"
            value={money(thisMonth?.purchaseCost ?? 0)}
            detail={
              <MetricDetail
                definition="Sum of every UpworkConnectPurchase.totalCost recorded this calendar month."
                rows={[{ label: "This month", value: money(thisMonth?.purchaseCost ?? 0) }]}
              />
            }
          />
          <StatTile
            label="Connects Used on Bidding (This Month)"
            value={num(thisMonth?.connectsUsed ?? 0)}
            detail={
              <MetricDetail
                definition="Sum of UpworkProposal.connects across every bid submitted this calendar month — invites never consume connects, so this is bidding usage specifically."
                rows={[{ label: "This month", value: num(thisMonth?.connectsUsed ?? 0) }]}
              />
            }
          />
        </div>

        {showForm && (
          <form onSubmit={submitPurchase} className="mb-4 grid grid-cols-2 gap-3 rounded-lg border border-[var(--line)] p-3 sm:grid-cols-5">
            <label className="flex flex-col gap-1 text-[11px] text-ink/60">
              Date
              <Input type="date" value={draft.purchasedAt} onChange={(e) => setDraft({ ...draft, purchasedAt: e.target.value })} />
            </label>
            <label className="flex flex-col gap-1 text-[11px] text-ink/60">
              Connects
              <Input
                type="number"
                min="1"
                value={draft.connectsAmount}
                onChange={(e) => setDraft({ ...draft, connectsAmount: e.target.value })}
                placeholder="e.g. 600"
              />
            </label>
            <label className="flex flex-col gap-1 text-[11px] text-ink/60">
              Total cost
              <Input
                type="number"
                min="0"
                step="0.01"
                value={draft.totalCost}
                onChange={(e) => setDraft({ ...draft, totalCost: e.target.value })}
                placeholder="e.g. 60.00"
              />
            </label>
            <label className="flex flex-col gap-1 text-[11px] text-ink/60">
              Currency
              <Input value={draft.currency} onChange={(e) => setDraft({ ...draft, currency: e.target.value })} />
            </label>
            <label className="flex flex-col gap-1 text-[11px] text-ink/60">
              Notes (optional)
              <Input value={draft.notes} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} />
            </label>
            <div className="col-span-2 flex items-end gap-2 sm:col-span-5">
              <Button type="submit" size="sm" loading={createMutation.isPending}>
                Save purchase
              </Button>
              {error && <span className="text-xs text-error">{error}</span>}
            </div>
          </form>
        )}

        {purchasesQuery.isLoading && <SkeletonCard className="h-24" />}
        {purchasesQuery.error && <ErrorState message={(purchasesQuery.error as Error).message} onRetry={() => purchasesQuery.refetch()} />}
        {!purchasesQuery.isLoading && purchases.length === 0 && (
          <EmptyState title="No connect purchases recorded yet" description="Add one above to unlock Upwork's dollar-cost metrics." />
        )}
        {purchases.length > 0 && (
          <>
            <DataTable
              showSummary
              rowKey={(r) => r.id}
              rows={showAllPurchases ? purchases : purchases.slice(0, PURCHASE_PAGE_SIZE)}
              columns={[
                { key: "purchasedAt", header: "Date", render: (r) => dateTime(r.purchasedAt), sortValue: (r) => new Date(r.purchasedAt).getTime() },
                { key: "connectsAmount", header: "Connects", render: (r) => num(r.connectsAmount), numeric: true, sortValue: (r) => r.connectsAmount },
                { key: "totalCost", header: "Cost", render: (r) => money(r.totalCost, r.currency), numeric: true, sortValue: (r) => r.totalCost },
                { key: "notes", header: "Notes", render: (r) => r.notes ?? "—", sortValue: (r) => r.notes },
                {
                  key: "actions",
                  header: "",
                  render: (r) =>
                    isAdmin ? (
                      <button
                        type="button"
                        onClick={() => confirm("Delete this purchase record?") && deleteMutation.mutate(r.id)}
                        className="text-xs text-error hover:underline"
                      >
                        Delete
                      </button>
                    ) : null,
                },
              ]}
            />
            {purchases.length > PURCHASE_PAGE_SIZE && (
              <button
                type="button"
                onClick={() => setShowAllPurchases((v) => !v)}
                className="mt-3 text-xs text-accent hover:underline"
              >
                {showAllPurchases ? "Show less" : `View all ${purchases.length} →`}
              </button>
            )}
          </>
        )}
      </SectionCard>

      {monthlyQuery.isLoading && <SkeletonCard className="h-56" />}
      {monthlyQuery.error && <ErrorState message={(monthlyQuery.error as Error).message} onRetry={() => monthlyQuery.refetch()} />}
      {!monthlyQuery.isLoading && monthly.length === 0 && (
        <SectionCard title="Monthly trend" subtitle="Last 12 months">
          <EmptyState title="No Upwork activity in the last 12 months" />
        </SectionCard>
      )}
      {monthly.length > 0 && (
        // Real data this whole chart already had: getMonthlyTable's rows,
        // previously rendered as a table only (Part: premium dark theme
        // pass v4, 2026-10-19, explicit user request — "add some graphs...
        // represent the data more better"). Bids/Invites as grouped bars
        // ("how much per period" -> columns, not a line, since each month
        // is a discrete count, not a continuous measure) — Clients Won and
        // the two cost figures stay in the table view rather than crowding
        // a third/fourth bar onto the same chart.
        <ChartWithTable
          title="Monthly trend"
          subtitle="Last 12 months"
          expandable
          chart={
            <>
              <Legend items={[{ label: "Bids", color: SERIES[0] }, { label: "Invites", color: SERIES[1] }]} />
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={monthly}>
                  <CartesianGrid {...GRID_PROPS} />
                  <XAxis dataKey="month" {...AXIS_PROPS} />
                  <YAxis {...AXIS_PROPS} tickFormatter={formatCompact} allowDecimals={false} />
                  <Tooltip {...TOOLTIP_STYLE} />
                  <Bar dataKey="bids" name="Bids" fill={SERIES[0]} radius={[3, 3, 0, 0]} />
                  <Bar dataKey="invites" name="Invites" fill={SERIES[1]} radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </>
          }
          table={
            <DataTable
              rowKey={(r) => r.month}
              rows={monthly}
              columns={[
                { key: "month", header: "Month", render: (r) => r.month, sortValue: (r) => r.month },
                { key: "bids", header: "Bids", render: (r) => num(r.bids), numeric: true, sortValue: (r) => r.bids },
                { key: "invites", header: "Invites", render: (r) => num(r.invites), numeric: true, sortValue: (r) => r.invites },
                { key: "connectsUsed", header: "Connects Used", render: (r) => num(r.connectsUsed), numeric: true, sortValue: (r) => r.connectsUsed },
                { key: "clientsWon", header: "Clients Won", render: (r) => num(r.clientsWon), numeric: true, sortValue: (r) => r.clientsWon },
                { key: "estimatedUsageCost", header: "Est. Cost ($0.15/connect)", render: (r) => money(r.estimatedUsageCost), numeric: true, sortValue: (r) => r.estimatedUsageCost },
                { key: "purchaseCost", header: "Actually Invoiced", render: (r) => money(r.purchaseCost), numeric: true, sortValue: (r) => r.purchaseCost },
              ]}
            />
          }
        />
      )}

      {submittersQuery.isLoading && <SkeletonCard className="h-32" />}
      {submittersQuery.error && <ErrorState message={(submittersQuery.error as Error).message} onRetry={() => submittersQuery.refetch()} />}
      {!submittersQuery.isLoading && submitters.length === 0 && (
        <SectionCard title="By submitter" subtitle="Grouped by free-text submitter name + profile">
          <EmptyState title="No submissions in this period" />
        </SectionCard>
      )}
      {submitters.length > 0 && (
        <ChartWithTable
          title="By submitter"
          expandable
          chart={
            <ResponsiveContainer width="100%" height={Math.max(140, submitters.length * 40)}>
              <BarChart
                data={[...submitters].sort((a, b) => b.won - a.won)}
                layout="vertical"
                margin={{ top: 4, right: 24, left: 8, bottom: 4 }}
              >
                <CartesianGrid {...GRID_PROPS} vertical horizontal={false} />
                <XAxis type="number" allowDecimals={false} {...AXIS_PROPS} />
                <YAxis type="category" dataKey="name" width={140} {...AXIS_PROPS} />
                <Tooltip {...TOOLTIP_STYLE} />
                <Bar dataKey="won" name="Won" fill="rgb(var(--good-rgb))" radius={[0, 4, 4, 0]} maxBarSize={22} />
              </BarChart>
            </ResponsiveContainer>
          }
          table={
            <DataTable
              showSummary
              rowKey={(r) => `${r.name}-${r.profileName}`}
              rows={submitters}
              columns={[
                { key: "name", header: "Submitter", render: (r) => r.name, sortValue: (r) => r.name },
                { key: "profileName", header: "Profile/ID", render: (r) => r.profileName, sortValue: (r) => r.profileName },
                { key: "bids", header: "Bids", render: (r) => num(r.bids), numeric: true, sortValue: (r) => r.bids },
                { key: "invites", header: "Invites", render: (r) => num(r.invites), numeric: true, sortValue: (r) => r.invites },
                { key: "won", header: "Won", render: (r) => num(r.won), numeric: true, sortValue: (r) => r.won },
                { key: "lost", header: "Lost", render: (r) => num(r.lost), numeric: true, sortValue: (r) => r.lost },
                { key: "onboardedHours", header: "Onboarded Hours", render: (r) => num(r.onboardedHours), numeric: true, sortValue: (r) => r.onboardedHours },
                { key: "conversionRate", header: "Conv. Rate", render: (r) => pct(r.conversionRate), numeric: true, sortValue: (r) => r.conversionRate },
                { key: "estimatedCost", header: "Est. Cost ($0.15/connect)", render: (r) => money(r.estimatedCost), numeric: true, sortValue: (r) => r.estimatedCost },
              ]}
            />
          }
        />
      )}
    </DashboardCenterShell>
  );
}
