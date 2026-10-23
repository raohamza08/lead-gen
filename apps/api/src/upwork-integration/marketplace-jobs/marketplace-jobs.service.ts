import { Injectable } from "@nestjs/common";
import { UpworkGraphQLClient, UpworkGraphQLError } from "../shared/upwork-graphql.client";
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
            // "Activity on this job" (Part: complete-details fix,
            // 2026-10-24, explicit user request — pasted a real Upwork job
            // page's Proposals/Interviewing/Invites sent/Unanswered
            // invites block). `totalApplicants` above already covers
            // Proposals; the rest comes from here. Genuinely absent for
            // some jobs (confirmed live — not every job has an
            // activityStat), surfaced as null rather than zeros so the
            // frontend can show "not available" instead of a fabricated 0.
            activity: e.node.job?.activityStat?.jobActivity
              ? {
                  invitesSent: e.node.job.activityStat.jobActivity.invitesSent,
                  totalInvitedToInterview: e.node.job.activityStat.jobActivity.totalInvitedToInterview,
                  totalHired: e.node.job.activityStat.jobActivity.totalHired,
                  totalUnansweredInvites: e.node.job.activityStat.jobActivity.totalUnansweredInvites,
                  totalOffered: e.node.job.activityStat.jobActivity.totalOffered,
                  lastClientActivity: e.node.job.activityStat.jobActivity.lastClientActivity,
                  avgBidRate: e.node.job.activityStat.applicationsBidStats?.avgRateBid?.displayValue ?? null,
                  minBidRate: e.node.job.activityStat.applicationsBidStats?.minRateBid?.displayValue ?? null,
                  maxBidRate: e.node.job.activityStat.applicationsBidStats?.maxRateBid?.displayValue ?? null,
                }
              : null,
          };
        }),
      };
    });
  }

  /** Client work-history insights for ONE job, fetched lazily when its
   *  detail panel opens — not part of the bulk search above (Part:
   *  complete-details fix, 2026-10-24, explicit user request — ongoing/
   *  completed hourly vs fixed job counts and the client's average hourly
   *  rate). See UpworkGraphQLClient.getJobClientInsights's own docblock
   *  for why this needs a separate per-job query and genuinely 403s for a
   *  real minority of jobs — that's surfaced as `available: false`, not
   *  an error, since it's an expected limitation of some job postings,
   *  not a bug.
   *
   *  Ongoing/completed-by-type counts are computed here from the client's
   *  real work-history list (confirmed via introspection: no aggregate
   *  field anywhere in the schema already splits by both status AND
   *  contract type). JobOpeningStatus has a third real value, FILLED,
   *  beyond ACTIVE/CLOSED (confirmed via introspection) whose lifecycle
   *  meaning relative to "ongoing" isn't certain from the field alone —
   *  counted separately as `other`, not guessed into either bucket. */
  async getClientInsights(orgId: string, jobId: string) {
    return this.connection.withFreshTokenOnAuthFailure(orgId, async ({ accessToken, organizationId }) => {
      let details;
      try {
        details = await this.graphql.getJobClientInsights(accessToken, organizationId, jobId);
      } catch (err) {
        if (err instanceof UpworkGraphQLError && /restricted to registered users/i.test(err.message)) {
          return { available: false as const };
        }
        throw err;
      }
      if (!details) return { available: false as const };

      const workHistory = details.buyerExtra?.workHistory ?? [];
      const counts = { ongoingHourly: 0, ongoingFixed: 0, completedHourly: 0, completedFixed: 0, other: 0 };
      for (const item of workHistory) {
        const type = item.jobInfo?.type;
        if (type !== "FIXED" && type !== "HOURLY") continue;
        if (item.status === "ACTIVE") {
          if (type === "HOURLY") counts.ongoingHourly++;
          else counts.ongoingFixed++;
        } else if (item.status === "CLOSED") {
          if (type === "HOURLY") counts.completedHourly++;
          else counts.completedFixed++;
        } else {
          counts.other++;
        }
      }

      const durationType = details.opening?.durationType ?? null;
      return {
        available: true as const,
        avgHourlyRate: details.buyer?.avgHourlyJobsRate
          ? `${details.buyer.avgHourlyJobsRate.amount.toFixed(2)} ${details.buyer.avgHourlyJobsRate.currencyCode}/hr`
          : null,
        totalAssignments: details.buyer?.stats?.totalAssignments ?? null,
        activeAssignments: details.buyer?.stats?.activeAssignmentsCount ?? null,
        totalJobsWithHires: details.buyer?.stats?.totalJobsWithHires ?? null,
        hiredInPast: details.buyer?.stats?.hiredInPast ?? null,
        feedbackCount: details.buyer?.stats?.feedbackCount ?? null,
        score: details.buyer?.stats?.score ?? null,
        jobsFilled: details.buyer?.jobs?.filledCount ?? null,
        jobsOpen: details.buyer?.jobs?.openCount ?? null,
        jobsPosted: details.buyer?.jobs?.postedCount ?? null,
        projectType: durationType === "ONE_TIME_PROJECT" ? "One-time project" : durationType === "ONGOING_NEED" ? "Ongoing project" : null,
        talentType: details.qualifications?.type ?? null,
        preferredCountries: details.qualifications?.countries ?? [],
        minHoursPerWeek: details.qualifications?.minHoursWeek ?? null,
        minJobSuccessScore: details.qualifications?.minJobSuccessScore ?? null,
        shouldHavePortfolio: details.qualifications?.shouldHavePortfolio ?? false,
        risingTalent: details.qualifications?.risingTalent ?? false,
        workHistoryCounts: counts,
        workHistorySampleSize: workHistory.length,
      };
    });
  }
}
