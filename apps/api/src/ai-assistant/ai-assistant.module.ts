import { Module } from "@nestjs/common";
import { EmailHubModule } from "../email-hub/email-hub.module";
import { SocialMediaModule } from "../social-media/social-media.module";
import { SearchModule } from "../search/search.module";
import { UpworkProposalWritingModule } from "../upwork-proposal-writing/upwork-proposal-writing.module";
import { AssistantController } from "./assistant.controller";
import { AssistantService } from "./assistant.service";
import { AssistantContextService } from "./assistant-context.service";

@Module({
  // UpworkProposalWritingModule imported purely for its exported GeminiClient
  // (Part: AI chat assistant, 2026-10-21) — shares the same key-rotation/
  // cooldown-aware client instead of duplicating it.
  imports: [EmailHubModule, SocialMediaModule, SearchModule, UpworkProposalWritingModule],
  controllers: [AssistantController],
  providers: [AssistantService, AssistantContextService],
})
export class AiAssistantModule {}
