import { Injectable } from "@nestjs/common";
import { UpworkGraphQLClient } from "../shared/upwork-graphql.client";
import { UpworkApiConnectionService } from "../connection/upwork-api-connection.service";

/**
 * Marketplace Job Postings + Job Details (spec Modules G + S combined) —
 * LIVE (Part: Upwork API integration — Marketplace Jobs domain,
 * 2026-10-23). On-demand live search only, no DB storage or sync worker
 * — confirmed live totalCount of 93,279+ open postings makes bulk sync
 * both pointless (constantly stale) and a genuine "bulk third-party
 * content" retention concern, unlike this app's own business records.
 * Each search result already carries the full rich field set (title,
 * description, budget, skills, dates) that would otherwise need a
 * separate "Job Details" query — see
 * UpworkGraphQLClient.searchMarketplaceJobs's own docblock for why a
 * true single-job detail query (`jobPosting`) is separately blocked.
 */
@Injectable()
export class UpworkMarketplaceJobsService {
  constructor(
    private readonly connection: UpworkApiConnectionService,
    private readonly graphql: UpworkGraphQLClient,
  ) {}

  async search(orgId: string, searchTerm: string | null, after: string | null = null, first = 50) {
    return this.connection.withFreshTokenOnAuthFailure(orgId, async ({ accessToken, organizationId }) => {
      const result = await this.graphql.searchMarketplaceJobs(accessToken, organizationId, searchTerm, first, after);
      return {
        totalCount: result.totalCount,
        dataScope: "public_marketplace" as const,
        pageInfo: result.pageInfo ?? { endCursor: null, hasNextPage: false },
        jobs: result.edges.map((e) => {
          // Upwork's search always returns a non-null `amount` object even
          // for HOURLY jobs — confirmed live, 2026-10-23, explicit bug
          // report that every job showed as fixed-price and the hourly
          // filter returned nothing: an hourly job's `amount.rawValue`
          // comes back as the STRING "0.0", not actually null. The old
          // `e.node.amount?.rawValue ? ... : null` was a truthy check, and
          // a non-empty string like "0.0" IS truthy, so every hourly job
          // got `fixedAmountRaw: 0` instead of `null`. `hourlyBudgetType`
          // is the one field that's reliably null for every genuine
          // fixed-price job and set (DEFAULT/MANUAL/NOT_PROVIDED) for
          // every hourly one across a live sample of 25 real jobs spanning
          // both types — use that as the actual fixed-vs-hourly
          // discriminator instead of amount's mere presence.
          const isHourly = e.node.hourlyBudgetType != null;
          const hourlyRange = e.node.hourlyBudgetMin?.displayValue
            ? `${e.node.hourlyBudgetMin.displayValue}-${e.node.hourlyBudgetMax?.displayValue ?? "?"}/hr`
            : null;
          // `weeklyBudget` has the same placeholder-string problem, but
          // worse — confirmed live across 25 real jobs spanning both fixed
          // and hourly, it comes back as "0.0" on literally every single
          // one, never a real figure. Treated as "not actually provided"
          // rather than surfaced as a fabricated-looking $0.0/week.
          const weeklyBudget =
            e.node.weeklyBudget?.rawValue != null && e.node.weeklyBudget.rawValue !== "0.0" ? e.node.weeklyBudget.displayValue : null;
          return {
            id: e.node.id,
            title: e.node.title,
            description: e.node.description,
            category: e.node.category,
            subcategory: e.node.subcategory,
            experienceLevel: e.node.experienceLevel,
            duration: e.node.duration,
            durationLabel: e.node.durationLabel,
            engagement: e.node.engagement,
            engagementWeeks: e.node.engagementDuration?.weeks ?? null,
            recordNumber: e.node.recordNumber,
            ciphertext: e.node.ciphertext,
            freelancersToHire: e.node.freelancersToHire,
            enterprise: e.node.enterprise,
            premium: e.node.premium,
            applied: e.node.applied,
            createdDateTime: e.node.createdDateTime,
            publishedDateTime: e.node.publishedDateTime,
            renewedDateTime: e.node.renewedDateTime,
            totalApplicants: e.node.totalApplicants,
            preferredFreelancerLocation: e.node.preferredFreelancerLocation ?? [],
            preferredFreelancerLocationMandatory: e.node.preferredFreelancerLocationMandatory ?? false,
            jobType: isHourly ? ("HOURLY" as const) : ("FIXED" as const),
            budgetDisplay: isHourly ? hourlyRange : (e.node.amount?.displayValue ?? null),
            fixedAmount: isHourly ? null : (e.node.amount?.displayValue ?? null),
            fixedAmountRaw: isHourly ? null : (e.node.amount?.rawValue != null ? Number(e.node.amount.rawValue) : null),
            hourlyBudgetType: e.node.hourlyBudgetType,
            hourlyBudgetMin: e.node.hourlyBudgetMin?.displayValue ?? null,
            hourlyBudgetMinRaw: e.node.hourlyBudgetMin?.rawValue != null ? Number(e.node.hourlyBudgetMin.rawValue) : null,
            hourlyBudgetMax: e.node.hourlyBudgetMax?.displayValue ?? null,
            hourlyBudgetMaxRaw: e.node.hourlyBudgetMax?.rawValue != null ? Number(e.node.hourlyBudgetMax.rawValue) : null,
            weeklyBudget,
            skills: e.node.skills.map((s) => ({ name: s.name, prettyName: s.prettyName, highlighted: s.highlighted ?? false })),
            client: {
              totalHires: e.node.client.totalHires,
              totalPostedJobs: e.node.client.totalPostedJobs,
              totalReviews: e.node.client.totalReviews,
              totalFeedback: e.node.client.totalFeedback,
              verificationStatus: e.node.client.verificationStatus,
              hasFinancialPrivacy: e.node.client.hasFinancialPrivacy,
              totalSpentDisplay: e.node.client.totalSpent?.displayValue ?? null,
              country: e.node.client.location?.country ?? null,
            },
          };
        }),
      };
    });
  }
}
