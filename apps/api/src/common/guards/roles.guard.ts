import { CanActivate, ExecutionContext, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { Role, JwtClaims } from "@leadgen/types";
import { ROLES_KEY } from "../decorators/roles.decorator";
import { UserAccessCacheService } from "../access/user-access-cache.service";
import { PermissionDenialLogger } from "./permission-denial-logger.service";

/**
 * Server-side RBAC enforcement (Part E4). Runs after JwtAuthGuard so request.user
 * is already populated. A route with no @Roles() metadata is allowed for any
 * authenticated user — role restriction is opt-in per route, not implicit.
 *
 * Checks the role through `UserAccessCacheService` (Part: role-change
 * staleness fix, 2026-10-23, explicit bug report — an admin demoted a user
 * back to manager and they still had full admin access) rather than
 * `request.user.role` straight off the JWT. The JWT's role claim is baked
 * in at login/refresh time and nothing revokes an outstanding access token
 * on a role change, so a user demoted mid-session kept their old token's
 * ADMIN claim — and every @Roles()-gated route in the app trusted it as
 * current — for up to JWT_ACCESS_TTL (15m by default) until their next
 * silent refresh happened to reissue a corrected one. PrimaryAdminGuard and
 * ModuleAccessGuard's per-module flags already read through this same
 * cache for exactly this reason; this guard was the one holdout still
 * trusting the stale claim directly.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    private readonly userAccess: UserAccessCacheService,
    private readonly denialLogger: PermissionDenialLogger,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredRoles = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }
    const request = context.switchToHttp().getRequest();
    const user: JwtClaims | undefined = request.user;
    if (!user) {
      return false;
    }
    const record = await this.userAccess.get(user.sub);
    // Prisma's generated Role and @leadgen/types' Role are structurally
    // identical string enums from the same schema values but nominally
    // distinct types — same cast auth.service.ts already uses when it
    // builds JwtClaims from a Prisma user row.
    const currentRole = (record?.role as Role | undefined) ?? user.role;
    const allowed = requiredRoles.includes(currentRole);
    if (!allowed) {
      this.denialLogger.log(user, `requires role ${requiredRoles.join("/")}, has ${currentRole}`, request.route?.path ?? request.url);
    }
    return allowed;
  }
}
