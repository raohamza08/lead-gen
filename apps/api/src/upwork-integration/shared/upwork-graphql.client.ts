import { Injectable, Logger } from "@nestjs/common";

const GRAPHQL_ENDPOINT = "https://api.upwork.com/graphql";

export interface CompanySelectorItem {
  title: string;
  organizationId: string;
}

/** `CurrentOrganization`'s identity fields — confirmed live, accessible
 *  WITHOUT the scope that blocks `.company`/`.staffs` (see
 *  getOrganizationCompanyDetails below). `flag` is the real agency/vendor/
 *  client/individual classification Upwork itself assigns — confirmed live
 *  for EurosHub: `{client:false, vendor:true, agency:true, individual:false}`,
 *  i.e. Upwork's own backend agrees this account is an agency, not a
 *  personal/individual account. */
export interface OrganizationProfile {
  id: string;
  rid: string | null;
  legacyId: string | null;
  name: string | null;
  type: "BUSINESS" | "SOLE_PROPRIETOR" | null;
  legacyType: "CLIENT" | "VENDOR" | null;
  active: boolean | null;
  hidden: boolean | null;
  photoUrl: string | null;
  creationDate: string | null;
  flag: { client: boolean; vendor: boolean; agency: boolean; individual: boolean } | null;
  parentOrganization: { id: string; name: string | null } | null;
}

/** `CurrentOrganization.company` fields — confirmed live to be BLOCKED by a
 *  missing Upwork app scope, same error class as `companySelector`
 *  (Part: Upwork API integration — Organization domain, 2026-10-23):
 *  "The client or authentication token doesn't have enough oauth2
 *  permissions/scopes to access: [CurrentOrganization.company,
 *  CurrentOrganization.staffs, ...]". Kept as a real type for when/if the
 *  scope is ever granted — getOrganizationCompanyDetails returns null on
 *  this specific failure rather than throwing, so callers can disclose
 *  "unavailable" instead of fabricating data. */
export interface OrganizationCompanyDetails {
  id: string;
  name: string | null;
  description: string | null;
  displayName: string | null;
  logoURL: string | null;
  companyName: string | null;
  country: { name: string | null } | null;
  state: string | null;
  city: string | null;
  zip: string | null;
  timezone: string | null;
  billingType: string | null;
  summary: string | null;
  staffsTotalCount: number | null;
}

export interface ConnectsSummary {
  organizationId: string;
  connectsBalance: number;
  rolloverBalance: number;
  connectsBalanceFree: number;
  connectsBalancePaid: number;
}

export interface ConnectUsageTransaction {
  amount: { rawValue: string; currency: string; displayValue: string };
  createdDateTime: string;
  transactionType: "CREDIT" | "DEBIT" | "REFUND_CREDIT";
  reason: string | null;
  jobPost: { jobId: string | null; jobTitle: string | null } | null;
}

export interface ConnectUsageHistoryPage {
  transactions: ConnectUsageTransaction[];
  endCursor: string | null;
  hasNextPage: boolean;
}

/** Confirmed live statuses on `VendorProposalFilter.status_eq` — the schema
 *  has no "all statuses" wildcard, each sync call picks one of these. */
export const VENDOR_PROPOSAL_STATUSES = [
  "Pending",
  "Offered",
  "Accepted",
  "Declined",
  "Withdrawn",
  "Activated",
  "Archived",
  "Hired",
] as const;
export type VendorProposalStatus = (typeof VENDOR_PROPOSAL_STATUSES)[number];

export interface VendorProposalNode {
  id: string;
  user: { id: string; name: string | null };
  organization: { id: string; name: string | null };
  marketplaceJobPosting: { id: string; content: { title: string } };
  terms: { chargeRate: { rawValue: string; currency: string; displayValue: string }; upfrontPaymentPercent: number | null };
  status: { status: string; reason: { reason: string } | null };
  viewedByClient: boolean | null;
  auditDetails: { createdDateTime: { displayValue: string }; modifiedDateTime: { displayValue: string } | null };
}

export interface VendorProposalsPage {
  proposals: VendorProposalNode[];
  endCursor: string | null;
  hasNextPage: boolean;
}

/** `VendorCurrentOrganizationInvitationFilter.status_eq` — confirmed live,
 *  only two values exist (NOT the 5 real lifecycle statuses on
 *  `statusDetails.status`, which this filter doesn't expose directly):
 *  "pending" = still-active/awaiting-response invitations, "terminated" =
 *  invitations whose lifecycle has ended (Accepted/Declined/Withdrawn/
 *  Archived all fall under "terminated"). A sync walks both. */
export const VENDOR_INVITATION_STATUS_FILTERS = ["pending", "terminated"] as const;
export type VendorInvitationStatusFilter = (typeof VENDOR_INVITATION_STATUS_FILTERS)[number];

export interface VendorInvitationNode {
  id: string;
  context: "Freelancer" | "Agency" | null;
  client: { user: { id: string; name: string | null } } | null;
  freelancer: { user: { id: string; name: string | null } } | null;
  jobPosting: { id: string; content: { title: string } } | null;
  invitationLetter: string | null;
  inviteAttempt: number | null;
  statusDetails: { status: string } | null;
  acceptanceDetails: { duration: string | null; upfrontPaymentPercent: number | null; coverLetter: string | null } | null;
  auditDetails: { createdBy: string | null; createdDateTime: string | null; modifiedBy: string | null; modifiedDateTime: string | null } | null;
}

export interface VendorInvitationsPage {
  invitations: VendorInvitationNode[];
  endCursor: string | null;
  hasNextPage: boolean;
}

export interface TransactionHistoryRow {
  recordId: string | null;
  transactionCreationDate: string | null;
  type: string | null;
  description: string | null;
  accountingSubtype: string | null;
  transactionAmount: { rawValue: string; currency: string; displayValue: string } | null;
  paymentStatus: string | null;
}

/** Exported (Part: real bug fix, 2026-10-22 — reactive token refresh) so
 *  UpworkApiConnectionService.withFreshTokenOnAuthFailure can detect a real
 *  401 from Upwork and force-refresh, instead of trusting our own
 *  `tokenExpiresAt` estimate (confirmed unreliable live — see that method's
 *  own docblock). `status` carries the HTTP status so callers don't have to
 *  pattern-match on the message string, which varies ("Authentication
 *  failed" vs GraphQL-layer error text). */
export class UpworkGraphQLError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
  ) {
    super(message);
  }
}

/**
 * Thin client for Upwork's actual GraphQL API — confirmed endpoint and
 * query shapes from Upwork's own docs (developer/documentation/graphql/api/
 * docs, checked 2026-10-12), not guessed. `companySelector` is
 * connection-setup plumbing (getting the org/tenant ID to send as
 * X-Upwork-API-TenantId on every later call). `connectsSummary` and
 * `connectUsageHistory` (Part: Upwork API integration — Connects usage
 * domain, 2026-10-22) are the first of the 7 data-domain capabilities to go
 * live — confirmed by LIVE introspection + a real successful call against a
 * real connected account on 2026-10-22, not guessed from docs like the
 * other 6 domains still stubbed in ./services/. `connectUsageHistory` is
 * cursor-paginated (Pagination{after,first} in, PageInfo{endCursor,
 * hasNextPage} out) — confirmed live, NOT the offset/limit shape some other
 * Upwork endpoints reportedly use, so don't copy this pagination pattern to
 * another domain without re-confirming it there too.
 */
@Injectable()
export class UpworkGraphQLClient {
  private readonly logger = new Logger(UpworkGraphQLClient.name);

  /** Shared POST + error handling every query below uses — Upwork returns
   *  GraphQL-layer errors as HTTP 200 with an `errors` array, so `res.ok`
   *  alone is never enough (see upwork-integration.module.ts's own docblock
   *  on this). Throws UpworkGraphQLError with Upwork's own message on any
   *  failure rather than returning null, unlike getDefaultOrganization below
   *  — callers here (the sync worker) need to know a fetch failed so they
   *  can record it as a sync error, not silently treat it as "no data". */
  private async request<T>(
    accessToken: string,
    organizationId: string | null,
    query: string,
    variables?: Record<string, unknown>,
  ): Promise<T> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    };
    if (organizationId) headers["X-Upwork-API-TenantId"] = organizationId;

    const res = await fetch(GRAPHQL_ENDPOINT, {
      method: "POST",
      headers,
      body: JSON.stringify({ query, variables }),
    });
    const payload = await res.json().catch(() => null);
    if (!res.ok || payload?.errors?.length) {
      const message = payload?.errors?.[0]?.message ?? `Upwork GraphQL request failed (${res.status})`;
      throw new UpworkGraphQLError(message, res.status);
    }
    return payload?.data as T;
  }

  /** Confirms a given tenant ID is real and returns its display name, by
   *  sending it as X-Upwork-API-TenantId and reading back `organization.
   *  name` (Part: Upwork API integration — manual org override, 2026-10-22,
   *  real bug found: the `companySelector` query this app would otherwise
   *  use to auto-discover an agency's organization ID is blocked by a scope
   *  this app's Upwork permissions don't include, confirmed live — "The
   *  client or authentication token doesn't have enough oauth2 permissions/
   *  scopes to access: [CompanySelector.items, ...]". Every GraphQL call
   *  made without an explicit tenant header silently defaults to the
   *  authenticating USER's own personal account context, not any agency
   *  they belong to — confirmed live against this org's real connection,
   *  which was returning "Sheikh Nabeel Ali" (the personal account) instead
   *  of "EurosHub" until this was diagnosed. `organization`/`company`
   *  (singular, "current organization") queries work fine under the
   *  granted scopes and respect whatever tenant header is sent, which is
   *  what this method (and the manual override it backs) relies on. */
  async getOrganizationName(accessToken: string, organizationId: string): Promise<string> {
    const data = await this.request<{ organization: { id: string; name: string } }>(
      accessToken,
      organizationId,
      `query { organization { id name } }`,
    );
    return data.organization.name;
  }

  /** Real organization identity fields (Part: Upwork API integration —
   *  Organization domain, 2026-10-23) — confirmed live, accessible without
   *  the scope `.company`/`.staffs` require (see
   *  getOrganizationCompanyDetails). This is the backbone of the
   *  Organization & Agency module and of Agency Overview's identity card. */
  async getOrganizationProfile(accessToken: string, organizationId: string | null): Promise<OrganizationProfile> {
    const data = await this.request<{ organization: OrganizationProfile }>(
      accessToken,
      organizationId,
      `query {
        organization {
          id rid legacyId name type legacyType active hidden photoUrl creationDate
          flag { client vendor agency individual }
          parentOrganization { id name }
        }
      }`,
    );
    return data.organization;
  }

  /** Best-effort fetch of `.company`/`.staffs` — confirmed live to be
   *  blocked by a missing scope for this app's current Upwork credentials
   *  (Part: Upwork API integration — Organization domain, 2026-10-23).
   *  Returns null on that specific failure instead of throwing, so the
   *  Organization module can disclose "unavailable" rather than fabricate
   *  company/staff data. If Upwork ever grants the missing scope, this
   *  starts returning real data with no caller-side change needed. */
  async getOrganizationCompanyDetails(accessToken: string, organizationId: string | null): Promise<OrganizationCompanyDetails | null> {
    try {
      const data = await this.request<{
        organization: {
          company: Omit<OrganizationCompanyDetails, "staffsTotalCount"> | null;
          staffs: { totalCount: number | null } | null;
        };
      }>(
        accessToken,
        organizationId,
        `query {
          organization {
            company {
              id name description displayName logoURL companyName
              country { name } state city zip timezone billingType summary
            }
            staffs(pagination: { first: 1 }) { totalCount }
          }
        }`,
      );
      if (!data.organization.company) return null;
      return { ...data.organization.company, staffsTotalCount: data.organization.staffs?.totalCount ?? null };
    } catch (err) {
      this.logger.warn(`Organization company/staffs details unavailable (expected if scope not granted): ${(err as Error).message}`);
      return null;
    }
  }

  /** Real, consequential write against the agency's live Upwork
   *  organization record (Part: Upwork API integration — Organization
   *  domain, 2026-10-23). `organizationName` is the only required field;
   *  every other field is optional and left unset when not provided so a
   *  partial update doesn't clobber fields the caller didn't intend to
   *  touch. Confirmed via introspection, NOT yet exercised against the
   *  real live API — this mutation changes real agency data on Upwork's
   *  side, so it must go through an explicit user-confirmed save flow, not
   *  be called speculatively. */
  async updateOrganization(
    accessToken: string,
    organizationId: string | null,
    input: { id: string; organizationName: string; hidden?: boolean; vatId?: string; phoneNumber?: string; timezone?: string },
  ): Promise<{ id: string | null; success: boolean }> {
    const data = await this.request<{ updateOrganization: { id: string | null; success: boolean } }>(
      accessToken,
      organizationId,
      `mutation($input: UpdateOrganizationInput!) {
        updateOrganization(input: $input) { id success }
      }`,
      { input },
    );
    return data.updateOrganization;
  }

  /** One page of this org's own submitted proposals/bids, for a single
   *  status (Part: Upwork API integration — Bidding/proposals domain,
   *  2026-10-22, confirmed live against real data: EurosHub has 14,000+
   *  real proposals across statuses). `vendorProposals` requires a single
   *  `status_eq` per call — Upwork's schema has no "all statuses" or
   *  date-range filter, so the sync service calls this once per status,
   *  always walking the full bounded page range every tick (see
   *  UpworkProposalsSyncService's own docblock for why an early-stop
   *  optimization here caused a real data-loss bug). `connectsBid` is
   *  deliberately NOT requested — confirmed live to be blocked by a scope this app doesn't
   *  have (same class of gap as `companySelector`/`company`). */
  async getVendorProposalsPage(
    accessToken: string,
    organizationId: string | null,
    status: VendorProposalStatus,
    after: string | null,
    // Confirmed live: 50/100 both rejected with "Input parameter provided
    // has incorrect value" (code VJCA-6), 25 works — a stricter, specific
    // cap for this query, different from connectUsageHistory's.
    first = 25,
  ): Promise<VendorProposalsPage> {
    const data = await this.request<{
      vendorProposals: { edges: { node: VendorProposalNode }[]; pageInfo: { endCursor: string | null; hasNextPage: boolean } };
    }>(
      accessToken,
      organizationId,
      `query($filter: VendorProposalFilter!, $sort: VendorProposalSortAttribute!, $pagination: Pagination!) {
        vendorProposals(filter: $filter, sortAttribute: $sort, pagination: $pagination) {
          edges {
            node {
              id
              user { id name }
              organization { id name }
              marketplaceJobPosting { id content { title } }
              terms { chargeRate { rawValue currency displayValue } upfrontPaymentPercent }
              status { status reason { reason } }
              viewedByClient
              auditDetails { createdDateTime { displayValue } modifiedDateTime { displayValue } }
            }
          }
          pageInfo { endCursor hasNextPage }
        }
      }`,
      {
        filter: { status_eq: status },
        sort: { field: "MODIFIEDDATETIME", sortOrder: "DESC" },
        pagination: { first, ...(after ? { after } : {}) },
      },
    );
    return {
      proposals: data.vendorProposals.edges.map((e) => e.node),
      endCursor: data.vendorProposals.pageInfo.endCursor,
      hasNextPage: data.vendorProposals.pageInfo.hasNextPage,
    };
  }

  /** One page of invitations this org has sent to freelancers/agencies —
   *  real, separate query from `vendorProposals` (Part: Upwork API
   *  integration — Invites domain, 2026-10-22, built specifically because
   *  the user explicitly asked for "bids and invites separately"). Lives on
   *  `organization { vendorInvitations }`, NOT a standalone top-level
   *  query — confirmed live via introspection. `status_eq` only accepts
   *  "pending"/"terminated" (see VENDOR_INVITATION_STATUS_FILTERS), a
   *  coarser split than the 5 real statuses on `statusDetails.status`.
   *  Deliberately omits `annotations` — confirmed live to be broken on
   *  Upwork's own end (`"Can't serialize value ... Invalid input for enum
   *  'VendorInvitationAnnotations'. Unknown value '3'"` — Upwork returning
   *  a raw internal code that doesn't map to any of its own enum's declared
   *  values, not something fixable client-side). `first` caps at 40,
   *  confirmed live ("query param limit can not be greater than 40") — a
   *  different, higher cap than vendorProposals' 25.
   *
   *  `pageInfo.hasNextPage` on THIS query is unreliable — confirmed live to
   *  always come back `null` even when further pages genuinely exist (the
   *  `endCursor` itself is real and correctly advances though — confirmed
   *  walking 10 pages by cursor alone reached exactly totalCount unique
   *  IDs with zero duplicates). Callers must not treat a falsy
   *  `hasNextPage` as "no more pages" for this specific query — see
   *  UpworkInvitesSyncService.syncStatus, which stops on an empty page
   *  instead. */
  async getVendorInvitationsPage(
    accessToken: string,
    organizationId: string | null,
    status: VendorInvitationStatusFilter,
    after: string | null,
    first = 40,
  ): Promise<VendorInvitationsPage> {
    const data = await this.request<{
      organization: {
        vendorInvitations: { edges: { node: VendorInvitationNode }[]; pageInfo: { endCursor: string | null; hasNextPage: boolean } };
      };
    }>(
      accessToken,
      organizationId,
      `query($filter: VendorCurrentOrganizationInvitationFilter!, $pagination: Pagination!) {
        organization {
          vendorInvitations(filter: $filter, pagination: $pagination) {
            edges {
              node {
                id
                context
                client { user { id name } }
                freelancer { user { id name } }
                jobPosting { id content { title } }
                invitationLetter
                inviteAttempt
                statusDetails { status }
                acceptanceDetails { duration upfrontPaymentPercent coverLetter }
                auditDetails { createdBy createdDateTime modifiedBy modifiedDateTime }
              }
            }
            pageInfo { endCursor hasNextPage }
          }
        }
      }`,
      {
        filter: { status_eq: status },
        pagination: { first, ...(after ? { after } : {}) },
      },
    );
    return {
      invitations: data.organization.vendorInvitations.edges.map((e) => e.node),
      endCursor: data.organization.vendorInvitations.pageInfo.endCursor,
      hasNextPage: data.organization.vendorInvitations.pageInfo.hasNextPage,
    };
  }

  /** Static Upwork reference data (spec Module M: Common Entities) —
   *  confirmed live (Part: Upwork API integration — Common Entities
   *  domain, 2026-10-23): 254 countries, 150 languages, 28 regions, all
   *  real. No filter/pagination args exist on any of these three queries
   *  (confirmed via introspection) — each always returns its full list. */
  async getCountries(accessToken: string, organizationId: string | null) {
    const data = await this.request<{
      countries: { id: string; name: string; twoLetterAbbreviation: string | null; threeLetterAbbreviation: string | null; region: string; phoneCode: string | null; active: boolean | null }[];
    }>(accessToken, organizationId, `query { countries { id name twoLetterAbbreviation threeLetterAbbreviation region phoneCode active } }`);
    return data.countries;
  }

  async getLanguages(accessToken: string, organizationId: string | null) {
    const data = await this.request<{ languages: { iso639Code: string; englishName: string; active: boolean }[] }>(
      accessToken,
      organizationId,
      `query { languages { iso639Code englishName active } }`,
    );
    return data.languages;
  }

  async getRegions(accessToken: string, organizationId: string | null) {
    const data = await this.request<{ regions: { id: string; name: string; parentRegion: { id: string; name: string } | null }[] }>(
      accessToken,
      organizationId,
      `query { regions { id name parentRegion { id name } } }`,
    );
    return data.regions;
  }

  /** The org's own accounting-entity ID — real top-level query, no args,
   *  confirmed live (Part: Upwork API integration — Transactions domain,
   *  2026-10-23). Required as `aceIds_any` on `transactionHistory` below —
   *  there's no way to query transaction history without it first. */
  async getAccountingEntityId(accessToken: string, organizationId: string | null): Promise<string> {
    const data = await this.request<{ accountingEntity: { id: string } }>(accessToken, organizationId, `query { accountingEntity { id } }`);
    return data.accountingEntity.id;
  }

  /** Real financial ledger (spec Module B) — confirmed live against real
   *  data: service fees, fixed-price invoices, Connects purchase fees,
   *  freelancer refunds, all with real contract/client references embedded
   *  in `description` (Upwork does not expose these as separate structured
   *  fields on this row type, confirmed via introspection —
   *  TransactionHistoryRow has no contractId/clientId field, only free-text
   *  description). Date range is required (`transactionDateTime_bt`), no
   *  "all time" option. */
  async getTransactionHistory(
    accessToken: string,
    organizationId: string | null,
    accountingEntityId: string,
    rangeStart: string,
    rangeEnd: string,
  ): Promise<TransactionHistoryRow[]> {
    const data = await this.request<{ transactionHistory: { transactionDetail: { transactionHistoryRow: TransactionHistoryRow[] | null } } }>(
      accessToken,
      organizationId,
      `query($filter: TransactionHistoryFilter!) {
        transactionHistory(transactionHistoryFilter: $filter) {
          transactionDetail {
            transactionHistoryRow {
              recordId transactionCreationDate type description accountingSubtype
              transactionAmount { rawValue currency displayValue }
              paymentStatus
            }
          }
        }
      }`,
      { filter: { aceIds_any: [accountingEntityId], transactionDateTime_bt: { rangeStart, rangeEnd } } },
    );
    return data.transactionHistory.transactionDetail.transactionHistoryRow ?? [];
  }

  /** Real offer listing (spec Module J) — schema confirmed via
   *  introspection, but confirmed to fail live with a reproducible
   *  Upwork-side `TRANSFORM_TIMEOUT` (Part: Upwork API integration —
   *  Offers domain, 2026-10-23). Kept as a real method (not removed) so
   *  UpworkOffersService can keep retrying live without a code change if
   *  Upwork's backend issue ever clears — see that service's own
   *  docblock. */
  async getOffers(accessToken: string, organizationId: string | null, vendorOrgId: string) {
    const data = await this.request<{ offersByAttributes: { offers: { id: string; title: string; state: string; createdDateTime: string | null; contractId: string | null }[] | null } }>(
      accessToken,
      organizationId,
      `query($filter: SearchOffersByAttributesInput!) {
        offersByAttributes(filter: $filter) {
          offers { id title state createdDateTime contractId }
        }
      }`,
      { filter: { ids: [vendorOrgId], searchAttribute: "VendorOrg" } },
    );
    return data.offersByAttributes.offers ?? [];
  }

  /** Real timesheet listing (spec Module E) — schema confirmed, see
   *  UpworkTimesheetsService's own docblock for a confirmed live 403:
   *  this is blocked by a team-level Upwork permission on the connected
   *  user, not an OAuth scope. Date args must be "YYYY-MM-DD" (confirmed
   *  live — full ISO-8601 timestamps fail with a parse error). */
  async getContractTimeReport(accessToken: string, organizationId: string | null, orgIdFilter: string, rangeStart: string, rangeEnd: string) {
    const data = await this.request<{
      contractTimeReport: {
        totalCount: number | null;
        edges: { node: { dateWorkedOn: string; freelancer: { id: string; name: string | null } | null; task: string | null; totalHoursWorked: number | null; totalCharges: number | null } }[];
      };
    }>(
      accessToken,
      organizationId,
      `query($filter: TimeReportFilter!, $pagination: Pagination) {
        contractTimeReport(filter: $filter, pagination: $pagination) {
          totalCount
          edges { node { dateWorkedOn freelancer { id name } task totalHoursWorked totalCharges } }
        }
      }`,
      { filter: { organizationId_eq: orgIdFilter, timeReportDate_bt: { rangeStart, rangeEnd } }, pagination: { first: 100 } },
    );
    return data.contractTimeReport;
  }

  /** Real per-contract work history for ONE freelancer (spec Module T) —
   *  confirmed live, real data (32 real contracts for a test freelancer:
   *  titles, dates, status, totalCharge, hours, feedback scores).
   *  `talentWorkHistory` requires a specific `personId` — there is no
   *  bulk/org-wide listing, confirmed via introspection (no filter-less
   *  "all freelancers" mode exists). Field is `workHistoryList`, not
   *  `edges` (confirmed live — this type is NOT a standard Relay
   *  connection despite having `totalCount`). */
  async getTalentWorkHistory(accessToken: string, organizationId: string | null, personId: string) {
    const data = await this.request<{
      talentWorkHistory: {
        totalCount: number | null;
        workHistoryList: {
          contract: { id: string; startDate: string | null; endDate: string | null; status: string | null; title: string | null } | null;
          contractAggregate: { totalCharge: string | null; hours: string | null } | null;
          feedback: { feedbackToFreelancer: { score: number | null } | null; feedbackToClient: { score: number | null } | null } | null;
        }[] | null;
      };
    }>(
      accessToken,
      organizationId,
      `query($filter: TalentWorkHistoryFilterInput) {
        talentWorkHistory(filter: $filter) {
          totalCount
          workHistoryList {
            contract { id startDate endDate status title }
            contractAggregate { totalCharge hours }
            feedback { feedbackToFreelancer { score } feedbackToClient { score } }
          }
        }
      }`,
      { filter: { personId } },
    );
    return data.talentWorkHistory.workHistoryList ?? [];
  }

  /** Real conversation room listing (spec Module K) — confirmed live, NO
   *  required filter (returns every room org-wide). Read-only use only —
   *  Upwork has a real send-message mutation surface
   *  (createRoomStoryV2/etc.) but this method and this app never call
   *  it, per the spec's explicit read-only requirement for this module. */
  async getRoomListPage(accessToken: string, organizationId: string | null, after: string | null, first = 50) {
    const data = await this.request<{
      roomList: {
        totalCount: number | null;
        edges: {
          node: {
            id: string;
            roomName: string | null;
            roomType: string | null;
            numUsers: number | null;
            numUnread: number | null;
            createdAtDateTime: string | null;
            latestStory: { message: string | null; createdDateTime: string | null; user: { id: string; name: string | null } | null } | null;
          };
        }[];
        pageInfo: { endCursor: string | null; hasNextPage: boolean | null } | null;
      };
    }>(
      accessToken,
      organizationId,
      `query($pagination: Pagination) {
        roomList(pagination: $pagination) {
          totalCount
          edges {
            node {
              id roomName roomType numUsers numUnread createdAtDateTime
              latestStory { message createdDateTime user { id name } }
            }
          }
          pageInfo { endCursor hasNextPage }
        }
      }`,
      { pagination: { first, ...(after ? { after } : {}) } },
    );
    return data.roomList;
  }

  /** Real skill ontology (spec Module F: Ontology & Reference Data) —
   *  confirmed live. `limit` is required (confirmed via introspection —
   *  unlike countries/languages/regions, this one does NOT return
   *  everything unconditionally). Field is `preferredLabel`, not
   *  `prefLabel` (confirmed live — an earlier guess using `prefLabel`
   *  failed validation). */
  async getOntologySkills(accessToken: string, organizationId: string | null, limit: number, offset = 0) {
    const data = await this.request<{ ontologySkills: { id: string; ontologyId: string; preferredLabel: string; definition: string | null }[] }>(
      accessToken,
      organizationId,
      `query($limit: Int!, $offset: Int) { ontologySkills(limit: $limit, offset: $offset) { id ontologyId preferredLabel definition } }`,
      { limit, offset },
    );
    return data.ontologySkills;
  }

  /** Real occupation-category reference list (spec Module F) — confirmed
   *  via introspection to take no args (same "always returns everything"
   *  shape as countries/languages/regions). */
  async getOntologyCategories(accessToken: string, organizationId: string | null) {
    const data = await this.request<{ ontologyCategories: { id: string; preferredLabel: string }[] }>(
      accessToken,
      organizationId,
      `query { ontologyCategories { id preferredLabel } }`,
    );
    return data.ontologyCategories;
  }

  /** Real public user lookup (spec Module O) — confirmed live schema:
   *  `userDetails(id!)` returns `PiiUser` (id, nid, rid, name, firstName,
   *  lastName, photoUrl, publicUrl, email, location). Despite the "Pii"
   *  type name, this is reached via the publicly-scoped userDetails
   *  query per the granted scope, not a private-data bypass — still,
   *  `email` is deliberately NOT requested here to stay conservative on
   *  what this app stores about people who aren't the connected account
   *  itself. Requires a specific known ID — no bulk/directory listing
   *  exists in the schema. */
  async getUserDetails(accessToken: string, organizationId: string | null, id: string) {
    const data = await this.request<{ userDetails: { id: string; name: string | null; firstName: string | null; lastName: string | null; photoUrl: string | null; publicUrl: string | null } }>(
      accessToken,
      organizationId,
      `query($id: ID!) { userDetails(id: $id) { id name firstName lastName photoUrl publicUrl } }`,
      { id },
    );
    return data.userDetails;
  }

  /** Real public marketplace job search (spec Modules G + S) — confirmed
   *  live against real data: 93,279 real open job postings at the time
   *  of testing, each with rich fields (title, description, budget,
   *  skills, client info, dates). Deliberately NOT synced/stored —
   *  unlike every other UpworkApi* table, this is genuinely bulk public
   *  third-party marketplace content (not the org's own business
   *  record), and at this volume a live search is the only sane
   *  approach. Each search result already carries every field this app
   *  would otherwise need a separate "detail" query for — confirmed
   *  live that the separate `jobPosting(jobPostingId!)` detail query is
   *  blocked with a real 403 ("Authorization failed") for jobs this
   *  agency hasn't itself interacted with, so Module S (Job Details)
   *  is served from this same search result, not a second query.
   *
   *  Full field set below (Part: Marketplace Jobs detail view + niche
   *  categorization, 2026-10-23, explicit user request — "I need all the
   *  details not just basic") confirmed live via GraphQL introspection
   *  of the real `MarketplaceJobPostingSearchResult` type before adding
   *  any field here — not guessed. `occupations.category`/`subCategories`
   *  deliberately omitted: introspection showed `MarketplaceJobPostingSearchOccupation`
   *  has no `name`/label field of its own (confirmed live — a query
   *  requesting one is rejected as FieldUndefined), so it would add a
   *  request without adding any real displayable data; `category`/
   *  `subcategory` (flat strings) already cover that need. */
  async searchMarketplaceJobs(accessToken: string, organizationId: string | null, searchTerm: string | null, first = 25) {
    const data = await this.request<{
      marketplaceJobPostingsSearch: {
        totalCount: number | null;
        edges: {
          node: {
            id: string;
            title: string;
            description: string;
            category: string | null;
            subcategory: string | null;
            experienceLevel: string | null;
            duration: string | null;
            durationLabel: string | null;
            engagement: string | null;
            engagementDuration: { label: string; weeks: number } | null;
            recordNumber: string;
            freelancersToHire: number;
            totalFreelancersToHire: number | null;
            enterprise: boolean;
            premium: boolean;
            applied: boolean;
            createdDateTime: string;
            publishedDateTime: string;
            renewedDateTime: string | null;
            totalApplicants: number;
            preferredFreelancerLocation: string[] | null;
            preferredFreelancerLocationMandatory: boolean | null;
            amount: { rawValue: string; currency: string; displayValue: string } | null;
            hourlyBudgetType: string | null;
            hourlyBudgetMin: { rawValue: string; currency: string; displayValue: string } | null;
            hourlyBudgetMax: { rawValue: string; currency: string; displayValue: string } | null;
            weeklyBudget: { rawValue: string; currency: string; displayValue: string } | null;
            skills: { name: string; prettyName: string; highlighted: boolean | null }[];
            client: {
              totalHires: number;
              totalPostedJobs: number;
              totalReviews: number;
              totalFeedback: number;
              verificationStatus: string | null;
              hasFinancialPrivacy: boolean;
              totalSpent: { displayValue: string } | null;
              location: { country: string | null } | null;
            };
          };
        }[];
      };
    }>(
      accessToken,
      organizationId,
      `query($filter: MarketplaceJobPostingsSearchFilter) {
        marketplaceJobPostingsSearch(marketPlaceJobFilter: $filter) {
          totalCount
          edges {
            node {
              id title description category subcategory experienceLevel
              duration durationLabel engagement engagementDuration { label weeks }
              recordNumber freelancersToHire totalFreelancersToHire
              enterprise premium applied
              createdDateTime publishedDateTime renewedDateTime totalApplicants
              preferredFreelancerLocation preferredFreelancerLocationMandatory
              amount { rawValue currency displayValue }
              hourlyBudgetType
              hourlyBudgetMin { rawValue currency displayValue }
              hourlyBudgetMax { rawValue currency displayValue }
              weeklyBudget { rawValue currency displayValue }
              skills { name prettyName highlighted }
              client {
                totalHires totalPostedJobs totalReviews totalFeedback
                verificationStatus hasFinancialPrivacy
                totalSpent { displayValue }
                location { country }
              }
            }
          }
        }
      }`,
      { filter: { pagination_eq: { first }, ...(searchTerm ? { searchExpression_eq: searchTerm } : {}) } },
    );
    return data.marketplaceJobPostingsSearch;
  }

  /** Real freelancer profile aggregates for ONE freelancer (spec Module
   *  H) — confirmed live, real data (real earnings, job counts,
   *  top-rated status, skills). `talentProfile` requires a specific
   *  `personId` — no bulk directory listing exists in the schema.
   *  `TalentProfileIdentity` only exposes `id`/`ciphertext` (confirmed
   *  live — no name field there), so this intentionally does NOT fetch
   *  identity; callers already have the freelancer's name from their own
   *  proposal/invite records. */
  async getTalentProfile(accessToken: string, organizationId: string | null, personId: string) {
    const data = await this.request<{
      talentProfile: {
        profiles: {
          personId: string;
          profileAggregates: {
            lastWorkedOn: string | null;
            totalHourlyJobs: number | null;
            totalFixedJobs: number | null;
            topRatedStatus: string | null;
            totalFeedback: number | null;
            totalEarnings: number | null;
            totalJobs: number | null;
          } | null;
          skills: { skill: string | null; prettyName: string | null }[] | null;
        }[] | null;
      };
    }>(
      accessToken,
      organizationId,
      `query($id: ID!) {
        talentProfile(personId: $id) {
          profiles {
            personId
            profileAggregates { lastWorkedOn totalHourlyJobs totalFixedJobs topRatedStatus totalFeedback totalEarnings totalJobs }
            skills { skill prettyName }
          }
        }
      }`,
      { id: personId },
    );
    return data.talentProfile.profiles?.[0] ?? null;
  }

  /** Real contract proposals listing (spec Module L) — confirmed live
   *  (EurosHub's own org ID works directly as `agencyTeamId`, confirmed
   *  live — no separate "team ID" lookup needed). Deliberately read-only
   *  per the spec's explicit requirement for this module. Live/on-demand
   *  only, no DB sync — confirmed live at zero current results for this
   *  org, and the schema has no date-range filter to make an
   *  incremental sync meaningful yet. */
  async getContractProposalsByAgency(accessToken: string, organizationId: string | null, agencyTeamId: string, page = 1) {
    const data = await this.request<{
      contractProposalsByAgency: {
        paging: { total: number | null; page: number | null; itemsPerPage: number | null } | null;
        contracts: {
          id: string;
          referenceContractRid: string | null;
          createdDate: string | null;
          offerDetails: { title: string | null } | null;
          client: { personName: { firstName: string | null; lastName: string | null } | null } | null;
        }[] | null;
      };
    }>(
      accessToken,
      organizationId,
      `query($id: ID!, $page: Int) {
        contractProposalsByAgency(agencyTeamId: $id, page: $page) {
          paging { total page itemsPerPage }
          contracts { id referenceContractRid createdDate offerDetails { title } client { personName { firstName lastName } } }
        }
      }`,
      { id: agencyTeamId, page },
    );
    return data.contractProposalsByAgency;
  }

  /** Real, consequential write: submits an actual proposal/bid to a real
   *  Upwork job posting, spending real Connects (spec Module Q). Schema
   *  confirmed via introspection: `selectedContractor` needs BOTH `id`
   *  (the contractor-selection record ID from the job posting, not a
   *  freelancer ID by itself) and `oDeskUserID` (the freelancer's
   *  legacy-format user ID) — neither is guessable, both must come from
   *  the job posting's own contractor-selection data, which this app
   *  does not currently surface from marketplaceJobPostingsSearch (that
   *  query was built read-only for listing, not proposal submission).
   *  Confirmed via introspection only — NOT exercised against the real
   *  live API, since this spends real Connects and represents the
   *  agency externally; must only run after explicit user-reviewed
   *  confirmation in the UI. */
  async createJobProposal(
    accessToken: string,
    organizationId: string | null,
    input: {
      selectedContractor: { id: string; oDeskUserID: string };
      jobReference: string;
      chargedAmount: number;
      coverLetter: string;
      teamOrgId: string;
      agencyOrgId?: string;
      occupationId?: string;
      estimatedDuration?: number;
      questions?: { question: string; answer: string }[];
      attachments?: string[];
    },
  ): Promise<{ newProposalId: string | null; status: string | null; error: string | null }> {
    const data = await this.request<{ createJobProposal: { newProposalId: string | null; status: string | null; error: string | null } }>(
      accessToken,
      organizationId,
      `mutation($input: CreateJobProposalInput!) {
        createJobProposal(input: $input) { newProposalId status error }
      }`,
      { input },
    );
    return data.createJobProposal;
  }

  /** Point-in-time Connects balance — confirmed live, real fields. */
  async getConnectsSummary(accessToken: string, organizationId: string | null): Promise<ConnectsSummary> {
    const data = await this.request<{ connectsSummary: ConnectsSummary }>(
      accessToken,
      organizationId,
      `query { connectsSummary { organizationId connectsBalance rolloverBalance connectsBalanceFree connectsBalancePaid } }`,
    );
    return data.connectsSummary;
  }

  /** One page of Connects transaction history within [rangeStart, rangeEnd]
   *  (both ISO-8601 strings — confirmed live field names `rangeStart`/
   *  `rangeEnd`, not `startDate`/`endDate`). Pass `after` (the previous
   *  page's `endCursor`) to page forward; omit for the first page. */
  async getConnectUsageHistoryPage(
    accessToken: string,
    organizationId: string | null,
    rangeStart: string,
    rangeEnd: string,
    after: string | null,
    first = 100,
  ): Promise<ConnectUsageHistoryPage> {
    const data = await this.request<{
      connectUsageHistory: { transactions: ConnectUsageTransaction[]; pageInfo: { endCursor: string | null; hasNextPage: boolean } };
    }>(
      accessToken,
      organizationId,
      `query History($filter: ConnectUsageFilter!, $pagination: Pagination!) {
        connectUsageHistory(filter: $filter, pagination: $pagination) {
          transactions {
            amount { rawValue currency displayValue }
            createdDateTime
            transactionType
            reason
            jobPost { jobId jobTitle }
          }
          pageInfo { endCursor hasNextPage }
        }
      }`,
      {
        filter: { searchDateRange: { rangeStart, rangeEnd } },
        pagination: { first, ...(after ? { after } : {}) },
      },
    );
    return {
      transactions: data.connectUsageHistory.transactions,
      endCursor: data.connectUsageHistory.pageInfo.endCursor,
      hasNextPage: data.connectUsageHistory.pageInfo.hasNextPage,
    };
  }

  /** Returns null on any failure rather than throwing — the connection
   *  itself is already established by the time this runs (see
   *  UpworkApiConnectionService.handleOAuthCallback), and per Upwork's own
   *  docs, omitting X-Upwork-API-TenantId later just falls back to the
   *  user's default organization, so a failed lookup here degrades
   *  gracefully instead of failing the whole connect. */
  async getDefaultOrganization(accessToken: string): Promise<CompanySelectorItem | null> {
    try {
      const res = await fetch(GRAPHQL_ENDPOINT, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          query: "query { companySelector { items { title organizationId } } }",
        }),
      });
      const payload = await res.json().catch(() => null);
      const items: CompanySelectorItem[] | undefined = payload?.data?.companySelector?.items;
      // Per Upwork's docs, a GraphQL-layer failure still comes back as
      // HTTP 200 with an `errors` array — only a transport-layer failure
      // (auth rejected, 5xx) shows up in res.ok, so check both.
      if (!res.ok || payload?.errors?.length || !items?.length) {
        this.logger.warn(
          `companySelector returned no organization (status ${res.status}): ${JSON.stringify(payload?.errors ?? payload).slice(0, 300)}`,
        );
        return null;
      }
      return items[0];
    } catch (err) {
      this.logger.warn(`companySelector request failed: ${(err as Error).message}`);
      return null;
    }
  }
}
