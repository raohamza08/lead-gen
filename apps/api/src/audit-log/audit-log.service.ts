import { Injectable, Logger } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../common/prisma/prisma.service";

export interface AuditLogInput {
  orgId?: string;
  actorId?: string;
  action: string;
  entityType?: string;
  entityId?: string;
  leadId?: string;
  result?: "SUCCESS" | "FAILURE";
  ipAddress?: string;
  metadata?: Record<string, unknown>;
}

export interface AuditLogQuery {
  actorId?: string;
  entityType?: string;
  action?: string;
  result?: "SUCCESS" | "FAILURE";
  leadId?: string;
  dateFrom?: string;
  dateTo?: string;
  search?: string;
  page?: number;
  pageSize?: number;
}

/**
 * Single write/read path for the audit trail (Part: Admin/System Logs,
 * 2026-08-31) — generalizes AuditLog beyond its previous lead-only,
 * interceptor-populated shape. Every call site (auth, user management, the
 * permission-denial guards, the lead-mutation interceptor) writes through
 * here so the schema mapping lives in one place, same reasoning as
 * NotificationsService centralizing notification creation.
 *
 * Writes are fire-and-forget from the caller's perspective — an audit-log
 * failure must never fail the underlying request (unchanged from the
 * original interceptor's design).
 */
@Injectable()
export class AuditLogService {
  private readonly logger = new Logger(AuditLogService.name);

  constructor(private readonly prisma: PrismaService) {}

  write(input: AuditLogInput): void {
    this.prisma.auditLog
      .create({
        data: {
          orgId: input.orgId,
          actorId: input.actorId,
          action: input.action,
          entityType: input.entityType,
          entityId: input.entityId,
          leadId: input.leadId,
          result: input.result ?? "SUCCESS",
          ipAddress: input.ipAddress,
          metadata: (input.metadata ?? {}) as Prisma.InputJsonValue,
        },
      })
      .catch((err) => this.logger.warn(`could not write audit log: ${(err as Error).message}`));
  }

  async list(orgId: string, query: AuditLogQuery) {
    const page = query.page ?? 1;
    const pageSize = Math.min(Math.max(query.pageSize ?? 50, 1), 200);

    const where: Prisma.AuditLogWhereInput = {
      orgId,
      actorId: query.actorId,
      entityType: query.entityType,
      leadId: query.leadId,
      result: query.result,
      action: query.action ? { contains: query.action, mode: "insensitive" } : undefined,
      createdAt: {
        gte: query.dateFrom ? new Date(query.dateFrom) : undefined,
        lte: query.dateTo ? new Date(query.dateTo) : undefined,
      },
      // Free-text search spans action + entity id — the two fields an admin
      // investigating an incident is most likely to have a fragment of
      // (e.g. a lead id copied from a support ticket).
      OR: query.search
        ? [
            { action: { contains: query.search, mode: "insensitive" } },
            { entityId: { contains: query.search, mode: "insensitive" } },
          ]
        : undefined,
    };

    const [items, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        include: { actor: { select: { id: true, name: true, email: true } } },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.auditLog.count({ where }),
    ]);

    return { items, total, page, pageSize };
  }
}
