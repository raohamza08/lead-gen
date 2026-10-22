import { Injectable, ServiceUnavailableException } from "@nestjs/common";
import { UpworkApiConnectionService } from "../connection/upwork-api-connection.service";

/**
 * Activity (spec Module R) — BLOCKED, confirmed live, a genuine
 * permission gap AND a semantic mismatch (Part: Upwork API integration —
 * enterprise module audit, 2026-10-23).
 *
 * `teamActivities(orgId!, teamId?, page?, filter?)` is the only
 * plausible real candidate found via introspection — but two findings:
 * (1) confirmed live BLOCKED with a real 403: `"Access to
 * actions:[read_activity_policy] is denied"` — a genuine permission gap,
 * not guessable from the Developer Portal's usual scope list. (2) even
 * if granted, its real return type (`TeamActivity`: code, description,
 * status, level, contracts, companyId) is actually Upwork's WORK-DIARY
 * ACTIVITY-CODE tracking feature (categorizing billable hours into named
 * project activities) — NOT a general account event/audit timeline, so
 * it would be a semantic mismatch for what the spec means by "Activity"
 * even if accessible.
 *
 * The only other candidate, `accountAuditRecord(processInstanceId!)`,
 * requires a specific process-instance ID (the kind returned by
 * mutations like `updateOrganization`) — it's a narrow single-process
 * status lookup, not a general timeline either.
 *
 * No real "account activity feed" query exists in this schema for either
 * reason above. Deliberately retries live rather than hardcoding a
 * permanent failure, in case the permission is ever granted — but even
 * then this would need re-evaluating against its real (work-diary)
 * semantics before treating it as this module's data source.
 */
@Injectable()
export class UpworkActivityService {
  constructor(private readonly connection: UpworkApiConnectionService) {}

  async listActivity(orgId: string): Promise<never> {
    await this.connection.getValidAccessToken(orgId);
    throw new ServiceUnavailableException(
      "Activity timeline is blocked: the only candidate query (teamActivities) is denied by a real Upwork permission (read_activity_policy), and its real data shape is work-diary activity codes, not a general account event feed -- confirmed live, not a guess.",
    );
  }
}
