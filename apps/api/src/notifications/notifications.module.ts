import { Global, Module } from "@nestjs/common";
import { NotificationsService } from "./notifications.service";
import { NotificationsController } from "./notifications.controller";
import { PermissionDenialLogger } from "../common/guards/permission-denial-logger.service";

/** Global (like PrismaModule/RealtimeModule) — the queue/email workers that
 *  need to escalate an exhausted retry live in several different modules,
 *  and none of them should have to import this just to report a failure.
 *  PermissionDenialLogger lives here too (Part: Admin tier & audit
 *  hardening, 2026-08-31) since it's just NotificationsService + PrismaService
 *  wrapped for the three permission guards to share. */
@Global()
@Module({
  providers: [NotificationsService, PermissionDenialLogger],
  controllers: [NotificationsController],
  exports: [NotificationsService, PermissionDenialLogger],
})
export class NotificationsModule {}
