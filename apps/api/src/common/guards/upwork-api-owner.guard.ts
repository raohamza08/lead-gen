import { CanActivate, ExecutionContext, ForbiddenException, Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JwtClaims } from "@leadgen/types";

/**
 * Locks the whole Upwork API integration to a single named account while it's
 * being built out (Part: Upwork API integration, 2026-10-12, explicit user
 * request — "hide it from anyone else for now... for now i will use it only").
 *
 * Deliberately NOT ModuleAccessGuard + a per-user access flag, even though
 * that's this codebase's standard pattern (see META_ADS, UPWORK_REQUESTS,
 * etc. in requires-module.decorator.ts): ModuleAccessGuard unconditionally
 * bypasses for every Role.ADMIN user, and this org has four separate ADMIN
 * accounts (confirmed via a direct DB check before writing this guard, not
 * assumed) — the standard pattern would have exposed this to all of them,
 * not just the one person who asked for it hidden. This guard instead checks
 * the signed-in email against a single configured address, independent of
 * role.
 *
 * To open this module up to teammates later: swap this guard out for
 * ModuleAccessGuard + @RequiresModule, add the matching access flag to the
 * User model (same shape as upworkRequestsAccess), and grant it per-person
 * from Settings > Team — don't just widen UPWORK_API_OWNER_EMAIL into a list,
 * that would silently skip the per-person grant screen this app's Person
 * Access system otherwise always goes through.
 */
@Injectable()
export class UpworkApiOwnerGuard implements CanActivate {
  private readonly logger = new Logger(UpworkApiOwnerGuard.name);

  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const ownerEmail = this.config.get<string>("UPWORK_API_OWNER_EMAIL");
    if (!ownerEmail) {
      // Fails closed, not open — an unset owner email must never be read as
      // "no restriction," which is the one failure mode that would defeat
      // the entire point of this guard.
      this.logger.warn("UPWORK_API_OWNER_EMAIL is not set — denying all access to the Upwork API integration.");
      throw new ForbiddenException("The Upwork API integration has no configured owner yet.");
    }

    const request = context.switchToHttp().getRequest();
    const user: JwtClaims | undefined = request.user;
    if (!user || user.email.toLowerCase() !== ownerEmail.toLowerCase()) {
      throw new ForbiddenException("This module is restricted while it's being set up.");
    }
    return true;
  }
}
