import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../common/prisma/prisma.service";
import { UpdateOrgBrandingDto } from "./dto/update-org-branding.dto";

export interface OrgBranding {
  emailOrgName: string;
  emailSenderName: string;
}

/**
 * Reads/writes the email-branding fields living inside `Organization.settings`
 * (a free-form JSON column — no migration needed for two string fields). This
 * is what actually resolves `{{org.name}}` / `{{sender.name}}` in outreach
 * copy; before it existed those were literal, unsubstituted strings mailed to
 * real prospects.
 */
@Injectable()
export class OrganizationService {
  constructor(private readonly prisma: PrismaService) {}

  async getBranding(orgId: string): Promise<OrgBranding> {
    const org = await this.prisma.organization.findUniqueOrThrow({ where: { id: orgId } });
    const settings = (org.settings as Record<string, unknown>) ?? {};
    return {
      emailOrgName: (settings.emailOrgName as string) || org.name,
      emailSenderName: (settings.emailSenderName as string) || "The Team",
    };
  }

  async updateBranding(orgId: string, dto: UpdateOrgBrandingDto): Promise<OrgBranding> {
    const org = await this.prisma.organization.findUniqueOrThrow({ where: { id: orgId } });
    const settings = { ...(org.settings as Record<string, unknown>), ...dto };
    await this.prisma.organization.update({
      where: { id: orgId },
      data: { settings: settings as Prisma.InputJsonValue },
    });
    return this.getBranding(orgId);
  }

  /**
   * autoSendEnabled defaults to true when unset (Part: autonomous system) —
   * the AI-drafted pitch (Email #3) sends itself unless an org explicitly
   * opts back into a human approving each one first. See
   * LeadsService.receiveEmail3Draft for where this is actually read.
   */
  async getAutomationSettings(orgId: string): Promise<{ autoSendEnabled: boolean }> {
    const org = await this.prisma.organization.findUniqueOrThrow({ where: { id: orgId } });
    const settings = (org.settings as Record<string, unknown>) ?? {};
    return { autoSendEnabled: settings.autoSendEnabled !== false };
  }

  async updateAutomationSettings(
    orgId: string,
    dto: { autoSendEnabled?: boolean },
  ): Promise<{ autoSendEnabled: boolean }> {
    const org = await this.prisma.organization.findUniqueOrThrow({ where: { id: orgId } });
    const settings = { ...(org.settings as Record<string, unknown>), ...dto };
    await this.prisma.organization.update({
      where: { id: orgId },
      data: { settings: settings as Prisma.InputJsonValue },
    });
    return this.getAutomationSettings(orgId);
  }
}
