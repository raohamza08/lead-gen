import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { JwtClaims } from "@leadgen/types";
import { PrismaService } from "../prisma/prisma.service";
import { REQUIRES_PRIMARY_ADMIN_KEY } from "../decorators/requires-primary-admin.decorator";
import { PermissionDenialLogger } from "./permission-denial-logger.service";

/**
 * Gates System Logs and other primary-admin-only surfaces (Part: Admin
 * tier & audit hardening, 2026-08-31). Deliberately distinct from
 * RolesGuard's Role.ADMIN check — that role can already be granted to
 * several people (team-section.tsx), which is exactly why the spec asked
 * for a single authorized administrator instead. Same "live DB lookup, not
 * trusted off the JWT" pattern as ModuleAccessGuard: isPrimaryAdmin isn't in
 * JwtClaims, and shouldn't be — it needs to be revocable/transferable
 * without waiting for every existing token to expire.
 */
@Injectable()
export class PrimaryAdminGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
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

    const record = await this.prisma.user.findUnique({ where: { id: user.sub }, select: { isPrimaryAdmin: true } });
    if (!record?.isPrimaryAdmin) {
      this.denialLogger.log(user, "not the primary admin", request.route?.path ?? request.url);
      throw new ForbiddenException("This section is restricted to the organization's primary administrator.");
    }
    return true;
  }
}
