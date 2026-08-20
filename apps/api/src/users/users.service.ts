import { ConflictException, Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import * as bcrypt from "bcryptjs";
import { PrismaService } from "../common/prisma/prisma.service";
import { TransactionalEmailService } from "../email/transactional-email.service";
import { OrganizationService } from "../organization/organization.service";
import { dashboardUrl } from "../common/cors";
import { Role } from "@leadgen/types";

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
  ) {}

  findAllForOrg(orgId: string) {
    return this.prisma.user.findMany({
      where: { orgId },
      select: { id: true, email: true, name: true, role: true, active: true, createdAt: true },
      orderBy: { createdAt: "asc" },
    });
  }

  async create(orgId: string, input: { email: string; name: string; password: string; role: Role }) {
    const passwordHash = await bcrypt.hash(input.password, 12);
    try {
      const user = await this.prisma.user.create({
        data: { orgId, email: input.email, name: input.name, passwordHash, role: input.role },
        select: { id: true, email: true, name: true, role: true, active: true, createdAt: true },
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

  setActive(id: string, active: boolean) {
    return this.prisma.user.update({ where: { id }, data: { active } });
  }

  setRole(id: string, role: Role) {
    return this.prisma.user.update({ where: { id }, data: { role } });
  }
}
