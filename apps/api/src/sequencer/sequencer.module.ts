import { Module } from "@nestjs/common";
import { SequencerService } from "./sequencer.service";
import { SequencesController } from "./sequences.controller";
import { SyncModule } from "../sync/sync.module";
import { OrganizationModule } from "../organization/organization.module";
import { EmailModule } from "../email/email.module";
import { PipelineWaitSweepQueue } from "./pipeline-wait-sweep.queue";
import { PipelineWaitSweepWorker } from "./pipeline-wait-sweep.worker";
import { DraftSchedulerQueue } from "./draft-scheduler.queue";
import { DraftSchedulerWorker } from "./draft-scheduler.worker";
import { ClaudeRateLimitService } from "../agents/claude-rate-limit.service";

@Module({
  imports: [SyncModule, OrganizationModule, EmailModule],
  controllers: [SequencesController],
  providers: [
    SequencerService,
    PipelineWaitSweepQueue,
    PipelineWaitSweepWorker,
    DraftSchedulerQueue,
    DraftSchedulerWorker,
    // Also provided in AgentsModule — see that provider's own comment for
    // why (would otherwise be a circular module import; this service is
    // stateless so two instances sharing the same Redis key is safe).
    ClaudeRateLimitService,
  ],
  exports: [SequencerService],
})
export class SequencerModule {}
