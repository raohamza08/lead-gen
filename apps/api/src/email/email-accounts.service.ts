import { Injectable, NotFoundException } from "@nestjs/common";
import { EmailAccount } from "@prisma/client";
import { PrismaService } from "../common/prisma/prisma.service";
import { UpsertEmailAccountDto } from "./dto/upsert-email-account.dto";

/** Never send raw credentials back to the dashboard — just whether one is set. */
function sanitize(account: EmailAccount) {
  const { oauthRefreshToken, smtpPassword, ...rest } = account;
  return { ...rest, oauthConfigured: Boolean(oauthRefreshToken), smtpConfigured: Boolean(smtpPassword) };
}

/**
 * Backs `GET/PATCH /settings/email-accounts` (Part E2) — mailbox rotation
 * config (daily/hourly limits, warmup, status). Credentials (OAuth refresh
 * token / SMTP password) are accepted here for the scaffold but belong in a
 * secrets manager before this goes live (Part E4), same caveat as elsewhere.
 */
@Injectable()
export class EmailAccountsService {
  constructor(private readonly prisma: PrismaService) {}

  async findAllForOrg(orgId: string) {
    const accounts = await this.prisma.emailAccount.findMany({ where: { orgId }, orderBy: { createdAt: "asc" } });
    return accounts.map(sanitize);
  }

  async create(orgId: string, dto: UpsertEmailAccountDto) {
    const created = await this.prisma.emailAccount.create({ data: { orgId, ...dto } });
    return sanitize(created);
  }

  async update(orgId: string, id: string, dto: Partial<UpsertEmailAccountDto>) {
    const existing = await this.prisma.emailAccount.findFirst({ where: { id, orgId } });
    if (!existing) throw new NotFoundException("Email account not found");
    const updated = await this.prisma.emailAccount.update({ where: { id }, data: dto });
    return sanitize(updated);
  }

  /** Mailbox health for the Sequences dashboard (Part F1) — sends today vs. daily limit. */
  async health(orgId: string) {
    const accounts = await this.prisma.emailAccount.findMany({ where: { orgId }, orderBy: { createdAt: "asc" } });
    const since = new Date();
    since.setHours(0, 0, 0, 0);

    return Promise.all(
      accounts.map(async (account) => {
        const sentToday = await this.prisma.emailMessage.count({
          where: { accountId: account.id, sentAt: { gte: since } },
        });
        return { ...sanitize(account), sentToday };
      }),
    );
  }
}
