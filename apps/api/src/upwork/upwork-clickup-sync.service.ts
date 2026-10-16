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
  UPWORK_PROFILE_FIELD_ID,
  resolveUpworkClickupRoute,
} from "./upwork-clickup-routing.util";

type ClickupField = { id: string; name: string; type: string; type_config?: { options?: { id: string; name: string }[] } };

/**
 * Creates a ClickUp card the moment a proposal is won or asked to do a
 * test task (Part: Upwork → ClickUp card automation, explicit user
 * request, 2026-10-16). Which list/assignee/status to use is a static
 * routing table (see upwork-clickup-routing.util.ts), but the "Upwork
 * Profile" and "Assigned Members" dropdown values are matched LIVE against
 * the list's real custom-field options every time — explicit user request:
 * "the dropdown for upwork profile should be filled with the profile name
 * that is added in the system, take it from there... the tag and the drop
 * would be same... the assigned member will be ahmad and bilal only" — so
 * the tag and the dropdown selection always agree, and a dropdown option
 * added later in ClickUp just starts matching without a code change.
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

      const fields = await this.clickup.getListFields(route.listId);
      const { profileOption, tagName } = this.resolveProfileOption(fields, proposal.profileName);
      const assignedMembersOption = this.findOptionByExactName(fields, ASSIGNED_MEMBERS_FIELD_ID, route.assigneeName);
      if (!assignedMembersOption) {
        this.logger.warn(
          `"Assigned Members" dropdown has no option named "${route.assigneeName}" (list ${route.listId}) — leaving that field unset on proposal ${proposal.id}'s new card.`,
        );
      }
      if (!profileOption) {
        this.logger.warn(
          `"Upwork Profile" dropdown has no option matching "${proposal.profileName}" (list ${route.listId}) — leaving that field unset on proposal ${proposal.id}'s new card.`,
        );
      }

      const customFields: { id: string; value: unknown }[] = [
        { id: CONTRACT_TYPE_FIELD_ID, value: CONTRACT_TYPE_OPTIONS[proposal.pricingType] },
        { id: DEPARTMENT_FIELD_ID, value: route.departmentOptionId },
        { id: TEAM_LEAD_FIELD_ID, value: route.teamLeadOptionId },
        { id: COMMUNICATION_CHANNEL_FIELD_ID, value: [COMMUNICATION_CHANNEL_UPWORK_LABEL_ID] },
        { id: PHASE_FIELD_ID, value: PHASE_PLANNING_OPTION_ID },
      ];
      if (profileOption) customFields.push({ id: UPWORK_PROFILE_FIELD_ID, value: profileOption.id });
      if (assignedMembersOption) customFields.push({ id: ASSIGNED_MEMBERS_FIELD_ID, value: assignedMembersOption.id });

      const created = await this.clickup.createTaskFull(route.listId, {
        name: `${proposal.clientName ?? proposal.profileName} — ${proposal.jobCategory}`,
        description: this.buildDescription(proposal),
        status: clickupStatus,
        assignees: [route.assigneeUserId],
        customFields,
      });

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

  /** Matches `profileName` against the live "Upwork Profile" dropdown —
   *  tries an exact (case-insensitive) match first, then with/without a
   *  trailing " ID" suffix, since it's unclear which exact form the
   *  system's own profile picklist uses. The tag applied to the card is
   *  always the *matched option's own label* (never a shortened/lowercased
   *  fragment) so the tag and the dropdown selection read identically; if
   *  nothing matches, falls back to the raw profileName for the tag so
   *  there's still a consistent, honest label even without a dropdown pick. */
  private resolveProfileOption(fields: ClickupField[], profileName: string): { profileOption?: { id: string; name: string }; tagName?: string } {
    const field = fields.find((f) => f.id === UPWORK_PROFILE_FIELD_ID);
    const options = field?.type_config?.options ?? [];
    const trimmed = profileName.trim();
    const candidates = [trimmed, trimmed.replace(/\s*ID$/i, ""), /\bID$/i.test(trimmed) ? trimmed : `${trimmed} ID`];
    const match = options.find((o) => candidates.some((c) => c.toLowerCase() === o.name.toLowerCase()));
    return match ? { profileOption: match, tagName: match.name } : { tagName: trimmed || undefined };
  }

  private findOptionByExactName(fields: ClickupField[], fieldId: string, name: string): { id: string; name: string } | undefined {
    const field = fields.find((f) => f.id === fieldId);
    return field?.type_config?.options?.find((o) => o.name.trim().toLowerCase() === name.trim().toLowerCase());
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
