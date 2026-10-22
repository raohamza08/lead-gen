import { Injectable, ServiceUnavailableException } from "@nestjs/common";
import { UpworkApiConnectionService } from "../connection/upwork-api-connection.service";

/**
 * Snapshots (spec Module D) — BLOCKED and a semantic mismatch with the
 * spec's description, confirmed live (Part: Upwork API integration —
 * enterprise module audit, 2026-10-23).
 *
 * The real `snapshotsByContractId(input: {contractId!, timestamp!})`
 * query is NOT the "public client" snapshot the spec describes — its
 * real return type (`Snapshot`) has `mouseEventsCount`,
 * `keyboardEventsCount`, `screenshotUrl`, `webcamUrl`,
 * `activeWindowTitle` — this is Upwork's Work Diary EMPLOYEE SCREEN/
 * WEBCAM MONITORING feature (one specific hourly capture per contract),
 * confirmed via introspection. It requires a specific `timestamp` (one
 * exact hour) in addition to a contract ID — there is no "all
 * snapshots for this contract" listing mode.
 *
 * This almost certainly requires the same team-level Upwork permission
 * already confirmed blocked for Timesheets (`view_gds_hourly_data_from_
 * client`/`view_gds_charges_data_from_client`) — same Work Diary feature
 * family — not separately re-tested live to avoid burning another real
 * API call confirming an already-known permission class. Even if
 * granted, this is screen/webcam monitoring data about a freelancer, not
 * "public client" information as the spec describes — building it as
 * "Module D: Snapshots" per the spec's own description would be building
 * the wrong feature.
 */
@Injectable()
export class UpworkSnapshotsService {
  constructor(private readonly connection: UpworkApiConnectionService) {}

  async listSnapshots(orgId: string): Promise<never> {
    await this.connection.getValidAccessToken(orgId);
    throw new ServiceUnavailableException(
      "Snapshots is blocked and a semantic mismatch: the real snapshotsByContractId query is Work Diary employee screen/webcam monitoring (one specific hour per contract), not public-client data as described, and almost certainly requires the same team permission already confirmed blocked for Timesheets.",
    );
  }
}
