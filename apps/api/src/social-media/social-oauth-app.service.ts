import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma, SocialPlatform } from "@prisma/client";
import { PrismaService } from "../common/prisma/prisma.service";
import { EncryptionService } from "../common/crypto/encryption.service";
import { CreateSocialOAuthAppDto } from "./dto/social-oauth-app.dto";

/**
 * CRUD for per-account custom OAuth app credentials (Part: per-account OAuth
 * app credentials, 2026-09-07) — an org's own Meta/LinkedIn/etc. developer
 * app, registered here once and then picked at "Connect" time instead of
 * always using the platform-wide default (env vars). `clientSecretEnc` is
 * never returned by any method here — callers only ever see clientId +
 * metadata, same "encrypted at rest, never round-tripped" rule every other
 * credential column in this codebase already follows.
 */
@Injectable()
export class SocialOAuthAppService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly encryption: EncryptionService,
  ) {}

  private select = {
    id: true,
    platform: true,
    name: true,
    clientId: true,
    createdByUserId: true,
    createdAt: true,
    _count: { select: { accounts: true } },
  } satisfies Prisma.SocialOAuthAppSelect;

  async list(orgId: string, platform?: SocialPlatform) {
    return this.prisma.socialOAuthApp.findMany({
      where: { orgId, ...(platform ? { platform } : {}) },
      select: this.select,
      orderBy: { createdAt: "desc" },
    });
  }

  async create(orgId: string, userId: string, dto: CreateSocialOAuthAppDto) {
    return this.prisma.socialOAuthApp.create({
      data: {
        orgId,
        platform: dto.platform,
        name: dto.name,
        clientId: dto.clientId,
        clientSecretEnc: this.encryption.encrypt(dto.clientSecret),
        createdByUserId: userId,
      },
      select: this.select,
    });
  }

  /** Blocked while any account still references this app rather than
   *  silently falling those accounts back to the platform default (Part:
   *  per-account OAuth app credentials) — a refresh against the wrong app's
   *  credentials fails outright on every platform that supports it, so this
   *  must be a deliberate reassignment, not an accidental one. */
  async delete(orgId: string, id: string) {
    const app = await this.prisma.socialOAuthApp.findFirst({
      where: { id, orgId },
      include: { _count: { select: { accounts: true } } },
    });
    if (!app) throw new NotFoundException("OAuth app not found");
    if (app._count.accounts > 0) {
      throw new BadRequestException(
        `${app._count.accounts} connected account(s) still use this app — disconnect or reconnect them first.`,
      );
    }
    await this.prisma.socialOAuthApp.delete({ where: { id } });
  }
}
