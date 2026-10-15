import { Injectable, Logger, ServiceUnavailableException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

const API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";
/** `gemini-2.0-flash` is the safest well-documented default as of this
 *  writing — Google's free-tier model lineup churns fast (new Flash
 *  generations roughly every few months, older ones moved to
 *  access-limited/legacy). **Confirm the current free-tier model name in
 *  Google AI Studio (aistudio.google.com) when generating the API key** —
 *  its own code-snippet view shows the exact current id — and set
 *  `GEMINI_MODEL` in `.env` if it's moved on from this default. Don't trust
 *  this constant blindly months from now. */
const DEFAULT_MODEL = "gemini-2.0-flash";

export interface CoverLetterResult {
  clientNeeds: string;
  niche: string;
  coverLetter: string;
}

/**
 * Thin fetch() wrapper for Google's Gemini API (Part: Upwork Proposal
 * Writing — swapped in for OpenAI, explicit user request, 2026-10-15: "i
 * dont want to spend there, find someother way". Gemini's free tier
 * (Google AI Studio, no credit card) covers this module's realistic volume
 * — one manually-triggered generation at a time — comfortably within its
 * daily request cap. Same narrow, no-SDK pattern as every other
 * third-party integration in this codebase.
 */
@Injectable()
export class GeminiClient {
  private readonly logger = new Logger(GeminiClient.name);

  constructor(private readonly config: ConfigService) {}

  private apiKey(): string {
    const key = this.config.get<string>("GEMINI_API_KEY");
    if (!key) {
      throw new ServiceUnavailableException(
        "GEMINI_API_KEY isn't set — add it to the API's .env to enable Proposal Writing (get a free key at aistudio.google.com, no card needed).",
      );
    }
    return key;
  }

  private model(): string {
    return this.config.get<string>("GEMINI_MODEL") ?? DEFAULT_MODEL;
  }

  /** Same contract as the OpenAI version this replaced: `systemPrompt`
   *  carries the org's editable settings, `jobBrief` is the fetched job as
   *  plain text. Uses Gemini's `responseMimeType: "application/json"` —
   *  its equivalent of OpenAI's JSON mode — so the three sections the user
   *  explicitly asked to always see come back as distinct fields. */
  async generateCoverLetter(systemPrompt: string, jobBrief: string): Promise<CoverLetterResult> {
    const url = `${API_BASE}/${this.model()}:generateContent?key=${this.apiKey()}`;
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
    if (!res.ok) {
      const message = payload?.error?.message ?? `Gemini request failed (${res.status})`;
      this.logger.warn(`Gemini generateContent failed: ${message}`);
      throw new ServiceUnavailableException(message);
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
    };
  }
}
