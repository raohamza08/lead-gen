import { Module } from "@nestjs/common";
import { UpworkProposalWritingController } from "./upwork-proposal-writing.controller";
import { UpworkJobFetcherService } from "./services/job-fetcher.service";
import { GeminiClient } from "./services/gemini.client";
import { ProposalWritingSettingsService } from "./services/proposal-writing-settings.service";
import { ProposalWritingService } from "./services/proposal-writing.service";

@Module({
  controllers: [UpworkProposalWritingController],
  providers: [UpworkJobFetcherService, GeminiClient, ProposalWritingSettingsService, ProposalWritingService],
})
export class UpworkProposalWritingModule {}
