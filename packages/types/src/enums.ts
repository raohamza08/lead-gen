export enum Role {
  ADMIN = "ADMIN",
  MANAGER = "MANAGER",
  LEAD_REVIEWER = "LEAD_REVIEWER",
  SALES_REP = "SALES_REP",
  VIEWER = "VIEWER",
}

/**
 * The full sales pipeline. **Declaration order is the funnel order** — the
 * analytics funnel chart renders `Object.values(PipelineStage)` directly, so
 * inserting a stage in the wrong position silently misdraws the chart.
 *
 * WON is deliberately NOT terminal: client onboarding follows a closed deal,
 * and modelling onboarding outside the pipeline would lose the handover that
 * decides whether the customer is retained.
 *
 * READY_FOR_OUTREACH is the entry stage — every lead lands here the moment
 * it's created or promoted from Lead Room. There used to be four checkpoints
 * ahead of it (NEW_LEAD/VERIFIED/RESEARCH_COMPLETED/UNDER_REVIEW), but no
 * agent or automation was ever gated on any of them: the AI research pipeline
 * runs off lead creation regardless of stage, and the only real gate —
 * `verifiedEmail` — now applies right here, via the "Verify emails" action on
 * this column. Removed 2026-08-29 rather than kept as dead checkpoints a lead
 * had to be walked through with nothing behind the move.
 */
export enum PipelineStage {
  READY_FOR_OUTREACH = "READY_FOR_OUTREACH",
  /** Problem Trigger — one felt industry pain point. EurosHub is never named
   *  in this email except the signature (Part: 5-email sequence, 2026-08-12). */
  EMAIL_1_SENT = "EMAIL_1_SENT",
  WAITING_EMAIL_2 = "WAITING_EMAIL_2",
  /** Industry Insight — a real AI/automation shift in their industry, framed
   *  as market observation. Still no pitch. */
  EMAIL_2_SENT = "EMAIL_2_SENT",
  WAITING_EMAIL_3 = "WAITING_EMAIL_3",
  /** Proof — the first email allowed to name EurosHub as the "who" behind a
   *  result. No invented statistics; an unverified figure must stay a
   *  bracketed placeholder and routes to human approval, never auto-sends. */
  EMAIL_3_SENT = "EMAIL_3_SENT",
  WAITING_EMAIL_4 = "WAITING_EMAIL_4",
  /** Soft Offer — the first ask, and it must be low-friction (an audit, a
   *  quick call), never a services/solutions pitch. */
  EMAIL_4_SENT = "EMAIL_4_SENT",
  WAITING_EMAIL_5 = "WAITING_EMAIL_5",
  /** Breakup — short, no guilt, closes the sequence. */
  EMAIL_5_SENT = "EMAIL_5_SENT",
  LINKEDIN_OUTREACH = "LINKEDIN_OUTREACH",
  /** Connection accepted, follow-up message sent. */
  LINKEDIN_FOLLOW_UP = "LINKEDIN_FOLLOW_UP",
  REPLIED = "REPLIED",
  MEETING_BOOKED = "MEETING_BOOKED",
  PROPOSAL_SENT = "PROPOSAL_SENT",
  NEGOTIATION = "NEGOTIATION",
  WON = "WON",
  CLIENT_ONBOARDING = "CLIENT_ONBOARDING",
  LOST = "LOST",
}

export enum UrgencyLevel {
  LOW = "LOW",
  MEDIUM = "MEDIUM",
  HIGH = "HIGH",
}

export enum EmailEventType {
  QUEUED = "QUEUED",
  SENT = "SENT",
  DELIVERED = "DELIVERED",
  OPENED = "OPENED",
  CLICKED = "CLICKED",
  REPLIED = "REPLIED",
  BOUNCED = "BOUNCED",
  SPAM_COMPLAINT = "SPAM_COMPLAINT",
  UNSUBSCRIBED = "UNSUBSCRIBED",
  BLOCKED = "BLOCKED",
  FAILED = "FAILED",
}

export enum LinkedinStatus {
  NOT_STARTED = "NOT_STARTED",
  CONNECTION_SENT = "CONNECTION_SENT",
  ACCEPTED = "ACCEPTED",
  MESSAGE_SENT = "MESSAGE_SENT",
  REPLIED = "REPLIED",
  MEETING_SCHEDULED = "MEETING_SCHEDULED",
}

export enum EmailMessageStatus {
  DRAFT = "DRAFT",
  PENDING_APPROVAL = "PENDING_APPROVAL",
  QUEUED = "QUEUED",
  SENT = "SENT",
  FAILED = "FAILED",
  CANCELLED = "CANCELLED",
}

export enum BusinessModel {
  B2B = "B2B",
  B2C = "B2C",
  B2B2C = "B2B2C",
}

/**
 * Where a lead's contact/company data actually came from. Deliberately only
 * two automated sources: SURFACE_WEB (the Claude discovery agent's public web
 * search — everything the pipeline finds today) and LICENSED_DATABASE (a paid
 * B2B data provider accessed under its API/ToS — Crunchbase/Apollo/ZoomInfo-
 * style, not yet wired to a specific provider). There is deliberately no
 * "dark web" value: sourcing sales contacts from Tor/onion sites means either
 * stolen/breached personal data or illicit-marketplace listings, neither of
 * which has a lawful basis for outreach under GDPR/CCPA — there is no filter
 * that makes that sourcing safe, so it was never built rather than built and
 * gated.
 */
export enum LeadSourceLayer {
  SURFACE_WEB = "SURFACE_WEB",
  LICENSED_DATABASE = "LICENSED_DATABASE",
  MANUAL = "MANUAL",
  EMAIL = "EMAIL",
  SOCIAL_MEDIA = "SOCIAL_MEDIA",
}
