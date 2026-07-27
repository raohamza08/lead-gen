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

export interface EmailPerformance {
  sent: number;
  delivered: number;
  opened: number;
  clicked: number;
  replied: number;
  bounced: number;
  spamComplaints: number;
  unsubscribed: number;
  deliveryRate: number;
  openRate: number;
  replyRate: number;
  clickRate: number;
}
