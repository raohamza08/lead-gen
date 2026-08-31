import { ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import * as bcrypt from "bcryptjs";
import { PrismaService } from "../common/prisma/prisma.service";
import { TransactionalEmailService } from "../email/transactional-email.service";
import { OrganizationService } from "../organization/organization.service";
import { dashboardUrl } from "../common/cors";
import { Role } from "@leadgen/types";
import { UpdateUserAccessDto } from "./dto/update-user-access.dto";
import { AuditLogService } from "../audit-log/audit-log.service";
import { LocalDiskMediaStorageService } from "../social-media/media/local-disk-media-storage.service";
import { apiPublicUrl } from "../common/api-url";

function credentialsEmailHtml(params: { recipientName: string; orgName: string; email: string; password: string }): string {
  const { recipientName, orgName, email, password } = params;
  const loginUrl = `${dashboardUrl()}/login`;
  return `
    <div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:480px;margin:0 auto;color:#1a1a1a">
      <h2 style="font-weight:600;margin-bottom:4px">Welcome to ${orgName}</h2>
      <p style="color:#444;line-height:1.5">Hi ${recipientName.split(" ")[0]}, an account has been created for you. Here's how to sign in:</p>
      <table style="width:100%;border-collapse:collapse;margin:20px 0">
        <tr><td style="padding:8px 0;color:#666;width:100px">Login link</td><td><a href="${loginUrl}" style="color:#2563eb">${loginUrl}</a></td></tr>
        <tr><td style="padding:8px 0;color:#666">Email</td><td>${email}</td></tr>
        <tr><td style="padding:8px 0;color:#666">Password</td><td><code style="background:#f3f4f6;padding:2px 6px;border-radius:4px">${password}</code></td></tr>
      </table>
      <p style="text-align:center;margin:28px 0">
        <a href="${loginUrl}" style="background:#2563eb;color:#fff;text-decoration:none;padding:10px 20px;border-radius:6px;font-weight:500">Sign in</a>
      </p>
      <p style="color:#888;font-size:13px;line-height:1.5">You can change this password after signing in. If you weren't expecting this account, you can ignore this email.</p>
    </div>
  `.trim();
}

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly transactionalEmail: TransactionalEmailService,
    private readonly organization: OrganizationService,
    private readonly auditLog: AuditLogService,
    private readonly mediaStorage: LocalDiskMediaStorageService,
  ) {}

  async findAllForOrg(orgId: string) {
    const users = await this.prisma.user.findMany({
      where: { orgId },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        active: true,
        createdAt: true,
        leadGenAccess: true,
        emailHubAccess: true,
        socialMediaAccess: true,
        isPrimaryAdmin: true,
        displayName: true,
        avatarStorageKey: true,
      },
      orderBy: { createdAt: "asc" },
    });
    return users.map(({ avatarStorageKey, ...u }) => ({
      ...u,
      avatarUrl: avatarStorageKey ? `${apiPublicUrl()}/users/${u.id}/avatar` : null,
    }));
  }

  async create(orgId: string, actorId: string, input: { email: string; name: string; password: string; role: Role }) {
    const passwordHash = await bcrypt.hash(input.password, 12);
    try {
      const user = await this.prisma.user.create({
        data: { orgId, email: input.email, name: input.name, passwordHash, role: input.role },
        select: { id: true, email: true, name: true, role: true, active: true, createdAt: true },
      });
      this.auditLog.write({
        orgId, actorId, action: "USER_CREATED", entityType: "user", entityId: user.id,
        metadata: { email: input.email, role: input.role },
      });

      const branding = await this.organization.getBranding(orgId);
      const credentialsEmailSent = await this.transactionalEmail.send(
        orgId,
        input.email,
        `Your ${branding.emailOrgName} account is ready`,
        credentialsEmailHtml({
          recipientName: input.name,
          orgName: branding.emailOrgName,
          email: input.email,
          password: input.password,
        }),
      );

      return { ...user, credentialsEmailSent };
    } catch (err) {
      // `email` is globally unique (Part A2), not just per-org, so this is the
      // one create path where a plain constraint violation is an expected,
      // actionable outcome rather than a bug.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        throw new ConflictException(`A user with email ${input.email} already exists`);
      }
      throw err;
    }
  }

  /**
   * `updateMany` scoped by orgId, not `update({ where: { id } })` — the
   * bare-id version let any ADMIN deactivate/promote a user in a DIFFERENT
   * org by guessing/enumerating a UUID (Part: Admin tier & audit hardening,
   * 2026-08-31 — found during a guard-coverage audit; every other id-based
   * write in this service already went through findFirst({ id, orgId })
   * first, this pair was the one place that didn't).
   */
  async setActive(orgId: string, actorId: string, id: string, active: boolean) {
    const result = await this.prisma.user.updateMany({ where: { id, orgId }, data: { active } });
    if (result.count === 0) throw new NotFoundException("User not found");
    this.auditLog.write({
      orgId, actorId, action: active ? "USER_ACTIVATED" : "USER_DEACTIVATED", entityType: "user", entityId: id,
    });
    return this.prisma.user.findUniqueOrThrow({ where: { id } });
  }

  async setRole(orgId: string, actorId: string, id: string, role: Role) {
    const result = await this.prisma.user.updateMany({ where: { id, orgId }, data: { role } });
    if (result.count === 0) throw new NotFoundException("User not found");
    this.auditLog.write({ orgId, actorId, action: "ROLE_CHANGED", entityType: "user", entityId: id, metadata: { role } });
    return this.prisma.user.findUniqueOrThrow({ where: { id } });
  }

  // ---- Person Access: module toggles + email/social account grants, read/written from one place ----

  /**
   * Everything one person can touch, in one call — module flags plus every
   * org email/social account annotated with this user's existing grant (if
   * any). Same underlying EmailAccountAccess/SocialAccountAccess rows the
   * account-centric settings pages already read, just inverted: "all
   * accounts, is this user granted" instead of "all grants for one account."
   */
  async getAccess(orgId: string, userId: string) {
    const targetUser = await this.prisma.user.findFirst({
      where: { id: userId, orgId },
      select: { id: true, role: true, leadGenAccess: true, emailHubAccess: true, socialMediaAccess: true },
    });
    if (!targetUser) throw new NotFoundException("User not found");

    const [emailAccounts, emailGrants, socialAccounts, socialGrants] = await Promise.all([
      this.prisma.emailAccount.findMany({
        where: { orgId },
        select: { id: true, address: true, mailboxLabel: true },
        orderBy: { address: "asc" },
      }),
      this.prisma.emailAccountAccess.findMany({ where: { userId } }),
      this.prisma.socialAccount.findMany({
        where: { orgId },
        select: { id: true, platform: true, username: true, displayName: true },
        orderBy: { createdAt: "asc" },
      }),
      this.prisma.socialAccountAccess.findMany({ where: { userId } }),
    ]);

    const emailGrantByAccount = new Map(emailGrants.map((g) => [g.accountId, g]));
    const socialGrantByAccount = new Map(socialGrants.map((g) => [g.accountId, g]));

    return {
      isAdmin: targetUser.role === Role.ADMIN,
      modules: {
        leadGenAccess: targetUser.leadGenAccess,
        emailHubAccess: targetUser.emailHubAccess,
        socialMediaAccess: targetUser.socialMediaAccess,
      },
      emailAccounts: emailAccounts.map((a) => {
        const grant = emailGrantByAccount.get(a.id);
        return { ...a, granted: Boolean(grant), canReply: grant?.canReply ?? true };
      }),
      socialAccounts: socialAccounts.map((a) => {
        const grant = socialGrantByAccount.get(a.id);
        return { ...a, granted: Boolean(grant), canPublish: grant?.canPublish ?? false, canApprove: grant?.canApprove ?? false };
      }),
    };
  }

  /**
   * Writes module flags and/or account grants for one person in a single
   * transaction. Account grants upsert/delete the exact same
   * EmailAccountAccess/SocialAccountAccess rows the account-centric grant
   * endpoints use, keyed on the same composite id, so both surfaces read
   * back in sync automatically — no shadow copy.
   */
  async updateAccess(orgId: string, actorId: string, userId: string, dto: UpdateUserAccessDto) {
    const targetUser = await this.prisma.user.findFirst({ where: { id: userId, orgId } });
    if (!targetUser) throw new NotFoundException("User not found");

    // An ADMIN's module access is always full (ModuleAccessGuard bypasses
    // role===ADMIN outright) — rejecting the write here rather than silently
    // no-op'ing makes that visible to whoever's editing instead of them
    // thinking they restricted an admin when nothing actually changed.
    if (dto.modules && targetUser.role === Role.ADMIN) {
      throw new ForbiddenException("Admins always have full module access — change their role first if you want to restrict them.");
    }

    await this.prisma.$transaction(async (tx) => {
      if (dto.modules) {
        await tx.user.update({ where: { id: userId }, data: dto.modules });
      }
      for (const entry of dto.emailAccounts ?? []) {
        if (entry.granted) {
          await tx.emailAccountAccess.upsert({
            where: { userId_accountId: { userId, accountId: entry.accountId } },
            create: { userId, accountId: entry.accountId, canReply: entry.canReply ?? true },
            update: { canReply: entry.canReply ?? true },
          });
        } else {
          await tx.emailAccountAccess.deleteMany({ where: { userId, accountId: entry.accountId } });
        }
      }
      for (const entry of dto.socialAccounts ?? []) {
        if (entry.granted) {
          await tx.socialAccountAccess.upsert({
            where: { userId_accountId: { userId, accountId: entry.accountId } },
            create: { userId, accountId: entry.accountId, canPublish: entry.canPublish ?? false, canApprove: entry.canApprove ?? false },
            update: { canPublish: entry.canPublish ?? false, canApprove: entry.canApprove ?? false },
          });
        } else {
          await tx.socialAccountAccess.deleteMany({ where: { userId, accountId: entry.accountId } });
        }
      }
    });

    this.auditLog.write({
      orgId, actorId, action: "PERMISSION_CHANGED", entityType: "user", entityId: userId,
      metadata: { modules: dto.modules ?? null },
    });
    return this.getAccess(orgId, userId);
  }

  /** Backs GET /users/me — every authenticated user (any role) reads their own module flags, e.g. for the sidebar. */
  async getSelf(orgId: string, userId: string) {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, orgId },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        leadGenAccess: true,
        emailHubAccess: true,
        socialMediaAccess: true,
        isPrimaryAdmin: true,
        displayName: true,
        jobTitle: true,
        phone: true,
        avatarStorageKey: true,
      },
    });
    if (!user) return null;
    const { avatarStorageKey, ...rest } = user;
    return { ...rest, avatarUrl: avatarStorageKey ? `${apiPublicUrl()}/users/${userId}/avatar` : null };
  }

  /**
   * Personal details a user manages themselves (Part: User Profile,
   * 2026-08-31) — distinct from `name` (set at account creation by an
   * admin) and from role/module access (admin-only, see updateAccess).
   */
  async updateProfile(userId: string, patch: { displayName?: string; jobTitle?: string; phone?: string }) {
    await this.prisma.user.update({ where: { id: userId }, data: patch });
    return this.getSelf((await this.prisma.user.findUniqueOrThrow({ where: { id: userId } })).orgId, userId);
  }

  /**
   * Requires the current password before allowing a change — the standard
   * "prove you're already logged in as this account" check, not just trust
   * the JWT alone (a stolen but still-valid access token shouldn't be
   * enough to lock the real owner out by changing their password).
   */
  async changePassword(userId: string, currentPassword: string, newPassword: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const currentOk = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!currentOk) {
      this.auditLog.write({
        orgId: user.orgId, actorId: userId, action: "PASSWORD_CHANGE_FAILED", entityType: "auth", result: "FAILURE",
      });
      throw new ForbiddenException("Current password is incorrect");
    }
    const passwordHash = await bcrypt.hash(newPassword, 12);
    await this.prisma.user.update({ where: { id: userId }, data: { passwordHash } });
    this.auditLog.write({ orgId: user.orgId, actorId: userId, action: "PASSWORD_CHANGED", entityType: "auth" });
    return { changed: true };
  }

  /** Replaces any existing avatar in one call — the old file is deleted only
   *  after the new one is safely written, so a mid-upload failure never
   *  leaves the user with no avatar at all. */
  async uploadAvatar(userId: string, file: { buffer: Buffer; mimetype: string; originalname: string }) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const saved = await this.mediaStorage.save({ buffer: file.buffer, orgId: user.orgId, filename: file.originalname });
    await this.prisma.user.update({
      where: { id: userId },
      data: { avatarStorageKey: saved.storageKey, avatarMimeType: file.mimetype },
    });
    if (user.avatarStorageKey) await this.mediaStorage.delete(user.avatarStorageKey);
    return this.getSelf(user.orgId, userId);
  }

  async removeAvatar(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (user.avatarStorageKey) await this.mediaStorage.delete(user.avatarStorageKey);
    await this.prisma.user.update({ where: { id: userId }, data: { avatarStorageKey: null, avatarMimeType: null } });
    return this.getSelf(user.orgId, userId);
  }

  /** Backs the public-within-the-app GET /users/:id/avatar — same "UUID id
   *  is the only access control" reasoning as MediaFileController for
   *  social assets; a profile picture isn't sensitive enough to warrant
   *  per-request org checks for every avatar rendered across the team list. */
  async getAvatarFile(userId: string): Promise<{ buffer: Buffer; mimeType: string } | null> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user?.avatarStorageKey) return null;
    const buffer = await this.mediaStorage.read(user.avatarStorageKey);
    return { buffer, mimeType: user.avatarMimeType ?? "image/png" };
  }

  /**
   * Hands the primary-admin flag to another ADMIN-role user (Part: Admin
   * tier & audit hardening, 2026-08-31). Only the current primary admin can
   * call this — enforced by PrimaryAdminGuard on the route, not re-checked
   * here — so the flag is always a deliberate, visible, auditable transfer
   * rather than something anyone could grab. Transactional: the old holder
   * loses it in the same write that grants the new one, so there's never a
   * moment with zero or two primary admins for this org.
   */
  async transferPrimaryAdmin(orgId: string, fromUserId: string, toUserId: string) {
    const target = await this.prisma.user.findFirst({ where: { id: toUserId, orgId } });
    if (!target) throw new NotFoundException("User not found");
    if (target.role !== Role.ADMIN) {
      throw new ForbiddenException("The primary admin must already hold the ADMIN role — promote them first.");
    }
    if (target.id === fromUserId) return target;

    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: fromUserId }, data: { isPrimaryAdmin: false } }),
      this.prisma.user.update({ where: { id: toUserId }, data: { isPrimaryAdmin: true } }),
    ]);
    this.auditLog.write({
      orgId, actorId: fromUserId, action: "PRIMARY_ADMIN_TRANSFERRED", entityType: "user", entityId: toUserId,
    });
    return this.prisma.user.findUniqueOrThrow({ where: { id: toUserId } });
  }
}
