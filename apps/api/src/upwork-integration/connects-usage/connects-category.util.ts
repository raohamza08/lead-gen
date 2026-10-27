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
 *   paid "badge." Classified INVITE briefly (2026-10-28), then explicitly
 *   moved to OTHER same day per direct user correction ("you included 122
 *   connects in the invites connects, remove them from the invites
 *   connects") -- don't re-add this to INVITE without the user asking
 *   again.
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
  PAID_INVITATION_BADGE: "OTHER",
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

/**
 * Finer-grained than ConnectsSpendCategory above (Part: Connects Dashboard,
 * 2026-10-28, explicit user request to "show each and every connect usage"
 * -- bidding, invites, open for work, and "etc" each need their own visible
 * line, not folded into one OTHER bucket). A separate type/map from
 * ConnectsSpendCategory on purpose: the simpler 3-bucket classification
 * already powers the Bidding/Invites Stats cards and the Transactions
 * widget, both verified correct -- this one is additive, for the new
 * dashboard only, and never replaces the simpler one elsewhere.
 * - OPEN_FOR_WORK split out from OTHER here: a real, substantial recurring
 *   cost (confirmed ~28-36 connects/day) the user explicitly asked to see
 *   broken out, not folded away.
 * - PROPOSAL_BOOST split out from BIDDING: a distinct real mechanism (an
 *   auction to boost one specific proposal's visibility, tied to a jobId)
 *   seen live in the scraped history -- tiny volume so far, but a genuine
 *   "etc" line worth surfacing on its own rather than quietly blending into
 *   the main bidding number.
 * - PURCHASE / AWARD: pure CREDIT reasons (connects coming IN, not being
 *   spent) -- direct purchases and Upwork-granted bonuses respectively.
 *   Reported as "connects added," never netted against any spend category.
 * - PAID_INVITATION_BADGE stays OTHER here too, consistent with its
 *   explicit removal from INVITE above.
 */
export type DetailedConnectsCategory = "BIDDING" | "INVITE" | "OPEN_FOR_WORK" | "PROPOSAL_BOOST" | "PURCHASE" | "AWARD" | "OTHER";

const DETAILED_REASON_CATEGORY: Record<string, DetailedConnectsCategory> = {
  JOB_APPLICATION: "BIDDING",
  REFUND_JOB_CANCELLATION: "BIDDING",
  REFUND_INTERVIEW_WON: "BIDDING",
  "Applied to job": "BIDDING",
  "Job cancelled": "BIDDING",
  "Refunded Connects for Connects Award": "BIDDING",
  AD_BOOSTED_PROFILE_MFS: "INVITE",
  "Your Boosted Profile received a billable click": "INVITE",
  "Open for work": "OPEN_FOR_WORK",
  "We accepted your bid to boost a proposal. This is the final bid charge.": "PROPOSAL_BOOST",
  "You've been outbid to boost your proposal": "PROPOSAL_BOOST",
  "Connects bid for boosted proposal.": "PROPOSAL_BOOST",
  DIRECT_PURCHASE: "PURCHASE",
  "Added extra Connects": "PURCHASE",
  BEHAVIORAL_BASED_SUBSIDY: "AWARD",
  INTERVIEW_WON: "AWARD",
  "Awarded Connects": "AWARD",
  "Earned Connects from client action": "AWARD",
  PAID_INVITATION_BADGE: "OTHER",
};

export const DETAILED_CATEGORY_LABELS: Record<DetailedConnectsCategory, string> = {
  BIDDING: "Bidding (job applications)",
  INVITE: "Invites (boosted profile)",
  OPEN_FOR_WORK: "Open for Work",
  PROPOSAL_BOOST: "Proposal Boost",
  PURCHASE: "Purchases",
  AWARD: "Awards / Bonuses",
  OTHER: "Other",
};

/** Which categories represent real spend (vs. connects coming in) -- drives
 *  whether a category's figure is "net connects used" (debit minus any
 *  REFUND_CREDIT reversing it) or "connects added" (plain CREDIT, never
 *  netted against anything). */
export const SPEND_CATEGORIES: readonly DetailedConnectsCategory[] = ["BIDDING", "INVITE", "OPEN_FOR_WORK", "PROPOSAL_BOOST", "OTHER"];

export function detailedCategoryForReason(reason: string | null): DetailedConnectsCategory {
  if (!reason) return "OTHER";
  return DETAILED_REASON_CATEGORY[reason] ?? "OTHER";
}

export interface DetailedCategoryRow {
  category: DetailedConnectsCategory;
  label: string;
  kind: "SPEND" | "CREDIT";
  connects: number; // always a positive magnitude
  transactionCount: number;
  estimatedCost: number; // connects * unit cost -- 0 for CREDIT rows, not meaningful there
}

/** Full per-category breakdown (not just bidding/invite/other) for the
 *  Connects Dashboard. Same DEBIT/REFUND_CREDIT-netting and CREDIT-
 *  exclusion rules as sumConnectsByCategory above, just reported per
 *  detailed category instead of 3 buckets, and with plain-CREDIT categories
 *  (PURCHASE/AWARD) surfaced explicitly as "connects added" rather than
 *  silently dropped. */
export async function getDetailedCategoryBreakdown(
  prisma: PrismaService,
  orgId: string,
  range: { gte: Date; lte: Date },
  costPerConnect: number,
): Promise<DetailedCategoryRow[]> {
  const rows = await prisma.upworkConnectsTransaction.findMany({
    where: { orgId, occurredAt: { gte: range.gte, lte: range.lte } },
    select: { reason: true, amountRaw: true, transactionType: true },
  });

  const buckets: Record<DetailedConnectsCategory, { debit: number; refund: number; credit: number; count: number }> = {
    BIDDING: { debit: 0, refund: 0, credit: 0, count: 0 },
    INVITE: { debit: 0, refund: 0, credit: 0, count: 0 },
    OPEN_FOR_WORK: { debit: 0, refund: 0, credit: 0, count: 0 },
    PROPOSAL_BOOST: { debit: 0, refund: 0, credit: 0, count: 0 },
    PURCHASE: { debit: 0, refund: 0, credit: 0, count: 0 },
    AWARD: { debit: 0, refund: 0, credit: 0, count: 0 },
    OTHER: { debit: 0, refund: 0, credit: 0, count: 0 },
  };

  for (const row of rows) {
    const cat = detailedCategoryForReason(row.reason);
    const amt = Number(row.amountRaw);
    buckets[cat].count += 1;
    if (row.transactionType === "CREDIT") buckets[cat].credit += amt;
    else if (row.transactionType === "REFUND_CREDIT") buckets[cat].refund += amt;
    else buckets[cat].debit += -amt;
  }

  return (Object.keys(buckets) as DetailedConnectsCategory[])
    .map((category): DetailedCategoryRow => {
      const b = buckets[category];
      const isSpend = SPEND_CATEGORIES.includes(category);
      const connects = isSpend ? Math.max(0, b.debit - b.refund) : b.credit;
      // PURCHASE gets a real dollar estimate too (connects * rate), computed
      // straight off the live-synced ledger -- not 0 -- so a newly-bought
      // batch of connects shows its cost immediately, without needing a
      // separate manually-logged UpworkConnectPurchase row (Part: Connects
      // Dashboard, 2026-10-28, user correction -- "if one connect costs
      // 0.15, 1000 will cost 150" is just multiplication, it shouldn't need
      // manual data entry to appear). AWARD stays 0: bonus connects were
      // never paid for.
      const estimatedCost = isSpend || category === "PURCHASE" ? connects * costPerConnect : 0;
      return {
        category,
        label: DETAILED_CATEGORY_LABELS[category],
        kind: isSpend ? "SPEND" : "CREDIT",
        connects,
        transactionCount: b.count,
        estimatedCost,
      };
    })
    .filter((r) => r.transactionCount > 0);
}

export interface DailyConnectsTrendPoint {
  day: string; // YYYY-MM-DD
  bidding: number;
  invite: number;
  openForWork: number;
  other: number; // PROPOSAL_BOOST + OTHER's spend side, lumped for a readable 4-series chart
}

/** Real per-day spend trend (Part: Connects Dashboard, 2026-10-28) -- only
 *  possible now that the ledger has genuine per-transaction timestamps
 *  (the old "Monthly trend" chart elsewhere is month-granularity manual
 *  entries; this is real daily data). Spend categories only -- PURCHASE/
 *  AWARD (connects coming in) don't belong on a "usage" trend. */
export async function getDailyConnectsTrend(
  prisma: PrismaService,
  orgId: string,
  range: { gte: Date; lte: Date },
): Promise<DailyConnectsTrendPoint[]> {
  const rows = await prisma.upworkConnectsTransaction.findMany({
    where: { orgId, occurredAt: { gte: range.gte, lte: range.lte } },
    select: { occurredAt: true, reason: true, amountRaw: true, transactionType: true },
  });

  const byDay = new Map<string, DailyConnectsTrendPoint>();
  for (const row of rows) {
    if (row.transactionType === "CREDIT") continue;
    const day = row.occurredAt.toISOString().slice(0, 10);
    const point = byDay.get(day) ?? { day, bidding: 0, invite: 0, openForWork: 0, other: 0 };
    const net = -Number(row.amountRaw);
    const cat = detailedCategoryForReason(row.reason);
    if (cat === "BIDDING") point.bidding += net;
    else if (cat === "INVITE") point.invite += net;
    else if (cat === "OPEN_FOR_WORK") point.openForWork += net;
    else point.other += net; // PROPOSAL_BOOST + OTHER
    byDay.set(day, point);
  }

  return [...byDay.values()].sort((a, b) => (a.day < b.day ? -1 : 1));
}
