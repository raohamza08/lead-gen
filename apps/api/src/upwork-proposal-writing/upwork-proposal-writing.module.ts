import { Module } from "@nestjs/common";
import { UpworkProposalWritingController } from "./upwork-proposal-writing.controller";
import { UpworkJobFetcherService } from "./services/job-fetcher.service";
import { GeminiClient } from "./services/gemini.client";
import { ProposalWritingSettingsService } from "./services/proposal-writing-settings.service";
import { ProposalWritingService } from "./services/proposal-writing.service";
import { FreelancerProfilesService } from "./services/freelancer-profiles.service";
import { DiscoveredJobsService } from "./services/discovered-jobs.service";
import { InviteProposalWritingService } from "./services/invite-proposal-writing.service";

@Module({
  controllers: [UpworkProposalWritingController],
  providers: [
    UpworkJobFetcherService,
    GeminiClient,
    ProposalWritingSettingsService,
    ProposalWritingService,
    FreelancerProfilesService,
    DiscoveredJobsService,
    InviteProposalWritingService,
  ],
  // GeminiClient exported (Part: AI chat assistant, 2026-10-21) so
  // AiAssistantModule can inject the same key-rotation-aware client instead
  // of duplicating it.
  exports: [GeminiClient],
})
export class UpworkProposalWritingModule {}
