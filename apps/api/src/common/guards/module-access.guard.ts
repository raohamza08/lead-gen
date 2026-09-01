import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { Role, JwtClaims } from "@leadgen/types";
import { UserAccessCacheService } from "../access/user-access-cache.service";
import { AccessModule, MODULE_ACCESS_KEY } from "../decorators/requires-module.decorator";
import { PermissionDenialLogger } from "./permission-denial-logger.service";

const FIELD_BY_MODULE: Record<AccessModule, "leadGenAccess" | "emailHubAccess" | "socialMediaAccess"> = {
  LEAD_GENERATION: "leadGenAccess",
  EMAIL_HUB: "emailHubAccess",
  SOCIAL_MEDIA: "socialMediaAccess",
};

/**
 * Per-person module on/off (Part: Person Access) — a coarser, orthogonal
 * layer on top of RolesGuard's per-role checks. Runs after JwtAuthGuard, same
 * as RolesGuard, and is equally opt-in: a route with no @RequiresModule()
 * metadata is unaffected.
 *
 * ADMIN always bypasses, same reasoning as EmailHubService/SocialMediaService's
 * own `if (user.role === Role.ADMIN) return null` — an admin can never be
 * locked out of a module by these flags, only UsersService.updateAccess
 * rejecting an attempt to disable them in the first place.
 *
 * Reads through `UserAccessCacheService` (Part: performance audit,
 * 2026-09-02) rather than a fresh `prisma.user.findUnique` every request —
 * a live DB round trip on nearly every request in the app was measured
 * costing ~830ms each (cross-region DB latency). Revocation is invalidated
 * immediately on write (see UsersService's four mutation points), with the
 * cache's short TTL as a fallback ceiling, not the only mechanism — not
 * "trusting the JWT" (still never in JwtClaims), just no longer paying a
 * fresh round trip for data that changes rarely.
 */
@Injectable()
export class ModuleAccessGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly userAccess: UserAccessCacheService,
    private readonly denialLogger: PermissionDenialLogger,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredModule = this.reflector.getAllAndOverride<AccessModule | undefined>(MODULE_ACCESS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!requiredModule) return true;

    const request = context.switchToHttp().getRequest();
    const user: JwtClaims | undefined = request.user;
    if (!user) return false;
    if (user.role === Role.ADMIN) return true;

    const field = FIELD_BY_MODULE[requiredModule];
    const record = await this.userAccess.get(user.sub);
    if (!record?.[field]) {
      this.denialLogger.log(user, `missing ${field}`, context.switchToHttp().getRequest().route?.path);
      throw new ForbiddenException("You don't have access to this module — ask an admin to grant it in Settings > Team.");
    }
    return true;
  }
}
