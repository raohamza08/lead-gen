import { Injectable, Logger, ServiceUnavailableException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

const API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";
/** `gemini-flash-lite-latest` — verified live against a real key (2026-10-15)
 *  after `gemini-2.0-flash` (the original default) started 404ing: Google
 *  had deprecated it. Also tried `gemini-2.5-flash` (404, "no longer
 *  available to new users") and `gemini-3.8-flash`/`gemini-flash-latest`
 *  (both valid but consistently 503 "high demand" on the free tier at the
 *  time of testing — the newer flash aliases are popular enough to be
 *  oversubscribed). flash-lite is the one that actually returned a real
 *  response. Google's free-tier model lineup churns every few months —
 *  if this starts 404ing/503ing persistently again, re-run
 *  `GET /v1beta/models?key=...` with a real key to see what's actually
 *  live and available before guessing a replacement; don't just swap in
 *  whatever name sounds newest. */
const DEFAULT_MODEL = "gemini-flash-lite-latest";
/** Used when a 429 doesn't tell us how long to wait (no RetryInfo, message
 *  doesn't look daily) — generous enough for a per-minute/RPM-style limit
 *  without hammering a key that just got throttled. */
const DEFAULT_COOLDOWN_MS = 60_000;

export interface CoverLetterResult {
  clientNeeds: string;
  niche: string;
  /// Body text ONLY — no greeting, no sign-off. Those are templated on in
  /// code around this (Part: Upwork Proposal Writing, explicit user
  /// request for a fixed "Hi {client}," / "Thank you," shape rather than
  /// trusting the model to format it reliably every time). First sentence
  /// is the curiosity hook shown in Upwork's inbox preview before the
  /// client opens the proposal — see buildStructuralRules.
  coverLetter: string;
  /// Bidding SOP Part 1 — which word-limit band the model decided this job
  /// falls into and wrote to; purely the model's own judgment call, unlike
  /// the deterministic signals computed in bidding-criteria.util.ts.
  jobType: "TECHNICAL" | "NON_TECHNICAL";
  /// Null when no freelancer profiles are configured, or the model couldn't
  /// find a reasonable match among the ones given.
  suggestedProfile: string | null;
  profileReason: string | null;
  /// Short synthesis answering "how good is this job to bid on" — written
  /// to reference the deterministic signals passed in, not contradict them.
  overallAssessment: string;
}

class GeminiRateLimitError extends Error {
  constructor(
    message: string,
    public readonly details?: unknown[],
  ) {
    super(message);
  }
}

/**
 * Thin fetch() wrapper for Google's Gemini API (Part: Upwork Proposal
 * Writing — swapped in for OpenAI, explicit user request, 2026-10-15: "i
 * dont want to spend there, find someother way"). Gemini's free tier
 * (Google AI Studio, no credit card) covers this module's realistic volume
 * — one manually-triggered generation at a time — comfortably within its
 * daily request cap. Same narrow, no-SDK pattern as every other
 * third-party integration in this codebase.
 *
 * Supports multiple keys with automatic rotation on rate-limit (Part: same
 * day, explicit user request — "if one limit is full, it will route to the
 * next api key"): `GEMINI_API_KEYS` is a comma-separated list; a key that
 * 429s is put on an in-memory cooldown (parsed from Gemini's own
 * `RetryInfo` detail when present, otherwise a guess based on whether the
 * message looks like a daily vs per-minute limit) and the next
 * non-cooling-down key is tried instead, within the same request — the
 * caller never sees a 429 unless every key is currently cooling down.
 * Cooldown state is per-process (not persisted) — a restart just forgets
 * which keys were recently throttled and tries all of them again, which is
 * harmless, not a correctness issue.
 */
@Injectable()
export class GeminiClient {
  private readonly logger = new Logger(GeminiClient.name);
  private readonly cooldownUntil = new Map<string, number>();
  /** Index into `keys()` of the last key that worked — each call starts
   *  from here instead of always from key[0], so a key already confirmed
   *  exhausted today isn't retried first on every single request. */
  private lastGoodKeyIndex = 0;

  constructor(private readonly config: ConfigService) {}

  private keys(): string[] {
    const multi = this.config.get<string>("GEMINI_API_KEYS");
    const single = this.config.get<string>("GEMINI_API_KEY");
    const raw = multi ?? single ?? "";
    const keys = raw
      .split(",")
      .map((k) => k.trim())
      .filter(Boolean);
    if (!keys.length) {
      throw new ServiceUnavailableException(
        "GEMINI_API_KEYS (or GEMINI_API_KEY) isn't set — add at least one to the API's .env (get a free key at aistudio.google.com, no card needed).",
      );
    }
    return keys;
  }

  private model(): string {
    // `?? DEFAULT_MODEL` alone doesn't catch an empty-but-present
    // GEMINI_MODEL= in .env (empty string isn't nullish) — confirmed this
    // was live on the VPS and would have silently sent an empty model
    // segment in the URL regardless of what DEFAULT_MODEL was set to.
    return this.config.get<string>("GEMINI_MODEL")?.trim() || DEFAULT_MODEL;
  }

  private maskKey(key: string): string {
    return `…${key.slice(-6)}`;
  }

  /** Reads Gemini's own `RetryInfo` error detail (`retryDelay: "34s"`) when
   *  present — the actual authoritative wait time — before falling back to
   *  a text-based daily-vs-per-minute guess. */
  private cooldownDurationMs(message: string, details: unknown[] | undefined): number {
    const retryInfo = details?.find(
      (d): d is { retryDelay?: string } =>
        typeof d === "object" && d !== null && String((d as Record<string, unknown>)["@type"] ?? "").includes("RetryInfo"),
    );
    const retryDelay = retryInfo?.retryDelay;
    if (retryDelay) {
      const seconds = parseFloat(retryDelay.replace("s", ""));
      if (!Number.isNaN(seconds) && seconds > 0) return seconds * 1000;
    }
    if (/per[\s-]?day|daily|requests per day|RPD/i.test(message)) {
      return this.msUntilNextPacificMidnight();
    }
    return DEFAULT_COOLDOWN_MS;
  }

  /** Google's free-tier daily quotas reset at midnight Pacific time. */
  private msUntilNextPacificMidnight(): number {
    const now = new Date();
    const pacificNowStr = now.toLocaleString("en-US", { timeZone: "America/Los_Angeles" });
    const pacificNow = new Date(pacificNowStr);
    const nextMidnightPacific = new Date(pacificNow);
    nextMidnightPacific.setHours(24, 0, 0, 0);
    return Math.max(nextMidnightPacific.getTime() - pacificNow.getTime(), DEFAULT_COOLDOWN_MS);
  }

  private async callGemini(key: string, systemPrompt: string, jobBrief: string): Promise<CoverLetterResult> {
    const url = `${API_BASE}/${this.model()}:generateContent?key=${key}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: jobBrief }] }],
        systemInstruction: { parts: [{ text: systemPrompt }] },
        generationConfig: { responseMimeType: "application/json", temperature: 0.7 },
      }),
    });

    const payload = await res.json().catch(() => null);
    if (res.status === 429) {
      throw new GeminiRateLimitError(payload?.error?.message ?? "Rate limited", payload?.error?.details);
    }
    if (!res.ok) {
      throw new ServiceUnavailableException(payload?.error?.message ?? `Gemini request failed (${res.status})`);
    }

    const raw = payload?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!raw) {
      const blockReason = payload?.candidates?.[0]?.finishReason;
      throw new ServiceUnavailableException(
        blockReason ? `Gemini returned no content (${blockReason}).` : "Gemini returned an empty response.",
      );
    }

    let parsed: Partial<CoverLetterResult>;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new ServiceUnavailableException("Gemini returned a response that wasn't valid JSON.");
    }

    if (!parsed.coverLetter) {
      throw new ServiceUnavailableException("Gemini's response was missing a cover letter.");
    }

    return {
      clientNeeds: parsed.clientNeeds ?? "",
      niche: parsed.niche ?? "",
      coverLetter: parsed.coverLetter,
      jobType: parsed.jobType === "NON_TECHNICAL" ? "NON_TECHNICAL" : "TECHNICAL",
      suggestedProfile: parsed.suggestedProfile ?? null,
      profileReason: parsed.profileReason ?? null,
      overallAssessment: parsed.overallAssessment ?? "",
    };
  }

  /** Same contract as the OpenAI version this replaced: `systemPrompt`
   *  carries the org's editable settings, `jobBrief` is the fetched job as
   *  plain text. Tries each configured key in turn (starting from the one
   *  that last worked), skipping any still on cooldown, and rotates to the
   *  next on a 429 — so a single caller never has to know how many keys
   *  exist or manage rotation itself. */
  async generateCoverLetter(systemPrompt: string, jobBrief: string): Promise<CoverLetterResult> {
    const keys = this.keys();
    const now = Date.now();

    const ready = keys.filter((k) => (this.cooldownUntil.get(k) ?? 0) <= now);
    // If every key looks exhausted, try them anyway rather than refuse
    // outright — the cooldown estimate is a guess, not authoritative, and a
    // real attempt costs nothing but a moment.
    const pool = ready.length > 0 ? ready : keys;
    const startAt = Math.max(pool.indexOf(keys[this.lastGoodKeyIndex % keys.length]), 0);
    const order = [...pool.slice(startAt), ...pool.slice(0, startAt)];

    let lastError: Error | undefined;
    for (const key of order) {
      try {
        const result = await this.callGemini(key, systemPrompt, jobBrief);
        this.lastGoodKeyIndex = keys.indexOf(key);
        this.cooldownUntil.delete(key);
        return result;
      } catch (err) {
        if (err instanceof GeminiRateLimitError) {
          const cooldownMs = this.cooldownDurationMs(err.message, err.details);
          this.cooldownUntil.set(key, now + cooldownMs);
          this.logger.warn(
            `Gemini key ${this.maskKey(key)} hit its limit (${err.message}) — cooling down ${Math.round(cooldownMs / 1000)}s, rotating to the next key.`,
          );
          lastError = err;
          continue;
        }
        throw err;
      }
    }

    throw new ServiceUnavailableException(
      `All ${keys.length} Gemini API key(s) are currently rate-limited.${lastError ? ` (${lastError.message})` : ""}`,
    );
  }
}
