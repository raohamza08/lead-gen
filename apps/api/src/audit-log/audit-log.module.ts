import { Global, Module } from "@nestjs/common";
import { AuditLogService } from "./audit-log.service";
import { AuditLogController } from "./audit-log.controller";

/** Global (like NotificationsModule/PrismaModule) — auth, users, and the
 *  permission guards all need to write an audit row without importing this
 *  module explicitly. */
@Global()
@Module({
  providers: [AuditLogService],
  controllers: [AuditLogController],
  exports: [AuditLogService],
})
export class AuditLogModule {}
