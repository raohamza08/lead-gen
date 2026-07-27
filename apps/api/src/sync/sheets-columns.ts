/** Column order matches Part F5 of the architecture doc exactly. */
export const SHEETS_COLUMNS = [
  "Lead ID", "Company Name", "Website", "Website Verified", "LinkedIn URL", "LinkedIn Verified",
  "Contact Name", "Job Title", "Email", "Email Verified", "Phone", "Industry", "Sub-Niche",
  "Country", "City", "Company Size", "Revenue Band", "Employee Count", "Tech Stack",
  "Business Model", "B2B/B2C", "Business Description", "Current CRM", "Lead Score",
  "Confidence Score", "AI Opportunity Score", "Automation Score", "CRM Readiness Score",
  "Website Quality Score", "Fit Reason", "Suggested Services", "Expected Value", "Priority",
  "Pipeline Stage", "Assigned User", "Created Date", "Last Activity", "Next Follow-up",
  "ClickUp Task URL",
] as const;

export function leadToSheetRow(lead: {
  id: string; companyName: string; website: string | null; verifiedWebsite: boolean;
  linkedinUrl: string | null; verifiedLinkedin: boolean; contactName: string | null;
  jobTitle: string | null; email: string | null; verifiedEmail: boolean; phone: string | null;
  industry: string | null; subNiche: string | null; country: string | null; city: string | null;
  companySize: string | null; revenueBand: string | null; employeeCount: number | null;
  techStack: unknown; businessModel: string | null; b2bOrB2c: string | null;
  businessDescription: string | null; currentCrm: string | null;
  score?: { leadScore: number; confidenceScore: number; aiOpportunityScore: number; automationScore: number; crmReadinessScore: number; websiteQualityScore: number; fitReason: string | null; suggestedServices: string | null; expectedValue: unknown; priority: string | null } | null;
  pipelineState?: { stage: string; nextActionAt: Date | null } | null;
  assignedUser?: { name: string } | null;
  createdAt: Date; lastActivityAt: Date | null;
}): (string | number)[] {
  return [
    lead.id, lead.companyName, lead.website ?? "", lead.verifiedWebsite ? "Yes" : "No",
    lead.linkedinUrl ?? "", lead.verifiedLinkedin ? "Yes" : "No", lead.contactName ?? "",
    lead.jobTitle ?? "", lead.email ?? "", lead.verifiedEmail ? "Yes" : "No", lead.phone ?? "",
    lead.industry ?? "", lead.subNiche ?? "", lead.country ?? "", lead.city ?? "",
    lead.companySize ?? "", lead.revenueBand ?? "", lead.employeeCount ?? "",
    JSON.stringify(lead.techStack ?? []), lead.businessModel ?? "", lead.b2bOrB2c ?? "",
    lead.businessDescription ?? "", lead.currentCrm ?? "",
    lead.score?.leadScore ?? "", lead.score?.confidenceScore ?? "", lead.score?.aiOpportunityScore ?? "",
    lead.score?.automationScore ?? "", lead.score?.crmReadinessScore ?? "", lead.score?.websiteQualityScore ?? "",
    lead.score?.fitReason ?? "", lead.score?.suggestedServices ?? "", String(lead.score?.expectedValue ?? ""),
    lead.score?.priority ?? "", lead.pipelineState?.stage ?? "", lead.assignedUser?.name ?? "",
    lead.createdAt.toISOString(), lead.lastActivityAt?.toISOString() ?? "",
    lead.pipelineState?.nextActionAt?.toISOString() ?? "", "",
  ];
}
