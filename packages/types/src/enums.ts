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
 */
export enum PipelineStage {
  NEW_LEAD = "NEW_LEAD",
  /** Website, LinkedIn and email checked. Distinct from NEW_LEAD so the
   *  "leads verified" metric measures something real rather than an insert. */
  VERIFIED = "VERIFIED",
  /** Research agent finished enriching. Separated from review because research
   *  is automated and review is not — merging them hides which one is the
   *  bottleneck when leads pile up. */
  RESEARCH_COMPLETED = "RESEARCH_COMPLETED",
  UNDER_REVIEW = "UNDER_REVIEW",
  READY_FOR_OUTREACH = "READY_FOR_OUTREACH",
  EMAIL_1_SENT = "EMAIL_1_SENT",
  WAITING_2_DAYS = "WAITING_2_DAYS",
  EMAIL_2_SENT = "EMAIL_2_SENT",
  WAITING_1_2_DAYS = "WAITING_1_2_DAYS",
  GEMINI_DRAFTING = "GEMINI_DRAFTING",
  PERSONALIZED_PITCH = "PERSONALIZED_PITCH",
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
