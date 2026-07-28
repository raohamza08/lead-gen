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
  /** PRIMARY targets are pursued first; SECONDARY are viable but lower yield.
   *  Absent means the option carries no tier. */
  tier?: "PRIMARY" | "SECONDARY";
}

/**
 * 1. Industries. Suggestions, not a closed set — `niche` on a filter stays free
 * text so any vertical can be targeted, including ones not listed here. These
 * are the verticals where manual process density and budget most reliably
 * coincide.
 */
export const INDUSTRIES: FilterOption[] = [
  { value: "HEALTHCARE", label: "Healthcare", tier: "PRIMARY", why: "Heavy intake, scheduling and records paperwork, with budget and strong compliance drivers." },
  { value: "SAAS", label: "SaaS", tier: "PRIMARY", why: "Already buys software, so no need to create the category; fastest technical sale." },
  { value: "REAL_ESTATE", label: "Real estate", tier: "PRIMARY", why: "Lead response speed decides commission, so automation maps straight to revenue." },
  { value: "LAW_FIRMS", label: "Law firms", tier: "PRIMARY", why: "Document-heavy and billable-hour driven; document AI has an obvious ROI case." },
  { value: "RECRUITMENT", label: "Recruitment agencies", tier: "PRIMARY", why: "High-volume repetitive screening and outreach; margin scales directly with automation." },
  { value: "FINANCIAL_SERVICES", label: "Financial services", tier: "PRIMARY", why: "Large budgets, heavy reporting and reconciliation workload." },
  { value: "INSURANCE", label: "Insurance", tier: "PRIMARY", why: "Claims and quoting are structured, repetitive and expensive to staff." },
  { value: "ECOMMERCE", label: "E-commerce brands", tier: "PRIMARY", why: "Support volume and order operations scale badly without automation." },
  { value: "MANUFACTURING", label: "Manufacturing", tier: "PRIMARY", why: "Legacy systems and paper processes with real digital-transformation budgets." },
  { value: "LOGISTICS", label: "Logistics", tier: "PRIMARY", why: "Tracking, dispatch and proof-of-delivery are high-volume and error-prone." },
  { value: "EDUCATION", label: "Education", tier: "PRIMARY", why: "Admissions and administration are form-driven and seasonal." },
  { value: "CONSTRUCTION", label: "Construction", tier: "PRIMARY", why: "Quoting, scheduling and compliance still run on spreadsheets almost everywhere." },
  { value: "HOSPITALITY", label: "Hospitality", tier: "PRIMARY", why: "Booking and guest communication automate cleanly and visibly." },
  { value: "PROFESSIONAL_SERVICES", label: "Professional services", tier: "PRIMARY", why: "Sells time, so every hour automated converts into margin." },
  { value: "MARKETING_AGENCIES", label: "Marketing agencies", tier: "SECONDARY", why: "Understands the value quickly, but may build in-house instead of buying." },
  { value: "CONSULTING", label: "Consulting firms", tier: "SECONDARY", why: "Strong budget, though often positions itself as a competitor." },
  { value: "AUTOMOTIVE", label: "Automotive", tier: "SECONDARY", why: "Dealer lead handling and service scheduling are clear automation targets." },
  { value: "FITNESS", label: "Fitness", tier: "SECONDARY", why: "Membership and scheduling flows automate well; budgets are smaller." },
  { value: "BEAUTY_WELLNESS", label: "Beauty & wellness", tier: "SECONDARY", why: "Booking and retention automation; typically low deal size." },
  { value: "TRAVEL", label: "Travel companies", tier: "SECONDARY", why: "Itinerary and support volume suits AI agents." },
  { value: "PROPERTY_MANAGEMENT", label: "Property management", tier: "SECONDARY", why: "Maintenance requests and tenant communication are relentless and repetitive." },
  { value: "ACCOUNTING", label: "Accounting firms", tier: "SECONDARY", why: "Document and invoice processing is the single clearest automation use case." },
];

/**
 * 2. Target countries. Tiered by purchasing power, English-language business
 * norms and willingness to buy from an external vendor.
 *
 * DEPRIORITISED markets are not blocked — they are simply not searched unless
 * explicitly selected, which is what the spec asks for. Encoding them as
 * options rather than a hidden filter keeps the choice visible and reversible.
 */
export const TARGET_COUNTRIES: FilterOption[] = [
  { value: "UNITED_STATES", label: "United States", tier: "PRIMARY", why: "Largest budgets and fastest adoption of new vendors." },
  { value: "CANADA", label: "Canada", tier: "PRIMARY", why: "Similar buying behaviour to the US, less vendor saturation." },
  { value: "UNITED_KINGDOM", label: "United Kingdom", tier: "PRIMARY", why: "Mature outsourcing culture and no language barrier." },
  { value: "GERMANY", label: "Germany", tier: "PRIMARY", why: "Large mid-market with heavy process documentation; longer cycles." },
  { value: "FRANCE", label: "France", tier: "PRIMARY", why: "Strong digital-transformation spend; expect French-language delivery." },
  { value: "NETHERLANDS", label: "Netherlands", tier: "PRIMARY", why: "High digital maturity and very high business-English fluency." },
  { value: "SWITZERLAND", label: "Switzerland", tier: "PRIMARY", why: "High budgets and high willingness to pay for quality." },
  { value: "SWEDEN", label: "Sweden", tier: "PRIMARY", why: "Early technology adopters, flat organisations, accessible decision makers." },
  { value: "NORWAY", label: "Norway", tier: "PRIMARY", why: "High spend per employee, small but wealthy market." },
  { value: "DENMARK", label: "Denmark", tier: "PRIMARY", why: "Digital-first public and private sector." },
  { value: "AUSTRALIA", label: "Australia", tier: "PRIMARY", why: "English-speaking, receptive to remote vendors; timezone is the main constraint." },
  { value: "UAE", label: "United Arab Emirates", tier: "PRIMARY", why: "Aggressive digital-transformation investment and fast decisions." },
  { value: "SAUDI_ARABIA", label: "Saudi Arabia", tier: "PRIMARY", why: "Vision 2030 spending makes AI budgets unusually available." },
  { value: "QATAR", label: "Qatar", tier: "PRIMARY", why: "High budget per project, small market." },
  { value: "PAKISTAN", label: "Pakistan", tier: "SECONDARY", why: "Deprioritised: low willingness to pay Western rates. Select explicitly to include." },
  { value: "INDIA", label: "India", tier: "SECONDARY", why: "Deprioritised: large in-house dev capacity and heavy price competition." },
  { value: "BANGLADESH", label: "Bangladesh", tier: "SECONDARY", why: "Deprioritised: limited budget for external automation vendors." },
  { value: "INDONESIA", label: "Indonesia", tier: "SECONDARY", why: "Deprioritised: growing, but low average deal size today." },
];

/**
 * 3. Employee bands.
 *
 * MICRO is included deliberately rather than hidden, because the spec allows it
 * conditionally — a 1-5 person company that is recently funded, growing fast or
 * hiring aggressively is a legitimate target. Selecting it turns on that
 * conditional rule in the search brief rather than opening the floodgates.
 */
export const EMPLOYEE_BANDS: FilterOption[] = [
  { value: "BAND_10_50", label: "10-50", tier: "PRIMARY", why: "Process pain has appeared but there is no internal IT team to build a fix. Fastest decisions." },
  { value: "BAND_51_200", label: "51-200", tier: "PRIMARY", why: "The sweet spot: real budget, real complexity, still a short decision chain." },
  { value: "BAND_201_500", label: "201-500", tier: "PRIMARY", why: "Departmental budgets and multiple automatable processes; expect a committee." },
  { value: "BAND_501_1000", label: "501-1000", tier: "PRIMARY", why: "Large contracts, formal procurement, longer cycle." },
  { value: "BAND_1_5_CONDITIONAL", label: "1-5 (only if funded / high growth)", tier: "SECONDARY", why: "Normally too small. Include ONLY with recent funding, aggressive hiring or a strong online presence." },
];

/** 4. Revenue bands. Visible revenue signals are themselves a qualifier — a
 *  company with none is usually too small or too opaque to sell to. */
export const REVENUE_BANDS: FilterOption[] = [
  { value: "REV_500K_PLUS", label: "$500K+", tier: "PRIMARY", why: "Minimum for a meaningful project budget to exist at all." },
  { value: "REV_1M_PLUS", label: "$1M+", tier: "PRIMARY", why: "Can fund a serious automation project without board approval." },
  { value: "REV_5M_PLUS", label: "$5M+", tier: "PRIMARY", why: "Multiple departments with budget; supports retained work." },
  { value: "REV_10M_PLUS", label: "$10M+", tier: "PRIMARY", why: "Enterprise-scale deals and platform builds." },
];

/**
 * 5. Growth signals. Distinct from hiring activity: hiring is one signal among
 * several, and these are the observable events that indicate a company is
 * changing — and therefore open to buying.
 */
export const GROWTH_SIGNALS: FilterOption[] = [
  { value: "RECENT_HIRING", label: "Recent hiring", why: "Headcount growth outpacing systems is the classic automation trigger." },
  { value: "NEW_JOB_OPENINGS", label: "Active job openings", why: "Public, dated and specific — the most verifiable growth signal there is." },
  { value: "MARKET_EXPANSION", label: "Expanding into new markets", why: "New geography or segment forces process rework, which is when vendors get hired." },
  { value: "FUNDING_ROUND", label: "Recent funding round", why: "Capital that must be deployed, and a board expecting visible efficiency gains." },
  { value: "NEW_PRODUCT_LAUNCH", label: "New product launched", why: "Launches expose operational gaps in support, onboarding and billing." },
  { value: "WEBSITE_REDESIGN", label: "Recent website redesign", why: "Proves an active digital budget and an existing willingness to hire externally." },
  { value: "TECH_MIGRATION", label: "Technology migration", why: "Mid-migration is the highest-intent moment to sell integration work." },
  { value: "GROWING_CUSTOMER_BASE", label: "Growing customer base", why: "More customers, same headcount — support and onboarding break first." },
  { value: "INCREASING_HEADCOUNT", label: "Increasing employee count", why: "Sustained growth over time, not a one-off hire." },
  { value: "ACTIVE_MARKETING", label: "Active marketing campaigns", why: "Spending to generate leads implies budget and pressure to convert them faster." },
  { value: "HIGH_WEBSITE_TRAFFIC", label: "High website traffic", why: "Traffic without automation means leads are being lost at the point of enquiry." },
  { value: "LEADERSHIP_CHANGE", label: "Recent leadership change", why: "New executives buy to make an early mark; a genuine window that closes." },
];

/** 6. Decision-maker titles with real buying authority. Junior and assistant
 *  titles are excluded by design — they cannot authorise spend. */
export const DECISION_MAKER_TITLES: FilterOption[] = [
  { value: "FOUNDER", label: "Founder", tier: "PRIMARY", why: "Final authority and feels the operational pain personally." },
  { value: "CO_FOUNDER", label: "Co-Founder", tier: "PRIMARY", why: "Same authority as founder; usually owns operations or product." },
  { value: "CEO", label: "CEO", tier: "PRIMARY", why: "Budget holder. Pitch business outcomes, never features." },
  { value: "COO", label: "COO", tier: "PRIMARY", why: "Owns the broken processes. Typically the strongest champion in the building." },
  { value: "CTO", label: "CTO", tier: "PRIMARY", why: "Technical authority who can approve or veto; engage early, never bypass." },
  { value: "VP_OPERATIONS", label: "VP Operations", tier: "PRIMARY", why: "Departmental budget plus direct ownership of the pain." },
  { value: "VP_TECHNOLOGY", label: "VP Technology", tier: "PRIMARY", why: "Owns the systems roadmap and integration decisions." },
  { value: "HEAD_OF_DIGITAL_TRANSFORMATION", label: "Head of Digital Transformation", tier: "PRIMARY", why: "Exists specifically to buy this. Highest-intent title on the list." },
  { value: "HEAD_OF_INNOVATION", label: "Head of Innovation", tier: "PRIMARY", why: "Mandated to pilot new technology, usually with a ring-fenced budget." },
  { value: "IT_DIRECTOR", label: "IT Director", tier: "PRIMARY", why: "Controls systems spend and integration approval." },
  { value: "OPERATIONS_DIRECTOR", label: "Operations Director", tier: "PRIMARY", why: "Closest to the manual work and able to quantify its cost." },
  { value: "MANAGING_DIRECTOR", label: "Managing Director", tier: "PRIMARY", why: "Full P&L authority, common in UK and EU mid-market." },
  { value: "MARKETING_DIRECTOR", label: "Marketing Director", tier: "SECONDARY", why: "Owns CRM and lead-routing budget; a strong entry point for automation." },
];

/** 7. Technology signals. Both directions matter: a modern stack means budget
 *  and integration work, a legacy or absent stack means a replacement sale. */
export const TECHNOLOGY_SIGNALS: FilterOption[] = [
  { value: "SALESFORCE", label: "Salesforce", tier: "PRIMARY", why: "Already invested in CRM. Sell automation and integration on top." },
  { value: "HUBSPOT", label: "HubSpot", tier: "PRIMARY", why: "Mid-market default; usually underused, so the upgrade path is obvious." },
  { value: "ZOHO", label: "Zoho", tier: "PRIMARY", why: "Cost-conscious buyer who has already accepted the category." },
  { value: "MS_DYNAMICS", label: "Microsoft Dynamics", tier: "PRIMARY", why: "Enterprise budget and near-guaranteed integration work." },
  { value: "SHOPIFY", label: "Shopify", tier: "PRIMARY", why: "Order and support automation with a measurable revenue impact." },
  { value: "WORDPRESS", label: "WordPress", tier: "PRIMARY", why: "Usually paired with manual back-office processes and no real integration." },
  { value: "CUSTOM_SOFTWARE", label: "Custom / in-house software", tier: "PRIMARY", why: "Already pays for software. Sell extension rather than replacement." },
  { value: "LEGACY_SYSTEMS", label: "Legacy systems", tier: "PRIMARY", why: "Highest-value modernisation projects, though the longest sales cycle." },
  { value: "NO_CRM_DETECTED", label: "No CRM detected", tier: "PRIMARY", why: "Greenfield: CRM implementation plus the automation layer above it." },
  { value: "NO_CHATBOT", label: "No chatbot / live chat", why: "Direct opening for an AI support or qualification agent." },
  { value: "POOR_INTEGRATIONS", label: "Poorly integrated tools", why: "Staff are acting as the integration layer, moving data between systems by hand." },
  { value: "MANUAL_PROCESSES", label: "Visibly manual processes", why: "The core qualifying signal for every service sold here." },
];

/**
 * 8. AI opportunity types — the *solutions* to propose, distinct from
 * ai-opportunity *signals*, which are the problems observed. Keeping the two
 * apart matters: the signal is what qualifies the lead, the opportunity is what
 * goes in the pitch.
 */
export const AI_OPPORTUNITY_TYPES: FilterOption[] = [
  { value: "CUSTOMER_SUPPORT_AUTOMATION", label: "Customer support automation", why: "Highest-volume repetitive work, so deflection savings are easy to quantify." },
  { value: "AI_CHATBOT", label: "AI chatbot", why: "Visible, fast to deploy, and an ideal low-risk first project." },
  { value: "LEAD_QUALIFICATION", label: "Lead qualification", why: "Ties directly to revenue, which makes the budget conversation simple." },
  { value: "CRM_AUTOMATION", label: "CRM automation", why: "Sales teams feel the pain daily and often hold their own budget." },
  { value: "SALES_AUTOMATION", label: "Sales automation", why: "Measurable in pipeline terms, so results are self-evident." },
  { value: "MARKETING_AUTOMATION", label: "Marketing automation", why: "Marketing budgets are flexible and already tooling-oriented." },
  { value: "DATA_ANALYTICS", label: "Data analytics", why: "Usually a follow-on sale once data has been centralised." },
  { value: "DOCUMENT_PROCESSING", label: "Document processing", why: "Enormous time savings in document-heavy sectors like law and insurance." },
  { value: "INVOICE_AUTOMATION", label: "Invoice automation", why: "Finance can compute the ROI itself, which shortens approval." },
  { value: "WORKFLOW_AUTOMATION", label: "Internal workflow automation", why: "Broadest applicability across every department." },
  { value: "AI_AGENTS", label: "AI agents", why: "Highest-value engagements; needs a mature buyer to land." },
  { value: "CUSTOM_SAAS", label: "Custom SaaS build", why: "Largest contract value and the stickiest long-term relationship." },
  { value: "MOBILE_APP", label: "Mobile application", why: "Well-defined scope, straightforward to price." },
  { value: "BI_DASHBOARDS", label: "BI dashboards", why: "Low-friction entry point that surfaces the deeper automation work." },
];

/** 9. Website analysis dimensions. Each must be judged from the actual rendered
 *  site, which is what keeps the resulting claim defensible in a cold email. */
export const WEBSITE_ANALYSIS_DIMENSIONS: FilterOption[] = [
  { value: "OVERALL_QUALITY", label: "Overall quality", why: "Proxy for how much a company invests in its digital presence generally." },
  { value: "PAGE_SPEED", label: "Speed", why: "Objectively measurable, so it opens a conversation without sounding like an opinion." },
  { value: "DESIGN", label: "Design", why: "A dated design usually means the back office is dated too." },
  { value: "UX", label: "User experience", why: "Poor UX implies poor internal process design." },
  { value: "MOBILE", label: "Mobile experience", why: "Not being mobile-friendly signals years without investment." },
  { value: "SEO", label: "SEO", why: "Weak SEO alongside paid ads means money is being wasted on acquisition." },
  { value: "CONVERSION", label: "Conversion optimisation", why: "Traffic that does not convert is the most persuasive number to open with." },
  { value: "CONTENT_QUALITY", label: "Content quality", why: "Thin content indicates no marketing operations capacity." },
  { value: "TRUST_SIGNALS", label: "Trust signals", why: "Missing proof points suppress conversion regardless of traffic." },
  { value: "CTA_QUALITY", label: "Calls to action", why: "Weak CTAs mean enquiries are lost before any automation could catch them." },
];

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
  industries: INDUSTRIES,
  targetCountries: TARGET_COUNTRIES,
  employeeBands: EMPLOYEE_BANDS,
  revenueBands: REVENUE_BANDS,
  growthSignals: GROWTH_SIGNALS,
  decisionMakerTitles: DECISION_MAKER_TITLES,
  technologySignals: TECHNOLOGY_SIGNALS,
  aiOpportunityTypes: AI_OPPORTUNITY_TYPES,
  websiteAnalysisDimensions: WEBSITE_ANALYSIS_DIMENSIONS,
  companyTypes: COMPANY_TYPES,
  growthStages: GROWTH_STAGES,
  departments: DEPARTMENTS,
  seniorityLevels: SENIORITY_LEVELS,
  hiringSignals: HIRING_SIGNALS,
  websiteConditions: WEBSITE_CONDITIONS,
  aiOpportunitySignals: AI_OPPORTUNITY_SIGNALS,
  exclusionSignals: EXCLUSION_SIGNALS,
} as const;

/**
 * Daily priority mix. The spec requires 100+ leads/day split 40/40/20 so the
 * pipeline keeps a deliberate exploration budget: chasing only high-priority
 * leads narrows the funnel until the niche is exhausted and nothing new is ever
 * learned about what converts.
 */
export const PRIORITY_DISTRIBUTION = { HIGH: 0.4, MEDIUM: 0.4, EXPERIMENTAL: 0.2 } as const;

/** Target lead count per priority band for a given daily target. HIGH absorbs
 *  the rounding remainder so the parts always sum to the whole. */
export function priorityTargets(dailyTarget: number) {
  const medium = Math.round(dailyTarget * PRIORITY_DISTRIBUTION.MEDIUM);
  const experimental = Math.round(dailyTarget * PRIORITY_DISTRIBUTION.EXPERIMENTAL);
  return { high: dailyTarget - medium - experimental, medium, experimental };
}

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
