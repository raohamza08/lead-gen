import { Module } from "@nestjs/common";
import { LeadsService } from "./leads.service";
import { LeadsController } from "./leads.controller";
import { SequencerModule } from "../sequencer/sequencer.module";
import { SyncModule } from "../sync/sync.module";

@Module({
  imports: [SequencerModule, SyncModule],
  providers: [LeadsService],
  controllers: [LeadsController],
  exports: [LeadsService],
})
export class LeadsModule {}
