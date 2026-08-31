import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from "@nestjs/common";
import { Observable } from "rxjs";
import { tap } from "rxjs/operators";
import { AuditLogService } from "../../audit-log/audit-log.service";

/** Route prefixes this interceptor should attribute to the `lead` entity
 *  (and therefore also populate the legacy `leadId` FK for) — everything
 *  else with an `:id` param gets a generic entityType derived from its
 *  first path segment instead of being mislabeled as a lead action (Part:
 *  Admin/System Logs, 2026-08-31 — the previous version assumed every
 *  `:id`-mutation route was about a lead). */
const LEAD_ROUTE_PREFIXES = ["/leads", "leads/"];

function entityTypeForRoute(path: string): string {
  const segment = path.replace(/^\/+/, "").split("/")[0];
  return segment || "unknown";
}

/**
 * Writes an audit row for any mutating request (POST/PATCH/DELETE) that
 * targets a specific resource (`:id` present). Fire-and-forget: an
 * audit-log failure must never fail the underlying request (Part G1 —
 * audit trail is a control, not a hard dependency).
 */
@Injectable()
export class AuditLogInterceptor implements NestInterceptor {
  constructor(private readonly auditLog: AuditLogService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest();
    const method = request.method;
    const entityId: string | undefined = request.params?.id;
    const actorId: string | undefined = request.user?.sub;
    const orgId: string | undefined = request.user?.orgId;
    const path: string = request.route?.path ?? request.url;

    if (!["POST", "PATCH", "DELETE"].includes(method) || !entityId) {
      return next.handle();
    }

    const isLeadRoute = LEAD_ROUTE_PREFIXES.some((p) => path.startsWith(p) || path.includes(`/${p}`));

    return next.handle().pipe(
      tap(() => {
        this.auditLog.write({
          orgId,
          actorId,
          leadId: isLeadRoute ? entityId : undefined,
          entityType: entityTypeForRoute(path),
          entityId,
          action: `${method} ${path}`,
          metadata: { body: request.body ?? {} },
        });
      }),
    );
  }
}
