import { CanActivate, ExecutionContext, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { Role, JwtClaims } from "@leadgen/types";
import { ROLES_KEY } from "../decorators/roles.decorator";
import { PermissionDenialLogger } from "./permission-denial-logger.service";

/**
 * Server-side RBAC enforcement (Part E4). Runs after JwtAuthGuard so request.user
 * is already populated. A route with no @Roles() metadata is allowed for any
 * authenticated user — role restriction is opt-in per route, not implicit.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    private readonly denialLogger: PermissionDenialLogger,
  ) {}

  canActivate(context: ExecutionContext): boolean {
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
    const allowed = requiredRoles.includes(user.role);
    if (!allowed) {
      this.denialLogger.log(user, `requires role ${requiredRoles.join("/")}, has ${user.role}`, request.route?.path ?? request.url);
    }
    return allowed;
  }
}
