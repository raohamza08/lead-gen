import { Injectable, Logger } from "@nestjs/common";
import { JwtClaims } from "@leadgen/types";
import { NotificationCategory, Prisma, Role } from "@prisma/client";
import { PrismaService } from "../common/prisma/prisma.service";
import { RealtimeGateway } from "../realtime/realtime.gateway";
import { UserAccessCacheService } from "../common/access/user-access-cache.service";

export interface NotifyInput {
  category: NotificationCategory;
  /** Machine-readable event key (EMAIL_DRAFT_FAILED, etc.) — kept for
   *  filtering/analytics; `title`/`message` are what's actually rendered. */
  type: string;
  title: string;
  message: string;
  severity?: "ERROR" | "WARNING";
  leadId?: string;
  conversationId?: string;
  entityType?: string;
  entityId?: string;
  /** Precomputed deep link, e.g. "/leads/104" — see Notification's schema
   *  docblock for why this lives on the record instead of being guessed
   *  client-side. */
  actionUrl?: string;
}

type EligibilityUser = {
  role: Role;
  leadGenAccess: boolean;
  emailHubAccess: boolean;
  socialMediaAccess: boolean;
  isPrimaryAdmin: boolean;
};

/** Which per-user module flag a category requires — SYSTEM/ERRORS/OTHER
 *  have no entry, meaning "visible to every active org member" (see
 *  isEligible). SECURITY isn't listed here; it has its own rule below. */
const MODULE_FLAG_BY_CATEGORY: Partial<Record<NotificationCategory, keyof Omit<EligibilityUser, "role">>> = {
  [NotificationCategory.EMAIL]: "emailHubAccess",
  [NotificationCategory.LEADS]: "leadGenAccess",
  [NotificationCategory.AGENTS]: "leadGenAccess",
  [NotificationCategory.AUTOMATIONS]: "leadGenAccess",
  [NotificationCategory.SOCIAL]: "socialMediaAccess",
};

/**
 * Notification Center backend (Part: Notification Center, 2026-08-31).
 * Replaces the previous org-wide-only design: one Notification row per
 * event (never fanned out per recipient), with eligibility to see it
 * computed live from the category + the requesting user's module access —
 * the exact same rule enforced on the realtime push (`notify`) and the REST
 * read path (`list`/`unreadCount`), so neither can drift from the other and
 * "create it for everyone, hide it in the frontend" is impossible by
 * construction. Read/dismissed state is per-user via NotificationUserState,
 * so one user's "mark all read" never touches another user's view of the
 * same shared row.
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeGateway,
    private readonly userAccess: UserAccessCacheService,
  ) {}

  async notify(orgId: string, input: NotifyInput) {
    const notification = await this.prisma.notification.create({
      data: {
        orgId,
        category: input.category,
        type: input.type,
        title: input.title,
        message: input.message,
        severity: input.severity ?? "ERROR",
        leadId: input.leadId,
        conversationId: input.conversationId,
        entityType: input.entityType,
        entityId: input.entityId,
        actionUrl: input.actionUrl,
      },
    });
    this.logger.warn(`[${input.type}] ${input.message}`);

    const eligibleUserIds = await this.eligibleUserIds(orgId, input.category);
    for (const userId of eligibleUserIds) {
      this.realtime.emitToUser(userId, "notification.created", notification);
    }
    return notification;
  }

  private isEligible(user: EligibilityUser, category: NotificationCategory): boolean {
    if (category === NotificationCategory.SECURITY) return user.isPrimaryAdmin;
    if (user.role === Role.ADMIN) return true; // ADMIN bypasses module flags, same as ModuleAccessGuard
    const flag = MODULE_FLAG_BY_CATEGORY[category];
    if (!flag) return true; // SYSTEM/ERRORS/OTHER — visible to every active org member
    return user[flag];
  }

  private eligibleCategories(user: EligibilityUser): NotificationCategory[] {
    return Object.values(NotificationCategory).filter((c) => this.isEligible(user, c));
  }

  private async eligibleUserIds(orgId: string, category: NotificationCategory): Promise<string[]> {
    const users = await this.prisma.user.findMany({
      where: { orgId, active: true },
      select: { id: true, role: true, leadGenAccess: true, emailHubAccess: true, socialMediaAccess: true, isPrimaryAdmin: true },
    });
    return users.filter((u) => this.isEligible(u, category)).map((u) => u.id);
  }

  /** Reads through UserAccessCacheService (Part: performance audit,
   *  2026-09-02) instead of its own fresh `prisma.user.findUnique` — this
   *  used to run on every list()/unreadCount()/applyToVisible() call, so
   *  opening the notification panel or switching a tab each paid a full DB
   *  round trip just to re-read data that barely ever changes. */
  private async requestingUser(user: JwtClaims): Promise<EligibilityUser> {
    const record = await this.userAccess.get(user.sub);
    if (!record) throw new Error(`User ${user.sub} not found`);
    return record;
  }

  async list(
    user: JwtClaims,
    options: { category?: NotificationCategory; unreadOnly?: boolean; page?: number; pageSize?: number } = {},
  ) {
    const page = options.page ?? 1;
    const pageSize = Math.min(Math.max(options.pageSize ?? 30, 1), 100);

    const dbUser = await this.requestingUser(user);
    const eligible = this.eligibleCategories(dbUser);
    // A category the caller isn't eligible for yields an empty result, not
    // an error or someone else's data — the same rule used for delivery.
    const categories = options.category ? eligible.filter((c) => c === options.category) : eligible;

    const where: Prisma.NotificationWhereInput = {
      orgId: user.orgId,
      category: { in: categories },
      AND: [
        { userStates: { none: { userId: user.sub, dismissedAt: { not: null } } } },
        ...(options.unreadOnly ? [{ userStates: { none: { userId: user.sub, readAt: { not: null } } } }] : []),
      ],
    };

    const [rows, total] = await Promise.all([
      this.prisma.notification.findMany({
        where,
        include: { userStates: { where: { userId: user.sub } } },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.notification.count({ where }),
    ]);

    const items = rows.map(({ userStates, ...notification }) => ({
      ...notification,
      read: userStates.some((s) => s.readAt != null),
    }));
    return { items, total, page, pageSize };
  }

  /** Drives the bell badge (total) and per-category tab counts. */
  async unreadCount(user: JwtClaims): Promise<{ total: number; byCategory: Partial<Record<NotificationCategory, number>> }> {
    const dbUser = await this.requestingUser(user);
    const categories = this.eligibleCategories(dbUser);
    const rows = await this.prisma.notification.groupBy({
      by: ["category"],
      where: {
        orgId: user.orgId,
        category: { in: categories },
        userStates: { none: { userId: user.sub, OR: [{ readAt: { not: null } }, { dismissedAt: { not: null } }] } },
      },
      _count: { _all: true },
    });
    const byCategory: Partial<Record<NotificationCategory, number>> = {};
    let total = 0;
    for (const r of rows) {
      byCategory[r.category] = r._count._all;
      total += r._count._all;
    }
    return { total, byCategory };
  }

  async markRead(user: JwtClaims, id: string) {
    const notification = await this.prisma.notification.findFirst({ where: { id, orgId: user.orgId } });
    if (!notification) return { updated: false };
    const now = new Date();
    await this.prisma.notificationUserState.upsert({
      where: { notificationId_userId: { notificationId: id, userId: user.sub } },
      create: { notificationId: id, userId: user.sub, readAt: now },
      update: { readAt: now },
    });
    this.realtime.emitToUser(user.sub, "notification.userStateChanged", { ids: [id], readAt: now.toISOString() });
    return { updated: true };
  }

  async markAllRead(user: JwtClaims, category?: NotificationCategory) {
    return this.applyToVisible(user, category, "readAt");
  }

  async dismiss(user: JwtClaims, id: string) {
    const notification = await this.prisma.notification.findFirst({ where: { id, orgId: user.orgId } });
    if (!notification) return { updated: false };
    const now = new Date();
    await this.prisma.notificationUserState.upsert({
      where: { notificationId_userId: { notificationId: id, userId: user.sub } },
      create: { notificationId: id, userId: user.sub, dismissedAt: now },
      update: { dismissedAt: now },
    });
    this.realtime.emitToUser(user.sub, "notification.userStateChanged", { ids: [id], dismissedAt: now.toISOString() });
    return { updated: true };
  }

  async dismissAll(user: JwtClaims, category?: NotificationCategory) {
    return this.applyToVisible(user, category, "dismissedAt");
  }

  /** Shared by markAllRead/dismissAll: finds every notification currently
   *  visible-and-unresolved for this user (in the given category, or every
   *  eligible category) and upserts the requested timestamp field onto
   *  their NotificationUserState row — never touching any other user's. */
  private async applyToVisible(user: JwtClaims, category: NotificationCategory | undefined, field: "readAt" | "dismissedAt") {
    const dbUser = await this.requestingUser(user);
    const eligible = this.eligibleCategories(dbUser);
    const categories = category ? eligible.filter((c) => c === category) : eligible;

    const targets = await this.prisma.notification.findMany({
      where: {
        orgId: user.orgId,
        category: { in: categories },
        userStates: { none: { userId: user.sub, [field]: { not: null } } },
      },
      select: { id: true },
    });
    if (targets.length === 0) return { updated: 0 };

    const now = new Date();
    await this.prisma.$transaction(
      targets.map((t) =>
        this.prisma.notificationUserState.upsert({
          where: { notificationId_userId: { notificationId: t.id, userId: user.sub } },
          create: { notificationId: t.id, userId: user.sub, [field]: now },
          update: { [field]: now },
        }),
      ),
    );
    this.realtime.emitToUser(user.sub, "notification.userStateChanged", {
      ids: targets.map((t) => t.id),
      [field]: now.toISOString(),
    });
    return { updated: targets.length };
  }

  /** Created lazily on first read (see NotificationPreference's schema
   *  docblock) rather than at signup — every existing user gets sane
   *  defaults without a backfill migration the day this shipped. */
  async getPreferences(userId: string) {
    const existing = await this.prisma.notificationPreference.findUnique({ where: { userId } });
    if (existing) return existing;
    return this.prisma.notificationPreference.create({ data: { userId } });
  }

  async updatePreferences(
    userId: string,
    patch: Partial<{
      inAppEnabled: boolean;
      desktopEnabled: boolean;
      soundEnabled: boolean;
      soundTone: string;
      emailEnabled: boolean;
      leadsEnabled: boolean;
      agentsEnabled: boolean;
      automationsEnabled: boolean;
      socialEnabled: boolean;
      systemEnabled: boolean;
    }>,
  ) {
    return this.prisma.notificationPreference.upsert({
      where: { userId },
      create: { userId, ...patch },
      update: patch,
    });
  }
}
