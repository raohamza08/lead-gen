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

  async search(orgId: string, searchTerm: string | null) {
    return this.connection.withFreshTokenOnAuthFailure(orgId, async ({ accessToken, organizationId }) => {
      const result = await this.graphql.searchMarketplaceJobs(accessToken, organizationId, searchTerm, 25);
      return {
        totalCount: result.totalCount,
        dataScope: "public_marketplace" as const,
        jobs: result.edges.map((e) => ({
          id: e.node.id,
          title: e.node.title,
          description: e.node.description,
          category: e.node.category,
          subcategory: e.node.subcategory,
          experienceLevel: e.node.experienceLevel,
          createdDateTime: e.node.createdDateTime,
          publishedDateTime: e.node.publishedDateTime,
          totalApplicants: e.node.totalApplicants,
          budgetDisplay: e.node.amount?.displayValue ?? (e.node.hourlyBudgetMin?.displayValue ? `${e.node.hourlyBudgetMin.displayValue}-${e.node.hourlyBudgetMax?.displayValue ?? "?"}/hr` : null),
        })),
      };
    });
  }
}
