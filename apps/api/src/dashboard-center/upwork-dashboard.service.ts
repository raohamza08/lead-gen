import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../common/prisma/prisma.service";
import { DashboardRangeQuery, resolveDashboardRange, safeDivide, safeRate, percentDelta } from "./dashboard-center.util";
import { parseCsvRows } from "../leads/lead-import-mapping";
import { sumConnectsByCategory, connectsLedgerStartDate } from "../upwork-integration/connects-usage/connects-category.util";

export interface CreateConnectPurchaseInput {
  purchasedAt: string;
  connectsAmount: number;
  totalCost: number;
  currency?: string;
  notes?: string;
}

/** Upwork's flat per-connect price, as told to the app by the org
 *  (Part: Dashboard Center, 2026-09-30) — Upwork's own API exposes no
 *  pricing data, so this is a real-world fact supplied directly rather than
 *  something computable from any endpoint. Used as the fallback rate for
 *  every connect-cost calculation below when no `UpworkConnectPurchase`
 *  ledger entries exist yet; once real purchases are on record, their
 *  actual weighted-average cost (see `costPerConnectAsOf`) is used instead
 *  since it reflects whatever was actually paid (bulk pricing, promos,
 *  etc.), not just the flat rate. */
const DEFAULT_CONNECT_UNIT_COST_USD = 0.15;

@Injectable()
export class UpworkDashboardService {
  constructor(private readonly prisma: PrismaService) {}

  // ---- Connect purchase ledger (Part: Dashboard Center — the only source
  // of real Upwork $ cost; see UpworkConnectPurchase's own schema comment
  // for why this must be manually entered rather than assumed) ----

  async listConnectPurchases(orgId: string) {
    return this.prisma.upworkConnectPurchase.findMany({ where: { orgId }, orderBy: { purchasedAt: "desc" } });
  }

  async createConnectPurchase(orgId: string, userId: string, input: CreateConnectPurchaseInput) {
    return this.prisma.upworkConnectPurchase.create({
      data: {
        orgId,
        purchasedAt: new Date(input.purchasedAt),
        connectsAmount: input.connectsAmount,
        totalCost: input.totalCost,
        currency: input.currency ?? "USD",
        notes: input.notes,
        createdByUserId: userId,
      },
    });
  }

  async deleteConnectPurchase(orgId: string, id: string) {
    const row = await this.prisma.upworkConnectPurchase.findFirst({ where: { id, orgId } });
    if (!row) throw new NotFoundException("Connect purchase not found");
    await this.prisma.upworkConnectPurchase.delete({ where: { id } });
    return { deleted: true };
  }

  /**
   * Bulk-imports connect purchases straight from Upwork's own "Transaction
   * Report" CSV export (Part: Dashboard Center, 2026-09-30) — only rows
   * with Transaction type "Connects" are fee-deduction rows for a connect
   * purchase; the paired "Payment" rows are the card charge that funded it
   * and aren't a separate purchase. Idempotent by design: each row's real
   * Upwork "Transaction ID" is stored as `sourceTransactionId`, and
   * `skipDuplicates` means re-uploading the same or an overlapping export
   * (e.g. a fresh monthly report that overlaps the last one) never creates
   * duplicate ledger rows.
   */
  async importConnectPurchasesFromCsv(orgId: string, userId: string, csv: string) {
    let rows: Record<string, string>[];
    try {
      rows = parseCsvRows(csv);
    } catch (err) {
      throw new BadRequestException(`Could not parse this file as CSV: ${(err as Error).message}`);
    }

    const connectRows = rows.filter((r) => r["Transaction type"]?.trim() === "Connects");
    if (connectRows.length === 0) {
      throw new BadRequestException(
        'No "Connects" transaction rows found. Expected an Upwork Transaction Report export with a "Transaction type" column.',
      );
    }

    const purchases: {
      orgId: string;
      purchasedAt: Date;
      connectsAmount: number;
      totalCost: number;
      currency: string;
      sourceTransactionId: string;
      createdByUserId: string;
    }[] = [];
    const skipped: { row: number; reason: string }[] = [];

    connectRows.forEach((row, i) => {
      const rowNumber = i + 2; // header + 1-indexed
      const transactionId = row["Transaction ID"]?.trim();
      if (!transactionId) {
        skipped.push({ row: rowNumber, reason: "missing Transaction ID" });
        return;
      }
      const purchasedAt = new Date(row["Date"]);
      if (Number.isNaN(purchasedAt.getTime())) {
        skipped.push({ row: rowNumber, reason: `unparseable date "${row["Date"]}"` });
        return;
      }
      const connectsMatch = /^(\d[\d,]*)\s*Connects/i.exec(row["Transaction summary"]?.trim() ?? "");
      if (!connectsMatch) {
        skipped.push({ row: rowNumber, reason: `couldn't read connects amount from "${row["Transaction summary"]}"` });
        return;
      }
      const connectsAmount = Number(connectsMatch[1].replace(/,/g, ""));
      const amountRaw = Number((row["Amount $"] ?? "").replace(/,/g, ""));
      if (Number.isNaN(amountRaw)) {
        skipped.push({ row: rowNumber, reason: `unparseable amount "${row["Amount $"]}"` });
        return;
      }
      const totalCost = Math.abs(amountRaw);

      purchases.push({
        orgId,
        purchasedAt,
        connectsAmount,
        totalCost,
        currency: row["Currency"]?.trim() || "USD",
        sourceTransactionId: transactionId,
        createdByUserId: userId,
      });
    });

    const result = await this.prisma.upworkConnectPurchase.createMany({ data: purchases, skipDuplicates: true });

    return {
      rowsInFile: rows.length,
      connectRowsFound: connectRows.length,
      imported: result.count,
      alreadyImported: purchases.length - result.count,
      skipped,
    };
  }

  /** Cumulative weighted-average cost per connect, as of `asOf` -- total real
   *  money spent on connects up to that date divided by total connects
   *  bought up to that date (Part: schema comment on UpworkConnectPurchase
   *  explains why this, not per-transaction FIFO, is the chosen method).
   *  `undefined` means literally zero purchases are on record — not a 0
   *  cost, a genuinely unknown one. */
  private async costPerConnectAsOf(orgId: string, asOf: Date): Promise<number | undefined> {
    const agg = await this.prisma.upworkConnectPurchase.aggregate({
      where: { orgId, purchasedAt: { lte: asOf } },
      _sum: { totalCost: true, connectsAmount: true },
    });
    return safeDivide(agg._sum.totalCost ?? 0, agg._sum.connectsAmount ?? 0);
  }

  async getKpis(orgId: string, query: DashboardRangeQuery) {
    const { current, previous } = resolveDashboardRange(query);
    const where = { orgId, createdAt: { gte: current.from, lte: current.to } };

    const [
      totalBids, totalInvites, invitesAccepted, invitesRejected, won, lost, hasAnyPurchase, previousWon, previousBids,
      wonBids, wonInvites, lostBids, lostInvites, bidsViewed, bidsInDiscussion, invitesInDiscussion,
      ledgerStart, invitesViewed,
    ] = await Promise.all([
      this.prisma.upworkProposal.count({ where: { ...where, type: "BIDDING" } }),
      this.prisma.upworkProposal.count({ where: { ...where, type: "INVITE" } }),
      this.prisma.upworkProposal.count({ where: { ...where, type: "INVITE", status: { in: ["IN_DISCUSSION", "TEST_TASK", "MEETING", "FOLLOW_UP_1", "FOLLOW_UP_2", "FOLLOW_UP_3", "WON"] } } }),
      this.prisma.upworkProposal.count({ where: { ...where, type: "INVITE", status: "LOST" } }),
      this.prisma.upworkProposal.count({ where: { ...where, status: "WON" } }),
      this.prisma.upworkProposal.count({ where: { ...where, status: "LOST" } }),
      this.prisma.upworkConnectPurchase.count({ where: { orgId } }),
      previous ? this.prisma.upworkProposal.count({ where: { orgId, status: "WON", createdAt: { gte: previous.from, lte: previous.to } } }) : Promise.resolve(undefined),
      previous ? this.prisma.upworkProposal.count({ where: { orgId, type: "BIDDING", createdAt: { gte: previous.from, lte: previous.to } } }) : Promise.resolve(undefined),
      // Per-type win/loss/pipeline breakdown (Part: Upwork Dashboard KPI
      // split, 2026-10-13, explicit user request) — everything below is
      // additive to the combined clientsWon/clientsLost/conversionRate
      // above, which stay as-is for anything already reading them.
      this.prisma.upworkProposal.count({ where: { ...where, type: "BIDDING", status: "WON" } }),
      this.prisma.upworkProposal.count({ where: { ...where, type: "INVITE", status: "WON" } }),
      this.prisma.upworkProposal.count({ where: { ...where, type: "BIDDING", status: "LOST" } }),
      this.prisma.upworkProposal.count({ where: { ...where, type: "INVITE", status: "LOST" } }),
      this.prisma.upworkProposal.count({ where: { ...where, type: "BIDDING", status: "VIEWED" } }),
      // "In interview" has no dedicated status in UpworkProposalStatus —
      // mapped to IN_DISCUSSION, the stage between VIEWED/ACCEPTED and a
      // final WON/LOST outcome, which is the closest existing match. Flag
      // this mapping if "interview" was meant to mean something more
      // specific than ongoing back-and-forth.
      this.prisma.upworkProposal.count({ where: { ...where, type: "BIDDING", status: "IN_DISCUSSION" } }),
      this.prisma.upworkProposal.count({ where: { ...where, type: "INVITE", status: "IN_DISCUSSION" } }),
      connectsLedgerStartDate(this.prisma, orgId),
      // Symmetric with bidsViewed above (Part: Bidding/Invites stats parity,
      // 2026-10-28, explicit user request — "same attributes for both
      // invites and bidding portions"). VIEWED is a real status any
      // UpworkProposal can carry regardless of type -- Upwork just doesn't
      // surface a "client viewed" signal for invites the way it does for
      // bids (see UpworkProposalStatus's own schema comment), so this is
      // expected to read 0 in practice rather than a fabricated figure.
      this.prisma.upworkProposal.count({ where: { ...where, type: "INVITE", status: "VIEWED" } }),
    ]);

    // Connects source, hybrid by design (Part: Connects usage monitoring,
    // 2026-10-27, explicit user request to stop undercounting invite/boost
    // spend) -- the real synced Upwork ledger (UpworkConnectsTransaction)
    // only has history from whenever this org's Connects-usage sync first
    // ran (confirmed live: no 2-year backfill actually came back from
    // Upwork's API, just real history from that point forward), so any
    // part of the requested period before that falls back to the manually
    // -entered UpworkProposal.connects field exactly as before. No gap, no
    // double-count: the manual query is bounded to end exactly where the
    // real ledger's coverage begins.
    const manualBiddingAgg = await this.prisma.upworkProposal.aggregate({
      where: {
        orgId,
        type: "BIDDING",
        createdAt:
          ledgerStart && ledgerStart <= current.to ? { gte: current.from, lt: ledgerStart } : { gte: current.from, lte: current.to },
      },
      _sum: { connects: true },
    });
    const realCategoryTotals =
      ledgerStart && ledgerStart <= current.to
        ? await sumConnectsByCategory(this.prisma, orgId, {
            gte: ledgerStart > current.from ? ledgerStart : current.from,
            lte: current.to,
          })
        : { bidding: 0, invite: 0, other: 0 };

    const connectsUsed = (manualBiddingAgg._sum.connects ?? 0) + realCategoryTotals.bidding;
    // Real invite spend has no manual-entry equivalent at all (the old
    // assumption was "invites cost no connects"), so this is simply 0 for
    // any part of the period the real ledger doesn't cover -- not
    // fabricated, not backfilled. Includes AD_BOOSTED_PROFILE_MFS ("Your
    // Boosted Profile received a billable click") alongside
    // PAID_INVITATION_BADGE -- explicit user correction, 2026-10-28: a
    // boosted profile is what draws in client invites, so its connects
    // spend is real invite-acquisition cost, not unrelated ad spend. See
    // connects-category.util.ts's own docblock.
    const connectsUsedInvites = realCategoryTotals.invite;

    // Real purchase history (if any) reflects what was actually paid; the
    // flat $0.15/connect rate is the fallback, not undefined -- see
    // DEFAULT_CONNECT_UNIT_COST_USD's own docblock for why this is now a
    // known fact rather than a genuinely unknown one.
    const actualCostPerConnect = hasAnyPurchase > 0 ? await this.costPerConnectAsOf(orgId, current.to) : undefined;
    const costPerConnect = actualCostPerConnect ?? DEFAULT_CONNECT_UNIT_COST_USD;
    const connectCost = connectsUsed * costPerConnect;
    const inviteConnectCost = connectsUsedInvites * costPerConnect;

    return {
      range: { from: current.from, to: current.to },
      totalBids,
      totalInvites,
      invitesAccepted,
      invitesRejected,
      clientsWon: won,
      previousClientsWon: previous ? previousWon : undefined,
      clientsWonDeltaPct: previous ? percentDelta(won, previousWon) : null,
      clientsLost: lost,
      wonBids,
      wonInvites,
      lostBids,
      lostInvites,
      conversionRateBidding: safeRate(wonBids, totalBids),
      conversionRateInvites: safeRate(wonInvites, totalInvites),
      bidsViewed,
      invitesViewed,
      bidsInDiscussion,
      invitesInDiscussion,
      connectsUsed,
      // Part: Connects usage monitoring, 2026-10-27 -- tells the frontend
      // (and its tooltips) whether connectsUsed for this period is pure
      // real-ledger data, pure legacy manual entry, or a blend of both
      // because the period straddles the day the real sync started.
      connectsUsedSource:
        !ledgerStart || ledgerStart > current.to
          ? "manual_entry"
          : ledgerStart <= current.from
            ? "real_ledger"
            : "hybrid",
      // Real invite-connects spend (PAID_INVITATION_BADGE + the boosted-
      // profile billable-click spend that draws invites in) -- did not
      // exist as a tracked figure before the real Connects ledger synced;
      // 0 for any period entirely before that, by design, not an error.
      connectsUsedInvites,
      inviteConnectCost,
      costPerInvite: safeDivide(inviteConnectCost, totalInvites),
      avgConnectsPerInvite: safeDivide(connectsUsedInvites, totalInvites),
      // Symmetric with costPerClientBids (Part: Bidding/Invites stats
      // parity, 2026-10-28, explicit user request) -- invite connect cost
      // divided by invite-won clients specifically.
      costPerClientInvites: safeDivide(inviteConnectCost, wonInvites),
      previousTotalBids: previous ? previousBids : undefined,
      totalBidsDeltaPct: previous ? percentDelta(totalBids, previousBids) : null,
      // Always available now that a real per-connect rate is known -- see
      // connectCostBasis for whether the figure below reflects actual
      // recorded purchases or the flat fallback rate.
      connectCostAvailable: true,
      connectCostBasis: actualCostPerConnect !== undefined ? "actual_purchases" : "flat_rate_estimate",
      connectUnitCost: costPerConnect,
      connectCost,
      costPerBid: safeDivide(connectCost, totalBids),
      // Scoped to wonBids, not the combined clientsWon (Part: Upwork
      // Dashboard KPI cleanup, 2026-10-13, explicit user request) — connects
      // are bid-only, so blending this cost against invite wins too (the
      // old costPerClient) overstated how cheap each bid-won client was.
      // Replaces costPerClient/costPerInvite/bidsPerClient, all removed:
      // confirmed via a repo-wide search that nothing else read them.
      costPerClientBids: safeDivide(connectCost, wonBids),
      connectsPerClient: safeDivide(connectsUsed, won),
      avgConnectsPerBid: safeDivide(connectsUsed, totalBids),
      conversionRate: safeRate(won, totalBids + totalInvites),
    };
  }

  async getMonthlyTable(orgId: string, months = 12) {
    const since = new Date();
    since.setMonth(since.getMonth() - months);
    const proposals = await this.prisma.upworkProposal.findMany({
      where: { orgId, createdAt: { gte: since } },
      select: { createdAt: true, type: true, connects: true, status: true },
    });
    const purchases = await this.prisma.upworkConnectPurchase.findMany({ where: { orgId, purchasedAt: { gte: since } } });

    const byMonth = new Map<string, { bids: number; invites: number; connects: number; won: number; purchaseCost: number; purchaseConnects: number }>();
    const monthKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    for (const p of proposals) {
      const key = monthKey(p.createdAt);
      const bucket = byMonth.get(key) ?? { bids: 0, invites: 0, connects: 0, won: 0, purchaseCost: 0, purchaseConnects: 0 };
      if (p.type === "BIDDING") bucket.bids += 1;
      else bucket.invites += 1;
      bucket.connects += p.connects ?? 0;
      if (p.status === "WON") bucket.won += 1;
      byMonth.set(key, bucket);
    }
    for (const pur of purchases) {
      const key = monthKey(pur.purchasedAt);
      const bucket = byMonth.get(key) ?? { bids: 0, invites: 0, connects: 0, won: 0, purchaseCost: 0, purchaseConnects: 0 };
      bucket.purchaseCost += pur.totalCost;
      bucket.purchaseConnects += pur.connectsAmount;
      byMonth.set(key, bucket);
    }

    return [...byMonth.entries()]
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([month, b]) => ({
        month,
        bids: b.bids,
        invites: b.invites,
        connectsUsed: b.connects,
        clientsWon: b.won,
        connectsPurchased: b.purchaseConnects || undefined,
        purchaseCost: b.purchaseCost || undefined,
        // Estimated at the flat $0.15/connect rate regardless of that
        // month's actual purchases -- a stable, comparable figure month to
        // month, distinct from `purchaseCost` above (what was actually
        // invoiced that month, only present for months with a recorded
        // purchase).
        estimatedUsageCost: b.connects * DEFAULT_CONNECT_UNIT_COST_USD,
        bidsPerClient: safeDivide(b.bids, b.won),
        connectsPerClient: safeDivide(b.connects, b.won),
      }));
  }

  /** Grouped by the free-text submitter name -- UpworkProposal.submittedBy
   *  is deliberately not a User relation (Part: Dashboard Center
   *  gap-analysis confirmed this via the schema's own comment), so this can
   *  fragment a real person into several rows on a typo/casing difference.
   *  Reported as-is rather than silently guessing a canonical mapping.
   *
   *  Grouped by (submitter, profile) -- not just submitter (Part: Upwork
   *  Requests, explicit user request -- "add the profile name on which the
   *  bd has onboarded the project... how many hours were requested on a
   *  profile and how many we have got by bd team on this profile"). Each
   *  row carries `onboardedHours` (sum of WON proposals' projectHours for
   *  that submitter+profile) so it can be read directly against the
   *  Requests page's per-profile "requested" hours -- the two tables share
   *  the same `profileName` string convention (case-sensitive match here,
   *  same as everywhere else this convention is used -- see
   *  UpworkRequestItem's own docblock).
   *
   *  Bids and invites split per-type as of 2026-10-20 (explicit user
   *  request -- Team Performance needed "which person did how many bids,
   *  then how many he won, how many in the in-discussion phase... then
   *  which person accepts how many invites, how many won, how many in
   *  discussion"). bidsWon/invitesWon etc. are new; won/lost are kept too
   *  (now derived as bids+invites combined) so the existing Upwork tab
   *  table/chart that already reads them doesn't need to change.
   *  invitesAccepted uses the exact same status set as getKpis' own
   *  org-wide invitesAccepted (IN_DISCUSSION plus every later-stage status
   *  through WON) so the two numbers mean the same thing at different
   *  granularities, not two different definitions of "accepted". */
  /** Every UpworkProposalStatus value, in schema order -- the full lifecycle
   *  a proposal can be in, not just a collapsed won/lost/in-discussion
   *  subset (Part: Team Performance, 2026-10-20, explicit user correction
   *  -- "remove the accepted status and... add all the current status in
   *  the column heading and then show their numbers so that we have a more
   *  clear report"). The old "Accepted" bucket (IN_DISCUSSION through WON,
   *  invites only) is gone entirely; every status gets its own real count
   *  instead of being folded into one umbrella term. */
  static readonly PROPOSAL_STATUSES = ["SUBMITTED", "VIEWED", "IN_DISCUSSION", "TEST_TASK", "MEETING", "FOLLOW_UP_1", "FOLLOW_UP_2", "FOLLOW_UP_3", "WON", "LOST"] as const;

  async getSubmitterBreakdown(orgId: string, query: DashboardRangeQuery) {
    const { current } = resolveDashboardRange(query);
    const rows = await this.prisma.upworkProposal.findMany({
      where: { orgId, createdAt: { gte: current.from, lte: current.to } },
      select: { submittedBy: true, profileName: true, type: true, connects: true, status: true, projectHours: true },
    });
    const emptyStatusCounts = () => Object.fromEntries(UpworkDashboardService.PROPOSAL_STATUSES.map((s) => [s, 0])) as Record<string, number>;
    const byUserProfile = new Map<
      string,
      {
        name: string; profileName: string; connects: number; onboardedHours: number;
        bids: number; bidStatusCounts: Record<string, number>;
        invites: number; inviteStatusCounts: Record<string, number>;
      }
    >();
    for (const r of rows) {
      const key = `${r.submittedBy} ${r.profileName}`;
      const bucket =
        byUserProfile.get(key) ??
        {
          name: r.submittedBy, profileName: r.profileName, connects: 0, onboardedHours: 0,
          bids: 0, bidStatusCounts: emptyStatusCounts(),
          invites: 0, inviteStatusCounts: emptyStatusCounts(),
        };
      bucket.connects += r.connects ?? 0;
      if (r.type === "BIDDING") {
        bucket.bids += 1;
        bucket.bidStatusCounts[r.status] = (bucket.bidStatusCounts[r.status] ?? 0) + 1;
      } else {
        bucket.invites += 1;
        bucket.inviteStatusCounts[r.status] = (bucket.inviteStatusCounts[r.status] ?? 0) + 1;
      }
      if (r.status === "WON") bucket.onboardedHours += r.projectHours ?? 0;
      byUserProfile.set(key, bucket);
    }
    return [...byUserProfile.values()]
      .map((b) => {
        const won = b.bidStatusCounts.WON + b.inviteStatusCounts.WON;
        const lost = b.bidStatusCounts.LOST + b.inviteStatusCounts.LOST;
        return {
          ...b,
          // Kept for the existing Upwork tab table/chart that already
          // reads these combined fields -- unaffected by this change.
          won,
          lost,
          bidsWon: b.bidStatusCounts.WON,
          bidsLost: b.bidStatusCounts.LOST,
          bidsInDiscussion: b.bidStatusCounts.IN_DISCUSSION,
          invitesWon: b.inviteStatusCounts.WON,
          invitesLost: b.inviteStatusCounts.LOST,
          invitesInDiscussion: b.inviteStatusCounts.IN_DISCUSSION,
          conversionRate: safeRate(won, b.bids + b.invites),
          connectsPerClient: safeDivide(b.connects, won),
          estimatedCost: b.connects * DEFAULT_CONNECT_UNIT_COST_USD,
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name) || a.profileName.localeCompare(b.profileName));
  }
}
