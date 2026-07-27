import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from "@nestjs/common";
import { Observable } from "rxjs";
import { tap } from "rxjs/operators";
import { PrismaService } from "../prisma/prisma.service";

/**
 * Writes an AUDIT_LOG row for any mutating request (POST/PATCH/DELETE) that
 * targets a lead. Fire-and-forget: an audit-log failure must never fail the
 * underlying request (Part G1 — audit trail is a control, not a hard dependency).
 */
@Injectable()
export class AuditLogInterceptor implements NestInterceptor {
  constructor(private readonly prisma: PrismaService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest();
    const method = request.method;
    const leadId: string | undefined = request.params?.id;
    const actorId: string | undefined = request.user?.sub;

    if (!["POST", "PATCH", "DELETE"].includes(method) || !leadId) {
      return next.handle();
    }

    return next.handle().pipe(
      tap(() => {
        this.prisma.auditLog
          .create({
            data: {
              leadId,
              actorId,
              action: `${method} ${request.route?.path ?? request.url}`,
              diff: request.body ?? {},
            },
          })
          .catch(() => {
            // Intentionally swallowed — see class doc comment.
          });
      }),
    );
  }
}
