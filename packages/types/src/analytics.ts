export interface AnalyticsSummary {
  todaysLeads: number;
  weeklyLeads: number;
  monthlyLeads: number;
  verifiedLeads: number;
  duplicateRate: number;
  avgLeadScore: number;
  avgAiOpportunityScore: number;
  pendingReviews: number;
  tasksWaiting: number;
  meetingsBooked: number;
  wonDeals: number;
  lostDeals: number;
  systemErrors: number;
}

export interface FunnelStageCount {
  stage: string;
  count: number;
}

/**
 * The full email-tracking board the spec asks for. Counts are per *message*,
 * not per raw event — a recipient who opens the same email five times counts
 * once, otherwise open rate silently exceeds 100%.
 */
export interface EmailPerformance {
  queued: number;
  sent: number;
  delivered: number;
  opened: number;
  notOpened: number;
  clicked: number;
  replied: number;
  bounced: number;
  spamComplaints: number;
  unsubscribed: number;
  blocked: number;
  failed: number;
  deliveryRate: number;
  openRate: number;
  replyRate: number;
  clickRate: number;
  meetingRate: number;
  conversionRate: number;
}

/** Same board, sliced by sequence step (1 = intro, 2 = case study, 3 = Gemini pitch). */
export interface EmailStepPerformance extends EmailPerformance {
  step: number;
}

export interface EmailFunnelReport {
  overall: EmailPerformance;
  bySequenceStep: EmailStepPerformance[];
}

export interface LinkedinStatusCount {
  status: string;
  count: number;
}

export interface LinkedinFunnelReport {
  statusCounts: LinkedinStatusCount[];
  totalTracked: number;
  acceptanceRate: number;
  replyRate: number;
  meetingRate: number;
}

export interface RevenuePipelineStage {
  stage: string;
  count: number;
  value: number;
}

export interface RevenuePipelineReport {
  stages: RevenuePipelineStage[];
  openPipelineValue: number;
  wonValue: number;
  lostValue: number;
  winRate: number;
  avgDealValue: number;
}

export interface CohortTrendPoint {
  /** UTC calendar day, `YYYY-MM-DD`. */
  date: string;
  leadsCreated: number;
  verifiedLeads: number;
  emailsSent: number;
  replies: number;
  meetingsBooked: number;
  avgLeadScore: number;
}

export interface CohortTrendsReport {
  days: number;
  points: CohortTrendPoint[];
}

/** One row in the Opened/Replied lists on the Analytics page — a message
 *  with enough lead context to be useful without a second lookup. */
export interface EmailListItem {
  id: string;
  leadId: string;
  companyName: string;
  contactName: string | null;
  subject: string;
  sequenceStep: number;
  sentAt: string | null;
  /** When the event this list is filtered to (opened/replied) occurred. A
   *  message opened more than once takes the earliest open. */
  eventAt: string;
}

/** One piece of copy-level feedback from the learning agent, tied to real
 *  sent-email excerpts rather than only aggregate rates. */
export interface EmailImprovement {
  title: string;
  observation: string;
  suggestion: string;
  evidence: string;
}

/** Persisted result of the analytics/learning agent pipeline — survives a
 *  page reload instead of only living in React state until the next click. */
export interface AiInsightsSnapshot {
  generatedAt: string;
  insights: Record<string, unknown> | null;
  recommendations: Record<string, unknown> | null;
  emailImprovements: EmailImprovement[];
}
