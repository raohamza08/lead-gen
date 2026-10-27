import { PrismaService } from "../../common/prisma/prisma.service";

/**
 * Maps a real Upwork `connectUsageHistory` `reason` code to a spend
 * category -- confirmed live against this org's actual synced ledger
 * (2026-10-27), not guessed from docs:
 * - JOB_APPLICATION: standard bidding connects cost (carries a jobId).
 * - REFUND_JOB_CANCELLATION / REFUND_INTERVIEW_WON: credits back against a
 *   prior bid (job closed/cancelled, or the bid turned into a won
 *   interview) -- net these against JOB_APPLICATION, don't count as
 *   separate spend.
 * - PAID_INVITATION_BADGE: connects spent responding to an invite with a
 *   paid "badge" -- real invite-related spend, previously assumed to not
 *   exist ("invites cost no connects").
 * - AD_BOOSTED_PROFILE_MFS: Upwork's own transaction history labels this
 *   "Your Boosted Profile received a billable click" -- explicit user
 *   correction, 2026-10-28, after an initial build wrongly treated this as
 *   unrelated ad spend and excluded it from both bidding and invites. A
 *   boosted profile is what draws in client invites in the first place, so
 *   this is real invite-acquisition cost and belongs in INVITE, same as
 *   PAID_INVITATION_BADGE.
 * Anything else (DIRECT_PURCHASE, INTERVIEW_WON, BEHAVIORAL_BASED_SUBSIDY,
 * and any future code Upwork adds) falls into OTHER rather than being
 * silently misclassified.
 *
 * The keys below also include literal human-readable labels, not just the
 * GraphQL `reason` enum codes above -- a one-off historical backfill
 * (2026-10-28, explicit user request: "I have downloaded a file from
 * Upwork that has the 90 days history of connects... take the previous
 * record for the connects so that we have a better history for invites
 * spend") imported ~2,000 rows scraped from Upwork's own Connects usage
 * history WEB PAGE (apps/api/scripts/backfill-connects-history.ts, now
 * deleted per the one-off-script convention), covering 2026-07-29 through
 * 2026-10-21 -- the real gap before this org's GraphQL sync started
 * (2026-10-22). That page shows human text ("Applied to job", "Your
 * Boosted Profile received a billable click"), not the API's enum codes,
 * and there is no confirmed 1:1 mapping between the two surfaces -- rather
 * than guess an equivalence, the scraped text itself is stored verbatim in
 * `reason` and classified here directly, alongside the enum codes.
 * "Open for work" (a real, substantial, previously entirely untracked
 * daily recurring spend -- ~28-36 connects/day to keep a profile's
 * availability badge on) is deliberately left in OTHER, not INVITE: the
 * user's explicit instruction was specifically about "Your Boosted
 * Profile received a billable click," and conflating a flat subscription
 * -like visibility fee with per-click invite-acquisition spend would be a
 * real editorializing choice this code shouldn't make unasked. Flagged to
 * the user; revisit only on their explicit say-so.
 */
export type ConnectsSpendCategory = "BIDDING" | "INVITE" | "OTHER";

const REASON_CATEGORY: Record<string, ConnectsSpendCategory> = {
  JOB_APPLICATION: "BIDDING",
  REFUND_JOB_CANCELLATION: "BIDDING",
  REFUND_INTERVIEW_WON: "BIDDING",
  PAID_INVITATION_BADGE: "INVITE",
  AD_BOOSTED_PROFILE_MFS: "INVITE",
  // Scraped-history literal labels (see docblock above).
  "Applied to job": "BIDDING",
  "Job cancelled": "BIDDING",
  "Refunded Connects for Connects Award": "BIDDING",
  "We accepted your bid to boost a proposal. This is the final bid charge.": "BIDDING",
  "You've been outbid to boost your proposal": "BIDDING",
  "Connects bid for boosted proposal.": "BIDDING",
  "Your Boosted Profile received a billable click": "INVITE",
  "Open for work": "OTHER",
  "Added extra Connects": "OTHER",
  "Awarded Connects": "OTHER",
  "Earned Connects from client action": "OTHER",
};

export function categoryForReason(reason: string | null): ConnectsSpendCategory {
  if (!reason) return "OTHER";
  return REASON_CATEGORY[reason] ?? "OTHER";
}

export interface ConnectsCategoryTotals {
  bidding: number;
  invite: number;
  other: number;
}

/** Net connects consumed per category within [from, to] -- DEBIT rows are
 *  stored with a negative `amountRaw` and REFUND_CREDIT rows (a refund
 *  against one specific prior debit -- job cancelled, interview won, an
 *  outbid proposal-boost auction) positive, so summing those two types'
 *  raw values and negating nets a refund against its original debit
 *  automatically. Plain `CREDIT` rows are deliberately excluded from this
 *  sum entirely, not netted in -- they're fresh connects being added (a
 *  purchase, an Upwork-granted bonus/award), not a refund of anything, so
 *  they don't belong in a "how much was spent" figure. Bug fixed
 *  2026-10-28: before this, a single org's one-off historical backfill
 *  (see this file's category-map docblock) added ~35k connects of real
 *  CREDIT rows ("Added extra Connects" = direct purchases) mapped into
 *  OTHER alongside a genuine ~2.3k-connect OTHER debit ("Open for work"),
 *  and netting them together swamped the real debit down to a clamped 0 --
 *  silently hiding real spend. Confirmed via a live query against the
 *  actual post-backfill data, not assumed. Clamped at 0 per category as a
 *  final floor: a category with more refunds than debits in this window
 *  (edge case) reports as "nothing used," not a negative spend. */
export async function sumConnectsByCategory(
  prisma: PrismaService,
  orgId: string,
  range?: { gte?: Date; lte?: Date },
): Promise<ConnectsCategoryTotals> {
  // `amountRaw` is stored as a plain String column (Upwork's own
  // `rawValue` field, e.g. "-11", "16") -- not a Decimal/Float, so Prisma
  // can't `_sum` it server-side. Row counts per org are a few hundred at
  // most (a connects ledger, not bulk marketplace content), so fetching
  // the raw rows and summing in JS is simpler than a workaround and cheap
  // either way.
  const rows = await prisma.upworkConnectsTransaction.findMany({
    where: { orgId, ...(range ? { occurredAt: { gte: range.gte, lte: range.lte } } : {}) },
    select: { reason: true, amountRaw: true, transactionType: true },
  });

  const totals: ConnectsCategoryTotals = { bidding: 0, invite: 0, other: 0 };
  for (const row of rows) {
    if (row.transactionType === "CREDIT") continue;
    const net = -Number(row.amountRaw);
    const category = categoryForReason(row.reason);
    if (category === "BIDDING") totals.bidding += net;
    else if (category === "INVITE") totals.invite += net;
    else totals.other += net;
  }
  totals.bidding = Math.max(0, totals.bidding);
  totals.invite = Math.max(0, totals.invite);
  totals.other = Math.max(0, totals.other);
  return totals;
}

/** Earliest `occurredAt` on record for this org's real Connects ledger, or
 *  `null` if the org has never synced one (not yet connected, or connects-
 *  usage sync hasn't run). Used to detect how far back the real ledger
 *  actually covers -- confirmed live (2026-10-27) that Upwork's API only
 *  returns history from roughly when the org's API connection went live,
 *  not a full 2-year backfill as hoped, so any period before this needs a
 *  fallback source. As of the 2026-10-28 historical backfill (see the
 *  category map's own docblock), this now resolves to 2026-07-29 for orgs
 *  that received it -- real scraped history, not a gap -- so the manual-
 *  entry fallback in UpworkDashboardService now only kicks in before that
 *  date, not 2026-10-22. */
export async function connectsLedgerStartDate(prisma: PrismaService, orgId: string): Promise<Date | null> {
  const earliest = await prisma.upworkConnectsTransaction.findFirst({
    where: { orgId },
    orderBy: { occurredAt: "asc" },
    select: { occurredAt: true },
  });
  return earliest?.occurredAt ?? null;
}
