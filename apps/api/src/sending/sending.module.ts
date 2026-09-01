import { Global, Module } from "@nestjs/common";
import { EmailModule } from "../email/email.module";
import { SendingQueue } from "./sending-queue.queue";
import { SendingQueueService } from "./sending-queue.service";
import { SendingSchedulerService } from "./sending-scheduler.service";
import { SendingScheduleController } from "./sending-schedule.controller";
import { SendingWorker } from "./sending.worker";
import { SendingSweepQueue } from "./sending-sweep.queue";
import { SendingSweepWorker } from "./sending-sweep.worker";

/** Global (like AgentDispatchModule) so PreparationPipelineService can
 *  enqueue a fully-prepared message without every module in the tree
 *  importing this one. */
@Global()
@Module({
  imports: [EmailModule],
  controllers: [SendingScheduleController],
  providers: [
    SendingQueue,
    SendingQueueService,
    SendingSchedulerService,
    SendingWorker,
    SendingSweepQueue,
    SendingSweepWorker,
  ],
  exports: [SendingQueueService, SendingSchedulerService],
})
export class SendingModule {}
