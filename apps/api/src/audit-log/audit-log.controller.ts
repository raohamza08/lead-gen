import { Controller, Get, Query, Req, UseGuards } from "@nestjs/common";
import { Request } from "express";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { PrimaryAdminGuard } from "../common/guards/primary-admin.guard";
import { RequiresPrimaryAdmin } from "../common/decorators/requires-primary-admin.decorator";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { JwtClaims } from "@leadgen/types";
import { AuditLogService } from "./audit-log.service";
import { QueryAuditLogsDto } from "./dto/query-audit-logs.dto";

/** System Logs — restricted to the org's primary admin (Part: Admin/System
 *  Logs, 2026-08-31), not the shared Role.ADMIN role. */
@Controller("admin/audit-logs")
@UseGuards(JwtAuthGuard, PrimaryAdminGuard)
@RequiresPrimaryAdmin()
export class AuditLogController {
  constructor(private readonly auditLogs: AuditLogService) {}

  @Get()
  list(@CurrentUser() user: JwtClaims, @Query() query: QueryAuditLogsDto, @Req() req: Request) {
    // Viewing the logs is itself logged — "admin activity is logged" is an
    // explicit requirement, not just the events the admin is looking at.
    this.auditLogs.write({
      orgId: user.orgId,
      actorId: user.sub,
      action: "VIEWED_SYSTEM_LOGS",
      entityType: "auditLog",
      ipAddress: req.ip,
    });

    return this.auditLogs.list(user.orgId, {
      actorId: query.actorId,
      entityType: query.entityType,
      action: query.action,
      result: query.result,
      leadId: query.leadId,
      dateFrom: query.dateFrom,
      dateTo: query.dateTo,
      search: query.search,
      page: Number(query.page) || undefined,
      pageSize: Number(query.pageSize) || undefined,
    });
  }
}
