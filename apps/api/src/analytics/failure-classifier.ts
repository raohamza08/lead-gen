/**
 * Buckets EmailMessage.failureReason strings into the category shape the
 * Email Performance dashboard's failure breakdown shows (Part: Lead Upload
 * Analytics / Email Performance / Ignore Groups, 2026-09-01) — same
 * keyword-matching pattern as agent-execution.service.ts's `classifyError`,
 * applied to a different subsystem's error strings (not shared code: the
 * inputs come from EmailProviderService/ComplianceGateError and real SMTP/
 * Gmail-API exceptions, not agent dispatch failures).
 *
 * Deliberately no "Claude/API" bucket: sending has zero AI/Claude
 * involvement (only drafting does, confirmed by reading
 * EmailProviderService.sendForLead/sendMessageNow in full during the
 * Preparation Pipeline work) — a bucket that can never be non-zero would be
 * exactly the kind of misleading dashboard number this whole feature exists
 * to avoid. Drafting failures already have their own breakdown via
 * AgentExecution.errorSummary.
 */
export type SendFailureCategory = "INVALID_EMAIL" | "SUPPRESSED" | "PROVIDER_LIMIT" | "SMTP_PROVIDER_ERROR" | "OTHER";

export function classifySendFailure(raw: string): SendFailureCategory {
  const text = raw.toLowerCase();

  if (text.includes("no verified email") || text.includes("invalid recipient") || text.includes("mailbox unavailable")) {
    return "INVALID_EMAIL";
  }
  if (text.includes("suppression list") || text.includes("unsubscribed") || text.includes("spam complaint")) {
    return "SUPPRESSED";
  }
  if (text.includes("daily/hourly send limit") || text.includes("rate limit") || text.includes("quota") || text.includes("too many")) {
    return "PROVIDER_LIMIT";
  }
  if (
    text.includes("smtp") ||
    text.includes("econnrefused") ||
    text.includes("etimedout") ||
    text.includes("invalid login") ||
    text.includes("connection")
  ) {
    return "SMTP_PROVIDER_ERROR";
  }
  return "OTHER";
}

export const SEND_FAILURE_CATEGORY_LABELS: Record<SendFailureCategory, string> = {
  INVALID_EMAIL: "Invalid Email",
  SUPPRESSED: "Suppressed/Compliance",
  PROVIDER_LIMIT: "Provider Limit",
  SMTP_PROVIDER_ERROR: "SMTP/Provider Error",
  OTHER: "Other",
};
