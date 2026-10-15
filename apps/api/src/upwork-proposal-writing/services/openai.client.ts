import { Injectable, Logger, ServiceUnavailableException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

const CHAT_COMPLETIONS_URL = "https://api.openai.com/v1/chat/completions";
const DEFAULT_MODEL = "gpt-4o-mini";

export interface CoverLetterResult {
  clientNeeds: string;
  niche: string;
  coverLetter: string;
}

/**
 * Thin fetch() wrapper for OpenAI's Chat Completions API (Part: Upwork
 * Proposal Writing, explicit user request — "the ai will be set separately
 * for this... i will be giving you a paid chatgpt api"). Same pattern as
 * every other third-party HTTP integration in this codebase (LinkedIn/X
 * providers under social-media/providers/) — a plain `fetch`, no SDK
 * dependency, kept deliberately narrow to the one call this module needs.
 */
@Injectable()
export class OpenAiClient {
  private readonly logger = new Logger(OpenAiClient.name);

  constructor(private readonly config: ConfigService) {}

  private apiKey(): string {
    const key = this.config.get<string>("OPENAI_API_KEY");
    if (!key) {
      throw new ServiceUnavailableException(
        "OPENAI_API_KEY isn't set — add it to the API's .env to enable Proposal Writing.",
      );
    }
    return key;
  }

  private model(): string {
    return this.config.get<string>("OPENAI_MODEL") ?? DEFAULT_MODEL;
  }

  /** `systemPrompt` carries the org's editable instructions (tone, agency
   *  background, word count — see UpworkProposalWritingSettings); `jobBrief`
   *  is the fetched job details rendered as plain text. Uses JSON mode so
   *  the three sections the user explicitly asked to always see (client
   *  needs, niche, cover letter) come back as distinct fields rather than
   *  one blob this service would then have to re-split by guessing at
   *  headings. */
  async generateCoverLetter(systemPrompt: string, jobBrief: string): Promise<CoverLetterResult> {
    const res = await fetch(CHAT_COMPLETIONS_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: this.model(),
        response_format: { type: "json_object" },
        temperature: 0.7,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: jobBrief },
        ],
      }),
    });

    const payload = await res.json().catch(() => null);
    if (!res.ok) {
      const message = payload?.error?.message ?? `OpenAI request failed (${res.status})`;
      this.logger.warn(`OpenAI chat completion failed: ${message}`);
      throw new ServiceUnavailableException(message);
    }

    const raw = payload?.choices?.[0]?.message?.content;
    if (!raw) {
      throw new ServiceUnavailableException("OpenAI returned an empty response.");
    }

    let parsed: Partial<CoverLetterResult>;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new ServiceUnavailableException("OpenAI returned a response that wasn't valid JSON.");
    }

    if (!parsed.coverLetter) {
      throw new ServiceUnavailableException("OpenAI's response was missing a cover letter.");
    }

    return {
      clientNeeds: parsed.clientNeeds ?? "",
      niche: parsed.niche ?? "",
      coverLetter: parsed.coverLetter,
    };
  }
}
