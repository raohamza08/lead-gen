import { Injectable, Logger } from "@nestjs/common";
import { JwtClaims } from "@leadgen/types";
import { NotificationCategory } from "@prisma/client";
import { NotificationsService } from "../../notifications/notifications.service";
import { AuditLogService } from "../../audit-log/audit-log.service";

/**
 * Shared by RolesGuard/ModuleAccessGuard/PrimaryAdminGuard (Part: Admin tier
 * & audit hardening, 2026-08-31) — every permission rejection gets one audit
 * row and one SECURITY-category notification, instead of each guard
 * reimplementing this.
 *
 * Fire-and-forget from the guard's perspective: a logging failure must never
 * turn an otherwise-correct 403 into a 500.
 */
@Injectable()
export class PermissionDenialLogger {
  private readonly logger = new Logger(PermissionDenialLogger.name);

  constructor(
    private readonly auditLog: AuditLogService,
    private readonly notifications: NotificationsService,
  ) {}

  log(user: JwtClaims | undefined, reason: string, route?: string): void {
    if (!user) return; // unauthenticated entirely — JwtAuthGuard's own 401 covers this, nothing more to attribute it to
    this.auditLog.write({
      orgId: user.orgId,
      actorId: user.sub,
      action: "PERMISSION_DENIED",
      entityType: "permission",
      result: "FAILURE",
      metadata: { reason, route: route ?? "" },
    });

    this.notifications
      .notify(user.orgId, {
        category: NotificationCategory.SECURITY,
        type: "PERMISSION_DENIED",
        severity: "WARNING",
        title: "Unauthorized Access Attempt",
        message: `${user.email} was denied access${route ? ` to ${route}` : ""} — ${reason}`,
        actionUrl: "/admin/system-logs",
      })
      .catch((err) => this.logger.warn(`could not notify permission denial: ${(err as Error).message}`));
  }
}
