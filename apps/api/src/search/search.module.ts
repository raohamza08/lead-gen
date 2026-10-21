import { Module } from "@nestjs/common";
import { LeadsModule } from "../leads/leads.module";
import { EmailHubModule } from "../email-hub/email-hub.module";
import { SocialMediaModule } from "../social-media/social-media.module";
import { UpworkModule } from "../upwork/upwork.module";
import { SearchController } from "./search.controller";
import { SearchService } from "./search.service";

@Module({
  imports: [LeadsModule, EmailHubModule, SocialMediaModule, UpworkModule],
  controllers: [SearchController],
  providers: [SearchService],
  exports: [SearchService],
})
export class SearchModule {}
