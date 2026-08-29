import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

export interface EmailVerificationResult {
  valid: boolean;
  reason: string;
}

/**
 * Node-side counterpart to apps/ai-workers/claude_agent/verifier.py's
 * verify_email — same NeverBounce-or-syntactic-fallback logic. Needed here
 * because that Python check only ever runs once, against a discovery
 * candidate before it's persisted; a human-entered or CSV-imported lead's
 * email is never checked otherwise, which is what left leads stalled before
 * READY_FOR_OUTREACH (see LeadsService.verifyEmail).
 */
@Injectable()
export class EmailVerificationService {
  private readonly logger = new Logger(EmailVerificationService.name);

  constructor(private readonly config: ConfigService) {}

  async verify(email: string): Promise<EmailVerificationResult> {
    const apiKey = this.config.get<string>("NEVERBOUNCE_API_KEY");
    if (!apiKey) {
      // DEMO MODE: syntactic check only, same fallback as verifier.py — no
      // real deliverability check without a NeverBounce key configured.
      const domain = email.split("@")[1] ?? "";
      return {
        valid: domain.includes("."),
        reason: "syntax check only — no NEVERBOUNCE_API_KEY configured",
      };
    }

    try {
      const url = new URL("https://api.neverbounce.com/v4/single/check");
      url.searchParams.set("key", apiKey);
      url.searchParams.set("email", email);
      const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
      if (!res.ok) {
        return { valid: false, reason: `NeverBounce returned HTTP ${res.status}` };
      }
      const body = (await res.json()) as { result?: string };
      return { valid: body.result === "valid", reason: body.result ?? "unknown result" };
    } catch (err) {
      this.logger.warn(`NeverBounce check failed for ${email}: ${(err as Error).message}`);
      return { valid: false, reason: "verification request failed" };
    }
  }
}
