import { BusinessModel, LeadSourceLayer, PipelineStage, UrgencyLevel } from "./enums";

export interface TechStackEntry {
  name: string;
  category?: string;
}

/** Matches the LEAD entity in Part B4 of the architecture doc. */
export interface Lead {
  id: string;
  orgId: string;
  runId: string | null;
  assignedUserId: string | null;
  companyName: string;
  sourceLayer: LeadSourceLayer;
  website: string | null;
  websiteDomain: string | null;
  linkedinUrl: string | null;
  contactName: string | null;
  jobTitle: string | null;
  email: string | null;
  personalEmail: string | null;
  phone: string | null;
  industry: string | null;
  subNiche: string | null;
  country: string | null;
  city: string | null;
  companySize: string | null;
  revenueBand: string | null;
  employeeCount: number | null;
  techStack: TechStackEntry[];
  businessModel: BusinessModel | null;
  b2bOrB2c: "B2B" | "B2C" | null;
  businessDescription: string | null;
  currentCrm: string | null;
  verifiedEmail: boolean;
  verifiedLinkedin: boolean;
  verifiedWebsite: boolean;
  possibleDuplicate: boolean;
  createdAt: string;
  lastActivityAt: string | null;
}

/** Matches LEAD_SCORE. All scores 0-100, see Part D3 rubric. */
export interface LeadScore {
  id: string;
  leadId: string;
  leadScore: number;
  confidenceScore: number;
  aiOpportunityScore: number;
  automationScore: number;
  crmReadinessScore: number;
  websiteQualityScore: number;
  fitReason: string | null;
  suggestedServices: string | null;
  expectedValue: number | null;
  priority: "LOW" | "MEDIUM" | "HIGH" | null;
  scoredAt: string;
}

/** Matches REVIEW_NOTE — the human-editable fields (Part F3 / F6). */
export interface ReviewNote {
  id: string;
  leadId: string;
  reviewerId: string | null;
  websiteIssues: string | null;
  businessProblems: string | null;
  opportunities: string | null;
  automationOpportunities: string | null;
  crmIssues: string | null;
  salesIssues: string | null;
  marketingIssues: string | null;
  operationalIssues: string | null;
  suggestedService: string | null;
  suggestedOffer: string | null;
  suggestedCaseStudy: string | null;
  suggestedHook: string | null;
  painPoints: string | null;
  urgencyLevel: UrgencyLevel | null;
  expectedValue: number | null;
  notes: string | null;
  updatedAt: string;
}

export interface PipelineState {
  leadId: string;
  stage: PipelineStage;
  enteredStageAt: string;
  nextActionAt: string | null;
  previousStage: PipelineStage | null;
}

/** Full lead detail payload returned by GET /leads/:id */
export interface LeadDetail {
  lead: Lead;
  score: LeadScore | null;
  reviewNote: ReviewNote | null;
  pipelineState: PipelineState;
}
