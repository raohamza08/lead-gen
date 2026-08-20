import { Controller, Get, Query, UseGuards } from "@nestjs/common";
import { OrganizationService } from "./organization.service";
import { InternalAuthGuard } from "../common/guards/internal-auth.guard";

/**
 * Separate from OrganizationController on purpose: that controller requires
 * a user JWT for every route, and the caller here is the AI workers process
 * itself — no signed-in user, just the internal service token (same guard
 * extraction-runs.controller.ts uses). Called once per pipeline run (see
 * shared/api_client.get_prompt_overrides on the AI workers side) so an
 * agent's prompt override actually reaches it, not just the Settings page
 * that edits it.
 */
@Controller("settings/organization/prompt-overrides")
@UseGuards(InternalAuthGuard)
export class PromptOverridesInternalController {
  constructor(private readonly service: OrganizationService) {}

  @Get()
  get(@Query("orgId") orgId: string) {
    return this.service.getPromptOverrides(orgId);
  }
}
