/**
 * Bidding SOP signals (Part: Upwork Bidding SOP) — deterministic arithmetic
 * over scraped job/client facts, kept separate from the Gemini prompt
 * deliberately: country exclusion, client-spend tier, and job-posting age
 * are verifiable policy, not something worth leaving to a model to "decide"
 * when plain code can compute them exactly from the same data. Gemini only
 * handles the fuzzy parts (job-type classification, freelancer-profile
 * match, writing) — see gemini.client.ts.
 */

export type SpendTier = "PRIORITY" | "RARE_LOW_RESPONSE" | "NEW_CLIENT_OK" | "STANDARD" | "UNKNOWN";
export type Recommendation = "BID" | "MAYBE" | "SKIP";

/** "$42K total spent" -> 42000, "$1.2M" -> 1200000, "$5.00" -> 5. Returns
 *  null if no dollar amount is found anywhere in the string. */
export function parseMoney(text: string | undefined): number | null {
  if (!text) return null;
  const match = text.match(/\$\s?([\d,.]+)\s?(K|M)?/i);
  if (!match) return null;
  const n = parseFloat(match[1].replace(/,/g, ""));
  if (Number.isNaN(n)) return null;
  const suffix = match[2]?.toUpperCase();
  if (suffix === "K") return n * 1_000;
  if (suffix === "M") return n * 1_000_000;
  return n;
}

/** "298 hires, 31 active" -> 298. First integer found in the string. */
export function parseFirstInt(text: string | undefined): number | null {
  if (!text) return null;
  const match = text.match(/(\d[\d,]*)/);
  if (!match) return null;
  const n = parseInt(match[1].replace(/,/g, ""), 10);
  return Number.isNaN(n) ? null : n;
}

/** "Member since Mar 2, 2015" -> Date. Null if unparseable. */
export function parseMemberSinceDate(text: string | undefined): Date | null {
  if (!text) return null;
  const cleaned = text.replace(/^member since\s*/i, "").trim();
  const date = new Date(cleaned);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Bidding SOP Part 6 preference — true for ongoing/6-months-plus work,
 *  false for clearly short one-off jobs, null when the facts don't say
 *  either way clearly enough to call it. */
export function isLongTermJob(facts: Record<string, string>): boolean | null {
  const projectType = facts["Project Type"] ?? "";
  const duration = facts["Duration"] ?? "";
  if (/ongoing/i.test(projectType)) return true;
  if (/more than 6|6\+|long[\s-]?term/i.test(duration)) return true;
  if (/less than 1 month|1\s*(to|-)\s*3 months/i.test(duration) && !/ongoing/i.test(projectType)) return false;
  return null;
}

/** Bidding SOP Part 3 — client-spend-based bidding priority. The
 *  "NEW_CLIENT_OK" tier is the explicit exception the user gave: a client
 *  with zero hires and no/zero spend gets treated as viable rather than
 *  penalized for having no track record yet, since there's no real hire
 *  rate to be low. */
export function computeSpendTier(totalSpentUsd: number | null, totalHires: number | null): SpendTier {
  if (totalSpentUsd === null && totalHires === null) return "UNKNOWN";
  const spend = totalSpentUsd ?? 0;
  const hires = totalHires ?? 0;
  if (spend === 0 && hires === 0) return "NEW_CLIENT_OK";
  if (spend >= 1_000 && spend <= 5_000) return "PRIORITY";
  if (spend > 5_000_000) return "RARE_LOW_RESPONSE";
  return "STANDARD";
}

/** Case-insensitive match against the org's excluded-countries list. */
export function isExcludedCountry(country: string | undefined, excludedCountries: string[]): boolean {
  if (!country) return false;
  return excludedCountries.some((c) => c.trim().toLowerCase() === country.trim().toLowerCase());
}

/** Minutes since the job was posted, or null if postedAt is missing/invalid. */
export function minutesSincePosted(postedAtIso: string | undefined): number | null {
  if (!postedAtIso) return null;
  const posted = new Date(postedAtIso);
  if (Number.isNaN(posted.getTime())) return null;
  return Math.round((Date.now() - posted.getTime()) / 60_000);
}

/** Explicit user preference — hourly jobs over fixed-price. Reads whichever
 *  fact key/value pair carries the rate type (e.g. `facts["Hourly"]` or a
 *  job-listing card's "Hourly"/"Fixed-price" label); null when neither is
 *  present in what was scraped. */
export function isHourly(facts: Record<string, string>): boolean | null {
  const keys = Object.keys(facts);
  if (keys.some((k) => /hourly/i.test(k))) return true;
  if (keys.some((k) => /fixed/i.test(k))) return false;
  const values = Object.values(facts);
  if (values.some((v) => /hourly/i.test(v))) return true;
  if (values.some((v) => /fixed/i.test(v))) return false;
  return null;
}

export interface RecommendationSignals {
  isExcludedCountry: boolean;
  spendTier: SpendTier;
  isLongTerm: boolean | null;
  isHourly: boolean | null;
  postedMinutesAgo: number | null;
}

/** Bidding SOP Part 6 ("is this a job where we have a realistic chance")
 *  turned into a list-view verdict — deterministic, same reasoning as
 *  every other signal in this file: a hard exclusion (client country) is
 *  the only thing that produces SKIP; everything else just downgrades BID
 *  to MAYBE with a stated reason, never silently drops a job from view. */
export function computeRecommendation(signals: RecommendationSignals): { recommendation: Recommendation; reasons: string[] } {
  if (signals.isExcludedCountry) {
    return { recommendation: "SKIP", reasons: ["Client is in an excluded country."] };
  }

  const reasons: string[] = [];
  if (signals.spendTier === "RARE_LOW_RESPONSE") {
    reasons.push("Client has spent over $5M — historically low response rate.");
  }
  if (signals.isLongTerm === false) {
    reasons.push("Looks like short-term/one-off work, not ongoing.");
  }
  if (signals.postedMinutesAgo !== null && signals.postedMinutesAgo > 15) {
    reasons.push(`Posted ${signals.postedMinutesAgo} minutes ago — outside the 15-minute bidding window.`);
  }
  if (signals.isHourly === false) {
    reasons.push("Fixed-price — hourly jobs are preferred.");
  }

  return { recommendation: reasons.length === 0 ? "BID" : "MAYBE", reasons };
}

/** Bidding SOP Part 2 — scans the scraped facts for a dollar figure (the
 *  job's stated rate/budget) and suggests bidding at or slightly below it,
 *  rather than guessing a number with no basis. Returns null if no budget
 *  figure was found in the facts at all. */
export function suggestBidAmount(facts: Record<string, string>): string | null {
  const entry = Object.entries(facts).find(([, value]) => /\$\s?[\d,.]+/.test(value));
  if (!entry) return null;
  const [key, value] = entry;
  const amount = parseMoney(value);
  if (amount === null) return null;
  const isHourly = /hour/i.test(key) || /hour/i.test(value);
  if (isHourly) {
    return `Match the client's stated rate (~$${amount.toFixed(2)}/hr) — hourly jobs don't usually benefit from underbidding.`;
  }
  const suggested = Math.round(amount * 0.95);
  return `Bid around $${suggested.toLocaleString()} (client's stated budget: $${amount.toLocaleString()}) — at or slightly below, per SOP.`;
}
