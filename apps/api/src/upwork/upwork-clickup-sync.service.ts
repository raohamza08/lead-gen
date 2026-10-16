import { Injectable, Logger } from "@nestjs/common";
import { UpworkProposal, UpworkProposalStatus } from "@prisma/client";
import { ClickupClient } from "../sync/clickup.client";
import { PrismaService } from "../common/prisma/prisma.service";
import {
  ASSIGNED_MEMBERS_FIELD_ID,
  CLICKUP_ONBOARDING_STATUS,
  CLICKUP_TEST_TASK_STATUS,
  COMMUNICATION_CHANNEL_FIELD_ID,
  COMMUNICATION_CHANNEL_UPWORK_LABEL_ID,
  CONTRACT_TYPE_FIELD_ID,
  CONTRACT_TYPE_OPTIONS,
  DEPARTMENT_FIELD_ID,
  PHASE_FIELD_ID,
  PHASE_PLANNING_OPTION_ID,
  TEAM_LEAD_FIELD_ID,
  buildUpworkProfileCustomField,
  resolveUpworkClickupRoute,
} from "./upwork-clickup-routing.util";

/**
 * Creates a ClickUp card the moment a proposal is won or asked to do a
 * test task (Part: Upwork → ClickUp card automation, explicit user
 * request, 2026-10-16). Routing (which list/assignee/tag) is static —
 * see upwork-clickup-routing.util.ts for the real IDs and the three
 * known gaps (mahnoor/junaid/nadeem have no "Upwork Profile" custom-field
 * option yet; the Tech/Web assignee has no matching "Assigned Members"
 * dropdown option).
 *
 * Deliberately never throws out of `sync` — a ClickUp outage or a
 * misconfigured token must not block the status update itself, only skip
 * the card creation (logged, not silent).
 */
@Injectable()
export class UpworkClickupSyncService {
  private readonly logger = new Logger(UpworkClickupSyncService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly clickup: ClickupClient,
  ) {}

  async sync(proposal: UpworkProposal): Promise<void> {
    if (!this.clickup.isConfigured()) return;

    const clickupStatus =
      proposal.status === UpworkProposalStatus.WON
        ? CLICKUP_ONBOARDING_STATUS
        : proposal.status === UpworkProposalStatus.TEST_TASK
          ? CLICKUP_TEST_TASK_STATUS
          : null;
    if (!clickupStatus) return;

    try {
      if (proposal.clickupTaskId) {
        // Card already exists (e.g. TEST_TASK -> WON later in the same
        // proposal's life) — move its status rather than creating a
        // second card for the same project.
        await this.clickup.updateTaskStatus(proposal.clickupTaskId, clickupStatus);
        return;
      }

      const route = resolveUpworkClickupRoute(proposal.profileName);
      if (!route) {
        this.logger.warn(`No ClickUp route for profile "${proposal.profileName}" (proposal ${proposal.id}) — skipping card creation.`);
        return;
      }

      const customFields: { id: string; value: unknown }[] = [
        { id: CONTRACT_TYPE_FIELD_ID, value: CONTRACT_TYPE_OPTIONS[proposal.pricingType] },
        { id: DEPARTMENT_FIELD_ID, value: route.departmentOptionId },
        { id: TEAM_LEAD_FIELD_ID, value: route.teamLeadOptionId },
        { id: COMMUNICATION_CHANNEL_FIELD_ID, value: [COMMUNICATION_CHANNEL_UPWORK_LABEL_ID] },
        { id: PHASE_FIELD_ID, value: PHASE_PLANNING_OPTION_ID },
      ];
      const profileField = buildUpworkProfileCustomField(proposal.profileName);
      if (profileField) customFields.push(profileField);
      if (route.assignedMembersOptionId) customFields.push({ id: ASSIGNED_MEMBERS_FIELD_ID, value: route.assignedMembersOptionId });

      const created = await this.clickup.createTaskFull(route.listId, {
        name: `${proposal.clientName ?? proposal.profileName} — ${proposal.jobCategory}`,
        description: this.buildDescription(proposal),
        status: clickupStatus,
        assignees: [route.assigneeUserId],
        customFields,
      });

      const tagName = proposal.profileName.trim().split(/\s+/)[0]?.toLowerCase();
      if (tagName) {
        await this.clickup.addTagToTask(created.id, tagName).catch((err) =>
          this.logger.error(`Failed to tag ClickUp task ${created.id} with "${tagName}": ${(err as Error).message}`),
        );
      }

      await this.prisma.upworkProposal.update({ where: { id: proposal.id }, data: { clickupTaskId: created.id } });
    } catch (err) {
      this.logger.error(`ClickUp sync failed for proposal ${proposal.id}: ${(err as Error).message}`);
    }
  }

  private buildDescription(proposal: UpworkProposal): string {
    const lines = [
      `Upwork profile: ${proposal.profileName}`,
      `Job category: ${proposal.jobCategory}`,
      `Job link: ${proposal.jobLink}`,
      `Pricing: ${proposal.pricingType === "FIXED" ? "Fixed-price" : proposal.projectHours != null ? `Hourly — ${proposal.projectHours}h` : "Hourly"}`,
      proposal.clientName ? `Client: ${proposal.clientName}` : null,
      `Submitted by: ${proposal.submittedBy}`,
      proposal.closedBy ? `Closed by: ${proposal.closedBy}` : null,
      "",
      "What the client needs / what we pitched to deliver (from the submitted proposal):",
      proposal.coverLetter,
    ].filter((l): l is string => l !== null);
    return lines.join("\n");
  }
}
