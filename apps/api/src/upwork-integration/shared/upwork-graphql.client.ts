import { Injectable, Logger } from "@nestjs/common";

const GRAPHQL_ENDPOINT = "https://api.upwork.com/graphql";

export interface CompanySelectorItem {
  title: string;
  organizationId: string;
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
