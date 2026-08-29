import { Module } from "@nestjs/common";
import { LeadsService } from "./leads.service";
import { LeadsController } from "./leads.controller";
import { SequencerModule } from "../sequencer/sequencer.module";
import { SyncModule } from "../sync/sync.module";
import { SocialMediaModule } from "../social-media/social-media.module";
import { EmailVerificationService } from "./email-verification.service";

@Module({
  imports: [SequencerModule, SyncModule, SocialMediaModule],
  providers: [LeadsService, EmailVerificationService],
  controllers: [LeadsController],
  exports: [LeadsService],
})
export class LeadsModule {}
