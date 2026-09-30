export interface RawActionEntry {
  action_type: string;
  value: string;
}

export interface InsightAggregateInput {
  impressions: number;
  reach: number;
  clicks: number;
  linkClicks: number | null;
  spend: number;
  videoViews: number | null;
  landingPageViews: number | null;
  actions: unknown;
  actionValues: unknown;
}

export interface ComputedMetrics {
  impressions: number;
  reach: number;
  frequency?: number;
  clicks: number;
  linkClicks: number;
  spend: number;
  ctr?: number;
  cpc?: number;
  cpm?: number;
  videoViews?: number;
  landingPageViews?: number;
  purchases?: number;
  leads?: number;
  addToCart?: number;
  postEngagements?: number;
  conversionValue?: number;
  roas?: number;
  /** "Conversions" tile — the sum of whatever recognized conversion-shaped
   *  action types this data actually contains (Part: "do not hard-code
   *  metrics Meta doesn't return" — this is a deliberate best-effort
   *  blend across campaigns with different objectives, not a single Meta
   *  field, and is labeled "Conversions" in the UI rather than claimed to
   *  be Meta's own "Results" metric, which is genuinely objective-specific). */
  conversions?: number;
  costPerConversion?: number;
  /** Every other action_type Meta returned, summed, keyed by its raw name —
   *  lets the UI render "other conversion/action metrics" dynamically
   *  without this code needing to know every possible Meta action type. */
  otherActions: Record<string, number>;
}

function isRawActionArray(v: unknown): v is RawActionEntry[] {
  return Array.isArray(v) && v.every((e) => e && typeof e === "object" && "action_type" in e && "value" in e);
}

const PURCHASE_TYPES = ["purchase", "omni_purchase"];
const LEAD_TYPES = ["lead", "onsite_conversion.lead_grouped", "offsite_conversion.fb_pixel_lead"];
const ADD_TO_CART_TYPES = ["add_to_cart", "omni_add_to_cart"];
const ENGAGEMENT_TYPES = ["post_engagement"];

function sumMatching(actions: RawActionEntry[], types: string[]): number {
  return actions.filter((a) => types.some((t) => a.action_type === t || a.action_type.includes(t))).reduce((sum, a) => sum + Number(a.value), 0);
}

/** Merges raw per-row `actions`/`action_values` JSON (verbatim from Meta,
 *  see schema.prisma's MetaAdInsightDaily) across every row in an aggregate
 *  and derives every metric the dashboard shows from real returned data —
 *  nothing here is fabricated for a metric a campaign's objective doesn't
 *  produce; it's simply absent from `otherActions`/the named fields. */
export function aggregateInsights(rows: InsightAggregateInput[]): ComputedMetrics {
  const impressions = rows.reduce((s, r) => s + r.impressions, 0);
  const reach = rows.reduce((s, r) => s + r.reach, 0);
  const clicks = rows.reduce((s, r) => s + r.clicks, 0);
  const linkClicks = rows.reduce((s, r) => s + (r.linkClicks ?? 0), 0);
  const spend = rows.reduce((s, r) => s + r.spend, 0);
  const videoViews = rows.reduce((s, r) => s + (r.videoViews ?? 0), 0);
  const landingPageViews = rows.reduce((s, r) => s + (r.landingPageViews ?? 0), 0);

  const actionsByType = new Map<string, number>();
  const actionValuesByType = new Map<string, number>();
  for (const row of rows) {
    if (isRawActionArray(row.actions)) {
      for (const a of row.actions) actionsByType.set(a.action_type, (actionsByType.get(a.action_type) ?? 0) + Number(a.value));
    }
    if (isRawActionArray(row.actionValues)) {
      for (const a of row.actionValues) actionValuesByType.set(a.action_type, (actionValuesByType.get(a.action_type) ?? 0) + Number(a.value));
    }
  }
  const allActions = [...actionsByType.entries()].map(([action_type, value]) => ({ action_type, value: String(value) }));

  const purchases = sumMatching(allActions, PURCHASE_TYPES);
  const leads = sumMatching(allActions, LEAD_TYPES);
  const addToCart = sumMatching(allActions, ADD_TO_CART_TYPES);
  const postEngagements = sumMatching(allActions, ENGAGEMENT_TYPES);
  const conversionValue = [...actionValuesByType.entries()]
    .filter(([type]) => PURCHASE_TYPES.some((t) => type === t || type.includes(t)))
    .reduce((s, [, v]) => s + v, 0);

  const recognized = new Set([...PURCHASE_TYPES, ...LEAD_TYPES, ...ADD_TO_CART_TYPES, ...ENGAGEMENT_TYPES]);
  const otherActions: Record<string, number> = {};
  for (const [type, value] of actionsByType.entries()) {
    if (![...recognized].some((t) => type === t || type.includes(t))) otherActions[type] = value;
  }

  const conversions = purchases + leads + addToCart;

  return {
    impressions,
    reach,
    frequency: reach > 0 ? impressions / reach : undefined,
    clicks,
    linkClicks,
    spend,
    ctr: impressions > 0 ? (clicks / impressions) * 100 : undefined,
    cpc: clicks > 0 ? spend / clicks : undefined,
    cpm: impressions > 0 ? (spend / impressions) * 1000 : undefined,
    videoViews: videoViews || undefined,
    landingPageViews: landingPageViews || undefined,
    purchases: purchases || undefined,
    leads: leads || undefined,
    addToCart: addToCart || undefined,
    postEngagements: postEngagements || undefined,
    conversionValue: conversionValue || undefined,
    roas: conversionValue > 0 && spend > 0 ? conversionValue / spend : undefined,
    conversions: conversions || undefined,
    costPerConversion: conversions > 0 && spend > 0 ? spend / conversions : undefined,
    otherActions,
  };
}

/** current vs. previous, neutral — never labeled good/bad (Part: Error
 *  Handling / UX spec — "do not assume that an increase is necessarily good
 *  or bad"). `null` deltaPct means the previous period had no value to
 *  compare against (0 -> N is an infinite/undefined percentage, not 0%). */
export function percentDelta(current: number | undefined, previous: number | undefined): number | null {
  if (current === undefined || previous === undefined || previous === 0) return null;
  return ((current - previous) / previous) * 100;
}
