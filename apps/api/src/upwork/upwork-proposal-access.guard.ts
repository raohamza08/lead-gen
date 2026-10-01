import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from "@nestjs/common";
import { Role, JwtClaims } from "@leadgen/types";
import { UpworkProposalType } from "@prisma/client";
import { UserAccessCacheService } from "../common/access/user-access-cache.service";
import { PrismaService } from "../common/prisma/prisma.service";
import { PermissionDenialLogger } from "../common/guards/permission-denial-logger.service";

/**
 * Per-tab access within the Upwork Proposals module (Part: Upwork Requests,
 * 2026-10-01, explicit user request — "not everyone needs everything... I
 * want to hide bidding and invites for them"). UpworkController serves both
 * BIDDING and INVITE through the SAME routes (a `type` discriminator, not
 * separate paths — see UpworkProposal's own schema docblock for why), so
 * this can't be a static per-route @RequiresModule check the way
 * ModuleAccessGuard handles every other module: it has to read the type out
 * of wherever the request shape puts it.
 *
 * - POST / PATCH with `type` in the body, or GET with `type` in the query
 *   (findAll): check that exact type's flag.
 * - Routes addressing one record by `:id` with no `type` in the request
 *   (findOne/update/remove/notify-recipients) load the record to find its
 *   type.
 * - Routes with neither (picklists, stats) are shared dropdowns/reporting
 *   across both tabs — granted if the user has EITHER flag, not gated
 *   per-type at all.
 *
 * ADMIN always bypasses, same as every other access guard in this app.
 */
@Injectable()
export class UpworkProposalAccessGuard implements CanActivate {
  constructor(
    private readonly userAccess: UserAccessCacheService,
    private readonly prisma: PrismaService,
    private readonly denialLogger: PermissionDenialLogger,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const user: JwtClaims | undefined = request.user;
    if (!user) return false;
    if (user.role === Role.ADMIN) return true;

    const record = await this.userAccess.get(user.sub);
    if (!record) return false;

    const explicitType: UpworkProposalType | undefined = request.body?.type ?? request.query?.type;
    let type = explicitType;
    if (!type && request.params?.id) {
      const proposal = await this.prisma.upworkProposal.findUnique({ where: { id: request.params.id }, select: { type: true } });
      type = proposal?.type;
    }

    const granted = type
      ? type === UpworkProposalType.BIDDING
        ? record.upworkBiddingAccess
        : record.upworkInviteAccess
      : record.upworkBiddingAccess || record.upworkInviteAccess;

    if (!granted) {
      this.denialLogger.log(user, `missing upwork ${type ?? "bidding/invite"} access`, request.route?.path);
      throw new ForbiddenException("You don't have access to this — ask an admin to grant it in Settings > Team.");
    }
    return true;
  }
}
