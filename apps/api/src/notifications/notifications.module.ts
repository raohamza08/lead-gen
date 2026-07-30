import { Global, Module } from "@nestjs/common";
import { NotificationsService } from "./notifications.service";
import { NotificationsController } from "./notifications.controller";

/** Global (like PrismaModule/RealtimeModule) — the queue/email workers that
 *  need to escalate an exhausted retry live in several different modules,
 *  and none of them should have to import this just to report a failure. */
@Global()
@Module({
  providers: [NotificationsService],
  controllers: [NotificationsController],
  exports: [NotificationsService],
})
export class NotificationsModule {}
