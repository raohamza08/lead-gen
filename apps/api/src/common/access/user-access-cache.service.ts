import { Injectable } from "@nestjs/common";
import { Role } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { CacheService } from "../cache/cache.service";

export interface UserAccessSnapshot {
  role: Role;
  active: boolean;
  leadGenAccess: boolean;
  emailHubAccess: boolean;
  socialMediaAccess: boolean;
  isPrimaryAdmin: boolean;
}

/** Same TTL as the existing analytics-summary cache (CacheService's other
 *  consumer) — one consistent short-TTL convention app-wide, not a new one
 *  invented per call site. */
const TTL_SECONDS = 20;

function cacheKey(userId: string): string {
  return `user-access:${userId}`;
}

/**
 * Single source for the role/module-access/primary-admin snapshot every
 * permission check in this app needs (Part: performance audit, 2026-09-02).
 *
 * Before this, `ModuleAccessGuard`, `PrimaryAdminGuard`, and
 * `NotificationsService.requestingUser()` each ran their own uncached
 * `prisma.user.findUnique` — independently, on nearly every authenticated
 * request — deliberately, for "instant revocation." Measured live: every DB
 * round trip from this VPS costs ~830ms (cross-region latency, see the
 * performance-audit plan), so that "instant revocation" design was paying a
 * ~830ms tax on most of the app's traffic for a property (a permission
 * change taking effect within seconds rather than truly instantly) that a
 * short cache already provides just as well once paired with explicit
 * invalidation on write (see `invalidate`, called from UsersService's four
 * mutation points) — a real permission change is invisible for at most the
 * gap between the write and its invalidation call, not up to the full TTL.
 */
@Injectable()
export class UserAccessCacheService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
  ) {}

  async get(userId: string): Promise<UserAccessSnapshot | null> {
    return this.cache.getOrSet(cacheKey(userId), TTL_SECONDS, async () => {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: {
          role: true,
          active: true,
          leadGenAccess: true,
          emailHubAccess: true,
          socialMediaAccess: true,
          isPrimaryAdmin: true,
        },
      });
      return user ?? null;
    });
  }

  async invalidate(userId: string): Promise<void> {
    await this.cache.invalidate(cacheKey(userId));
  }
}
