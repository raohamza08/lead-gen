import { Module } from "@nestjs/common";
import { SequencerService } from "./sequencer.service";
import { SequencesController } from "./sequences.controller";
import { SyncModule } from "../sync/sync.module";
import { OrganizationModule } from "../organization/organization.module";

@Module({
  imports: [SyncModule, OrganizationModule],
  controllers: [SequencesController],
  providers: [SequencerService],
  exports: [SequencerService],
})
export class SequencerModule {}
