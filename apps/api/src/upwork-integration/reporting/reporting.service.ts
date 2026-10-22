import { Injectable, ServiceUnavailableException } from "@nestjs/common";
import { UpworkApiConnectionService } from "../connection/upwork-api-connection.service";

/**
 * Weekly/monthly/yearly financial & performance reporting — point 7 of the
 * Upwork API application ("Reporting"). See AgencyProfileService's
 * docblock for why this is a stub, not a guess — contract/earnings/
 * transaction aggregation needs Upwork's real reporting schema, not an
 * assumed one.
 */
@Injectable()
export class UpworkReportingService {
  constructor(private readonly connection: UpworkApiConnectionService) {}

  async getReport(orgId: string, period: "weekly" | "monthly" | "yearly"): Promise<never> {
    await this.connection.getValidAccessToken(orgId);
    throw new ServiceUnavailableException(
      `${period[0].toUpperCase()}${period.slice(1)} reporting isn't live yet — pending Upwork's app approval and a confirmed API schema.`,
    );
  }
}
