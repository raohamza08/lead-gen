import { Module } from "@nestjs/common";
import { UpworkConnectionModule } from "../connection/connection.module";
import { UpworkChatMonitoringController } from "./chat-monitoring.controller";
import { UpworkChatMonitoringService } from "./chat-monitoring.service";

/** Client communication monitoring domain — stub module (Part: Upwork API
 *  integration — modular architecture pass, 2026-10-22). */
@Module({
  imports: [UpworkConnectionModule],
  controllers: [UpworkChatMonitoringController],
  providers: [UpworkChatMonitoringService],
})
export class UpworkChatMonitoringModule {}
