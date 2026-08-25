import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { Role, JwtClaims } from "@leadgen/types";
import { PrismaService } from "../prisma/prisma.service";
import { AccessModule, MODULE_ACCESS_KEY } from "../decorators/requires-module.decorator";

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
 * Deliberately a live DB lookup every request rather than trusting anything
 * off the JWT (which only carries `role`, not these flags) — same
 * instant-revocation reasoning as the two existing per-resource grant guards.
 */
@Injectable()
export class ModuleAccessGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
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
    const record = await this.prisma.user.findUnique({ where: { id: user.sub }, select: { [field]: true } });
    if (!record?.[field]) {
      throw new ForbiddenException("You don't have access to this module — ask an admin to grant it in Settings > Team.");
    }
    return true;
  }
}
