/**
 * The lead-targeting filter taxonomy (Sales Navigator-style), in one place.
 *
 * This is the single source of truth shared by three consumers that must never
 * drift apart: the settings UI renders these as the selectable options, the API
 * DTO validates submitted values against them, and the Claude lead-finder
 * prompt is built from them. A value that exists in only two of the three
 * produces filters a user can pick but that silently never match anything.
 *
 * Deliberately NOT included: the niche itself. Industry/niche/sub-niche are
 * free text supplied by the user per filter — the platform targets whatever
 * vertical its operator sells into, so hardcoding a vertical list here would
 * make the product narrower than the spec.
 *
 * Every option below is chosen as a *purchase-intent signal* for the services
 * this platform sells (AI automation, AI agents, CRM automation, custom
 * software, SaaS development, workflow automation, digital transformation) —
 * not as a generic firmographic taxonomy.
 */

/** A selectable option plus why it predicts a sale. The `why` text is shown as
 *  help in the UI and is fed to the lead-finder so the model knows what to
 *  actually look for, rather than pattern-matching a bare label. */
export interface FilterOption {
  value: string;
  label: string;
  why: string;
}

/**
 * 4. Company Type — how the company is owned/structured.
 * Ownership predicts budget authority and sales cycle far better than size:
 * an owner-operated business can buy on one conversation, a public company
 * cannot.
 */
export const COMPANY_TYPES: FilterOption[] = [
  { value: "PRIVATELY_HELD", label: "Privately held", why: "Owner or small board can authorise spend without a procurement cycle." },
  { value: "OWNER_OPERATED", label: "Owner-operated / founder-led", why: "Single decision maker who feels the operational pain personally; shortest path to signature." },
  { value: "AGENCY", label: "Agency / consultancy", why: "Sells billable hours, so automating delivery converts directly into margin — the easiest ROI case to make." },
  { value: "STARTUP", label: "Startup", why: "Builds processes from scratch, no legacy system to rip out, and expects to buy software." },
  { value: "FRANCHISE_MULTI_LOCATION", label: "Franchise / multi-location", why: "Same manual process repeated per site, so automation value multiplies by location count." },
  { value: "PUBLIC", label: "Publicly traded", why: "Large budgets but long procurement and security review; qualify only for high-value transformation work." },
  { value: "NONPROFIT", label: "Nonprofit / NGO", why: "Genuine need, constrained budgets — include only when running a lower-priced offer." },
  { value: "GOVERNMENT", label: "Government / public sector", why: "Tender-based buying and long cycles; usually excluded unless you hold the relevant certifications." },
];

/**
 * 6. Growth Stage — where the company is in its lifecycle.
 * This is a proxy for *whether the pain exists yet*. Too early and there's no
 * process to automate; too mature and a systems-integration incumbent already
 * owns the account.
 */
export const GROWTH_STAGES: FilterOption[] = [
  { value: "PRE_SEED", label: "Pre-seed / idea", why: "No budget and no process worth automating. Usually excluded." },
  { value: "SEED", label: "Seed", why: "Buys MVP and custom build work, but price-sensitive." },
  { value: "SERIES_A", label: "Series A", why: "Has money and is scaling manual processes that just started to break — a strong automation window." },
  { value: "SERIES_B_PLUS", label: "Series B+", why: "Budget plus real operational complexity; the best fit for AI agents and platform work." },
  { value: "BOOTSTRAPPED_PROFITABLE", label: "Bootstrapped & profitable", why: "Spends own money, so demands hard ROI — but decides fast and stays a long time." },
  { value: "SCALING", label: "Scaling / high growth", why: "Headcount growing faster than systems. The single strongest automation-purchase signal." },
  { value: "MATURE_STABLE", label: "Mature / stable", why: "Legacy stack and digital-transformation budget, but slower and more competitive to win." },
  { value: "TURNAROUND", label: "Turnaround / cost-cutting", why: "Actively hunting cost reduction, which is exactly what automation sells as." },
];

/**
 * 9. Department — which function the buying contact sits in.
 * Used to steer contact discovery toward whoever owns the broken process,
 * rather than whoever is easiest to find.
 */
export const DEPARTMENTS: FilterOption[] = [
  { value: "OPERATIONS", label: "Operations", why: "Owns the manual workflows; usually the strongest internal champion." },
  { value: "EXECUTIVE", label: "Executive / general management", why: "Holds budget authority and can shortcut the process entirely." },
  { value: "IT", label: "IT / engineering", why: "Technical evaluator. Can approve or veto — engage, never bypass." },
  { value: "SALES", label: "Sales", why: "Feels CRM pain daily and can usually fund CRM automation from its own budget." },
  { value: "MARKETING", label: "Marketing", why: "Early adopter of AI content and lead-routing automation; fast to pilot." },
  { value: "CUSTOMER_SUPPORT", label: "Customer support", why: "Highest-volume repetitive workload, so AI agents show measurable deflection quickly." },
  { value: "FINANCE", label: "Finance / accounting", why: "Invoice, approval and reconciliation flows are prime automation targets with clean ROI maths." },
  { value: "HR", label: "HR / people", why: "Onboarding and recruitment paperwork automates well, though budgets are smaller." },
];

/**
 * 11. Seniority Level — how senior the contact is.
 * Governs the opening message as much as the targeting: a C-level contact gets
 * a business-outcome pitch, a manager gets a workflow-pain pitch.
 */
export const SENIORITY_LEVELS: FilterOption[] = [
  { value: "FOUNDER_OWNER", label: "Founder / owner", why: "Final authority, no internal selling required. Highest close rate in SMB." },
  { value: "C_LEVEL", label: "C-level", why: "Budget holder. Pitch business outcomes, not features." },
  { value: "VP", label: "VP", why: "Owns the function and its budget; typically the real economic buyer in mid-market." },
  { value: "DIRECTOR", label: "Director", why: "Close enough to the pain to describe it precisely, senior enough to sponsor a pilot." },
  { value: "HEAD_OF", label: "Head of / lead", why: "Common title in flat SMB and startup teams; often the de facto owner." },
  { value: "MANAGER", label: "Manager", why: "Feels the pain most acutely but usually needs a sponsor. Useful as a champion, not a buyer." },
  { value: "INDIVIDUAL_CONTRIBUTOR", label: "Individual contributor", why: "Rarely a buyer. Include only for technical validation." },
];

/**
 * 13. Hiring Activity — what a company's open roles reveal.
 * Job postings are the most reliable *public* intent signal available: a
 * company hiring three ops coordinators is publishing the fact that it has a
 * manual-process problem and a budget to solve it.
 */
export const HIRING_SIGNALS: FilterOption[] = [
  { value: "HIRING_OPS_ROLES", label: "Hiring operations / admin roles", why: "Throwing people at a process problem. The clearest automation opening there is — the budget already exists as salary." },
  { value: "HIRING_DATA_ENTRY", label: "Hiring data entry / back office", why: "Explicitly hiring humans to move data between systems, which is the definition of an integration project." },
  { value: "HIRING_ENGINEERS", label: "Hiring software engineers", why: "Has an internal build appetite and budget; sell augmentation rather than replacement." },
  { value: "HIRING_AI_ML", label: "Hiring AI / ML roles", why: "Already committed to AI strategically. Sells itself internally; you supply delivery capacity." },
  { value: "HIRING_CUSTOMER_SUPPORT", label: "Hiring support agents", why: "Support volume outgrowing the team — the standard AI-agent deflection case." },
  { value: "HIRING_SALES", label: "Hiring sales / SDRs", why: "Growing pipeline pressure, which drives CRM and sales-automation spend." },
  { value: "RAPID_HEADCOUNT_GROWTH", label: "Rapid headcount growth", why: "Systems almost never keep pace with hiring; the gap is the opportunity." },
  { value: "NO_RECENT_HIRING", label: "No recent hiring", why: "Either stable or contracting. Useful as an exclusion, or to target cost-reduction messaging." },
];

/**
 * 16. Website / Technology Conditions — what the public web presence implies.
 * These are *observable without a data vendor*: the lead-finder can verify each
 * one by fetching the site, which is what keeps the signal honest.
 */
export const WEBSITE_CONDITIONS: FilterOption[] = [
  { value: "OUTDATED_WEBSITE", label: "Outdated / dated website", why: "Visible under-investment in digital, and a concrete opening observation for the first email." },
  { value: "NO_ONLINE_BOOKING", label: "No online booking or scheduling", why: "Appointments are being handled by phone and email — a self-contained, easy first automation win." },
  { value: "MANUAL_CONTACT_FORM", label: "Basic contact form only", why: "Enquiries land in an inbox with no routing or CRM, so leads are demonstrably being lost." },
  { value: "NO_LIVE_CHAT", label: "No live chat or chatbot", why: "Direct opening for an AI support or qualification agent." },
  { value: "NO_CUSTOMER_PORTAL", label: "No customer portal / self-service", why: "Every status request is handled by a human. Strong custom-software case." },
  { value: "NO_ECOMMERCE", label: "No online payment or checkout", why: "Manual invoicing and quoting, which automates cleanly." },
  { value: "SLOW_OR_UNOPTIMISED", label: "Slow or poorly optimised site", why: "Measurable, provable problem — the highest-credibility way to open a cold email." },
  { value: "NOT_MOBILE_FRIENDLY", label: "Not mobile friendly", why: "Signals the site has not been revisited in years; usually true of the back office too." },
];

/**
 * 17. AI Opportunity Indicators — the strongest predictors of purchase.
 * Explicitly separated from firmographics: industry and headcount tell you who
 * a company *is*, these tell you whether it will actually *buy*. Weight them
 * hardest in scoring.
 */
export const AI_OPPORTUNITY_SIGNALS: FilterOption[] = [
  { value: "MANUAL_WORKFLOWS", label: "Manual / spreadsheet-run workflows", why: "The core qualifying signal. No spreadsheet dependency, no automation sale." },
  { value: "NO_CRM", label: "No CRM in use", why: "Greenfield CRM implementation plus the automation layer on top." },
  { value: "LEGACY_CRM", label: "Legacy or underused CRM", why: "Already believes in the category and is already paying — an easier upgrade than a first purchase." },
  { value: "DISCONNECTED_TOOLS", label: "Disconnected tools / no integration", why: "Staff are the integration layer, moving data by hand between systems. Sells itself." },
  { value: "HIGH_TICKET_VOLUME", label: "High support / enquiry volume", why: "Volume makes the AI-agent ROI arithmetic trivial to demonstrate." },
  { value: "REPETITIVE_DOCUMENT_WORK", label: "Heavy document / form processing", why: "Intake, quoting and compliance paperwork are ideal document-AI targets." },
  { value: "COMPLIANCE_HEAVY", label: "Compliance-heavy operations", why: "Audit trails and reporting justify spend that pure efficiency gains cannot." },
  { value: "MULTI_SYSTEM_DATA_ENTRY", label: "Duplicate data entry across systems", why: "Same record typed into several tools — the most quantifiable time saving to put in a proposal." },
  { value: "RECENT_AI_INTEREST", label: "Publicly exploring AI", why: "Stated intent in posts, job ads or press. Removes the need to create the category." },
  { value: "SEASONAL_CAPACITY_SPIKES", label: "Seasonal demand spikes", why: "Automation flexes where hiring cannot; strong argument ahead of peak season." },
];

/**
 * 18. Exclusion Filters — who to actively keep out.
 * Exclusions raise lead quality more per unit of effort than any inclusion
 * filter, because they remove the categories that consume sales time and never
 * close.
 */
export const EXCLUSION_SIGNALS: FilterOption[] = [
  { value: "COMPETING_AGENCIES", label: "Competing AI / automation agencies", why: "Sells what you sell. They benchmark, they don't buy." },
  { value: "IT_OUTSOURCING_FIRMS", label: "Dev shops / IT outsourcing", why: "Has in-house delivery capacity and competes on the same work." },
  { value: "TOO_SMALL", label: "Under ~5 employees", why: "Below the threshold where process pain or budget exists. The largest source of wasted outreach." },
  { value: "ENTERPRISE_TOO_LARGE", label: "Enterprise (5,000+)", why: "Procurement, vendor onboarding and security review outlast most sales cycles." },
  { value: "STUDENTS_ACADEMIA", label: "Students / academic projects", why: "No commercial budget." },
  { value: "RECRUITMENT_SPAM_PRONE", label: "Staffing / lead-list resellers", why: "Reply rates look healthy but convert to nothing; they're prospecting you back." },
  { value: "ALREADY_CUSTOMER", label: "Existing customers", why: "Cold-emailing a live account damages the relationship — a hard exclusion, not a preference." },
  { value: "PREVIOUSLY_LOST", label: "Previously lost / disqualified", why: "Re-approaching too soon burns the account. Suppress for a cooling-off period." },
  { value: "NO_WEBSITE", label: "No working website", why: "Cannot be verified or personalised, and correlates with being dormant." },
  { value: "PERSONAL_EMAIL_ONLY", label: "Free email domain only", why: "No business domain usually means no real business — and it hurts deliverability." },
];

/** Every catalogue keyed by the NicheFilter field it populates. Used by the DTO
 *  validator and the settings UI so neither has its own copy. */
export const FILTER_TAXONOMY = {
  companyTypes: COMPANY_TYPES,
  growthStages: GROWTH_STAGES,
  departments: DEPARTMENTS,
  seniorityLevels: SENIORITY_LEVELS,
  hiringSignals: HIRING_SIGNALS,
  websiteConditions: WEBSITE_CONDITIONS,
  aiOpportunitySignals: AI_OPPORTUNITY_SIGNALS,
  exclusionSignals: EXCLUSION_SIGNALS,
} as const;

export type FilterTaxonomyKey = keyof typeof FILTER_TAXONOMY;

/** Valid values for one catalogue — the allowlist the DTO validates against. */
export function allowedValues(key: FilterTaxonomyKey): string[] {
  return FILTER_TAXONOMY[key].map((o) => o.value);
}

/** Human label for a stored value, falling back to the raw value so an option
 *  removed from the catalogue still renders rather than showing blank. */
export function labelFor(key: FilterTaxonomyKey, value: string): string {
  return FILTER_TAXONOMY[key].find((o) => o.value === value)?.label ?? value;
}
