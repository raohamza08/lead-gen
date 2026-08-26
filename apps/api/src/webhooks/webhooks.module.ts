import { Module } from "@nestjs/common";
import { ClickupWebhookController } from "./clickup-webhook.controller";
import { EmailWebhookController } from "./email-webhook.controller";
import { TrackingController } from "./tracking.controller";
import { SocialWebhookController } from "./social-webhook.controller";
import { LeadsModule } from "../leads/leads.module";
import { SequencerModule } from "../sequencer/sequencer.module";
import { SyncModule } from "../sync/sync.module";
import { EmailModule } from "../email/email.module";
import { SocialMediaModule } from "../social-media/social-media.module";
import { GmailAdapterService } from "./gmail-adapter.service";
import { GraphAdapterService } from "./graph-adapter.service";

@Module({
  imports: [LeadsModule, SequencerModule, SyncModule, EmailModule, SocialMediaModule],
  controllers: [ClickupWebhookController, EmailWebhookController, TrackingController, SocialWebhookController],
  providers: [GmailAdapterService, GraphAdapterService],
})
export class WebhooksModule {}
