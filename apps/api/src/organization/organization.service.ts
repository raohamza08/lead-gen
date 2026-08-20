import { Injectable, NotFoundException, ServiceUnavailableException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../common/prisma/prisma.service";
import { UpdateOrgBrandingDto } from "./dto/update-org-branding.dto";

export interface OrgBranding {
  emailOrgName: string;
  emailSenderName: string;
}

export interface AgentPrompt {
  name: string;
  responsibility: string;
  defaultPrompt: string;
  currentPrompt: string;
  isOverridden: boolean;
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
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

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
   * every AI-drafted email in the 5-email sequence sends itself unless an
   * org explicitly opts back into a human approving each one first. See
   * LeadsService.receiveEmailDraft for where this is actually read (and for
   * why a draft flagged `needsReview` overrides this regardless).
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

  /**
   * Raw override map (agent name -> prompt text), nothing else. This is what
   * the AI workers themselves fetch at the top of each pipeline run (see
   * shared/api_client.get_prompt_overrides there) — internal-token-guarded,
   * not the user-facing read below, since a worker process has no JWT.
   */
  async getPromptOverrides(orgId: string): Promise<Record<string, string>> {
    const org = await this.prisma.organization.findUniqueOrThrow({ where: { id: orgId } });
    const settings = (org.settings as Record<string, unknown>) ?? {};
    return (settings.agentPrompts as Record<string, string>) ?? {};
  }

  /**
   * Full editable roster for Settings — each agent's shipped default (source
   * of truth lives in the AI workers' shared/prompts/*.txt files, fetched
   * live rather than duplicated here) merged with whatever this org has
   * overridden. `email` shows as six separate rows (one per sequence step
   * plus the shared voice rules) — see PROMPTABLE_AGENTS in ai-workers'
   * main.py for why.
   */
  async getAgentPrompts(orgId: string): Promise<AgentPrompt[]> {
    const [overrides, defaults] = await Promise.all([
      this.getPromptOverrides(orgId),
      this.fetchDefaultPrompts(),
    ]);
    return Object.entries(defaults).map(([name, info]) => ({
      name,
      responsibility: info.responsibility,
      defaultPrompt: info.defaultPrompt,
      currentPrompt: overrides[name] || info.defaultPrompt,
      isOverridden: Boolean(overrides[name]),
    }));
  }

  private async fetchDefaultPrompts(): Promise<
    Record<string, { responsibility: string; defaultPrompt: string }>
  > {
    const aiWorkersUrl = this.config.get<string>("AI_WORKERS_URL", "http://localhost:8000");
    try {
      const res = await fetch(`${aiWorkersUrl}/agents/prompts`);
      if (!res.ok) throw new Error(`worker responded ${res.status}`);
      return res.json();
    } catch (err) {
      throw new ServiceUnavailableException(
        `Could not reach the AI workers for the prompt roster: ${(err as Error).message}`,
      );
    }
  }

  /** Saves an org's override for one agent's prompt — used verbatim (no
   *  server-side templating), see shared/prompts.py on the AI workers side
   *  for why that's the safe design: it can never crash an agent over a
   *  mistyped placeholder. */
  async updateAgentPrompt(orgId: string, name: string, prompt: string): Promise<AgentPrompt[]> {
    const defaults = await this.fetchDefaultPrompts();
    if (!defaults[name]) throw new NotFoundException(`Unknown agent "${name}"`);

    const org = await this.prisma.organization.findUniqueOrThrow({ where: { id: orgId } });
    const settings = { ...(org.settings as Record<string, unknown>) };
    settings.agentPrompts = { ...((settings.agentPrompts as Record<string, string>) ?? {}), [name]: prompt };
    await this.prisma.organization.update({
      where: { id: orgId },
      data: { settings: settings as Prisma.InputJsonValue },
    });
    return this.getAgentPrompts(orgId);
  }

  /** The "Default" button — removes this org's override so the agent goes
   *  back to running the text the agent's own author shipped. */
  async restoreAgentPrompt(orgId: string, name: string): Promise<AgentPrompt[]> {
    const org = await this.prisma.organization.findUniqueOrThrow({ where: { id: orgId } });
    const settings = { ...(org.settings as Record<string, unknown>) };
    const agentPrompts = { ...((settings.agentPrompts as Record<string, string>) ?? {}) };
    delete agentPrompts[name];
    settings.agentPrompts = agentPrompts;
    await this.prisma.organization.update({
      where: { id: orgId },
      data: { settings: settings as Prisma.InputJsonValue },
    });
    return this.getAgentPrompts(orgId);
  }
}
