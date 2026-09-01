import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { JwtClaims } from "@leadgen/types";
import { UserAccessCacheService } from "../access/user-access-cache.service";
import { REQUIRES_PRIMARY_ADMIN_KEY } from "../decorators/requires-primary-admin.decorator";
import { PermissionDenialLogger } from "./permission-denial-logger.service";

/**
 * Gates System Logs and other primary-admin-only surfaces (Part: Admin
 * tier & audit hardening, 2026-08-31). Deliberately distinct from
 * RolesGuard's Role.ADMIN check — that role can already be granted to
 * several people (team-section.tsx), which is exactly why the spec asked
 * for a single authorized administrator instead. Reads through
 * `UserAccessCacheService` (Part: performance audit, 2026-09-02) rather
 * than its own fresh `prisma.user.findUnique` — isPrimaryAdmin still isn't
 * in JwtClaims (it needs to be revocable/transferable without waiting for
 * every existing token to expire), it just no longer pays a full DB round
 * trip on every request to check it; see UsersService.transferPrimaryAdmin
 * for the explicit cache invalidation on transfer.
 */
@Injectable()
export class PrimaryAdminGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly userAccess: UserAccessCacheService,
    private readonly denialLogger: PermissionDenialLogger,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<boolean | undefined>(REQUIRES_PRIMARY_ADMIN_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required) return true;

    const request = context.switchToHttp().getRequest();
    const user: JwtClaims | undefined = request.user;
    if (!user) return false;

    const record = await this.userAccess.get(user.sub);
    if (!record?.isPrimaryAdmin) {
      this.denialLogger.log(user, "not the primary admin", request.route?.path ?? request.url);
      throw new ForbiddenException("This section is restricted to the organization's primary administrator.");
    }
    return true;
  }
}
