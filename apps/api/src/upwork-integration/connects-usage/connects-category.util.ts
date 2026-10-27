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
 * - AD_BOOSTED_PROFILE_MFS: flat profile-boost ad spend, never tied to a
 *   job or invite (no jobId on these rows, ever) -- marketing spend, not
 *   bid/invite cost. Must be excluded from bidding/invite expense totals,
 *   not blended in.
 * Anything else (DIRECT_PURCHASE, INTERVIEW_WON, BEHAVIORAL_BASED_SUBSIDY,
 * and any future code Upwork adds) falls into OTHER rather than being
 * silently misclassified.
 */
export type ConnectsSpendCategory = "BIDDING" | "INVITE" | "PROFILE_BOOST" | "OTHER";

const REASON_CATEGORY: Record<string, ConnectsSpendCategory> = {
  JOB_APPLICATION: "BIDDING",
  REFUND_JOB_CANCELLATION: "BIDDING",
  REFUND_INTERVIEW_WON: "BIDDING",
  PAID_INVITATION_BADGE: "INVITE",
  AD_BOOSTED_PROFILE_MFS: "PROFILE_BOOST",
};

export function categoryForReason(reason: string | null): ConnectsSpendCategory {
  if (!reason) return "OTHER";
  return REASON_CATEGORY[reason] ?? "OTHER";
}

export interface ConnectsCategoryTotals {
  bidding: number;
  invite: number;
  profileBoost: number;
  other: number;
}

/** Net connects consumed per category within [from, to] -- debit rows are
 *  stored with a negative `amountRaw` and credits (refunds) positive (
 *  confirmed against real rows), so summing raw values and negating nets
 *  a refund against its original debit automatically. Clamped at 0 per
 *  category: a category that refunded more than it spent in this window
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
    select: { reason: true, amountRaw: true },
  });

  const totals: ConnectsCategoryTotals = { bidding: 0, invite: 0, profileBoost: 0, other: 0 };
  for (const row of rows) {
    const net = -Number(row.amountRaw);
    const category = categoryForReason(row.reason);
    if (category === "BIDDING") totals.bidding += net;
    else if (category === "INVITE") totals.invite += net;
    else if (category === "PROFILE_BOOST") totals.profileBoost += net;
    else totals.other += net;
  }
  totals.bidding = Math.max(0, totals.bidding);
  totals.invite = Math.max(0, totals.invite);
  totals.profileBoost = Math.max(0, totals.profileBoost);
  totals.other = Math.max(0, totals.other);
  return totals;
}

/** Earliest `occurredAt` on record for this org's real Connects ledger, or
 *  `null` if the org has never synced one (not yet connected, or connects-
 *  usage sync hasn't run). Used to detect how far back the real ledger
 *  actually covers -- confirmed live (2026-10-27) that Upwork's API only
 *  returns history from roughly when the org's API connection went live,
 *  not a full 2-year backfill as hoped, so any period before this needs a
 *  fallback source. */
export async function connectsLedgerStartDate(prisma: PrismaService, orgId: string): Promise<Date | null> {
  const earliest = await prisma.upworkConnectsTransaction.findFirst({
    where: { orgId },
    orderBy: { occurredAt: "asc" },
    select: { occurredAt: true },
  });
  return earliest?.occurredAt ?? null;
}
