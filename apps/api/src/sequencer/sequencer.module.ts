import { Module } from "@nestjs/common";
import { SequencerService } from "./sequencer.service";
import { SequencesController } from "./sequences.controller";
import { SyncModule } from "../sync/sync.module";
import { OrganizationModule } from "../organization/organization.module";
import { EmailModule } from "../email/email.module";
import { PipelineWaitSweepQueue } from "./pipeline-wait-sweep.queue";
import { PipelineWaitSweepWorker } from "./pipeline-wait-sweep.worker";

@Module({
  imports: [SyncModule, OrganizationModule, EmailModule],
  controllers: [SequencesController],
  providers: [SequencerService, PipelineWaitSweepQueue, PipelineWaitSweepWorker],
  exports: [SequencerService],
})
export class SequencerModule {}
