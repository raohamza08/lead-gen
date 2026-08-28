import { Injectable, NotFoundException } from "@nestjs/common";
import { EmailAccount, Prisma } from "@prisma/client";
import { PrismaService } from "../common/prisma/prisma.service";
import { EncryptionService } from "../common/crypto/encryption.service";
import { UpsertEmailAccountDto } from "./dto/upsert-email-account.dto";
import { GmailProvider } from "./providers/gmail.provider";
import { SmtpProvider } from "./providers/smtp.provider";
import { EmailProviderService } from "./email-provider.service";

/** Never send raw credentials back to the dashboard — just whether one is set. */
function sanitize(account: EmailAccount) {
  const { oauthRefreshToken, smtpPassword, imapPasswordEnc, ...rest } = account;
  return {
    ...rest,
    oauthConfigured: Boolean(oauthRefreshToken),
    smtpConfigured: Boolean(smtpPassword),
    imapConfigured: Boolean(imapPasswordEnc),
  };
}

/**
 * Backs `GET/PATCH /settings/email-accounts` (Part E2) — mailbox rotation
 * config (daily/hourly limits, warmup, status) plus, since the Email Hub
 * addition, IMAP inbound-sync credentials. Every credential field
 * (oauthRefreshToken/smtpPassword/imapPasswordEnc) is encrypted at rest via
 * EncryptionService before it reaches Prisma — see encryptCredentials below.
 */
@Injectable()
export class EmailAccountsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly gmail: GmailProvider,
    private readonly smtp: SmtpProvider,
    private readonly encryption: EncryptionService,
    private readonly emailProvider: EmailProviderService,
  ) {}

  /** Maps the DTO's plaintext `imapPassword` onto the encrypted
   *  `imapPasswordEnc` column, and encrypts smtpPassword/oauthRefreshToken
   *  in place — the one point every credential passes through on the way
   *  into the database, on both create and update. */
  private encryptCredentials(dto: Partial<UpsertEmailAccountDto>) {
    const { imapPassword, ...rest } = dto;
    const data: Record<string, unknown> = { ...rest };
    if (imapPassword) data.imapPasswordEnc = this.encryption.encrypt(imapPassword);
    if (dto.smtpPassword) data.smtpPassword = this.encryption.encrypt(dto.smtpPassword);
    if (dto.oauthRefreshToken) data.oauthRefreshToken = this.encryption.encrypt(dto.oauthRefreshToken);
    return data;
  }

  /**
   * Sends a real test email through this mailbox.
   *
   * Actually sending, rather than just validating that credentials parse, is
   * the whole point: SMTP auth can succeed while the provider still refuses to
   * relay, and an app password can be valid but scoped wrongly. Neither shows
   * up until a message is really pushed — and finding out during a live
   * campaign means failed sends against real prospects.
   */
  async sendTest(orgId: string, id: string, toAddress: string) {
    const account = await this.prisma.emailAccount.findFirst({ where: { id, orgId } });
    if (!account) throw new NotFoundException(`Email account ${id} not found`);

    const provider = account.provider === "GMAIL" ? this.gmail : this.smtp;

    try {
      const { providerMessageId } = await provider.send(account, {
        fromAddress: account.address,
        fromName: account.displayName ?? undefined,
        toAddress,
        subject: `Test send from ${account.address}`,
        bodyHtml:
          `<p>This is a test message from your Outly OS.</p>` +
          `<p>Mailbox <strong>${account.address}</strong> (${account.provider}) can send.</p>` +
          `<p>Daily limit ${account.dailyLimit}, hourly limit ${account.hourlyLimit}.</p>`,
      });
      return { ok: true, sentTo: toAddress, providerMessageId };
    } catch (err) {
      // Returned rather than thrown: a failed test is expected during setup and
      // the operator needs the provider's own message to fix it. A 500 with a
      // generic body would hide exactly the detail that makes it actionable.
      return { ok: false, sentTo: toAddress, error: (err as Error).message.slice(0, 500) };
    }
  }

  /**
   * Deletes a mailbox. Sent messages are kept and simply lose their account
   * link — they are delivery history, and removing them would silently change
   * every open- and reply-rate figure already reported.
   */
  async remove(orgId: string, id: string) {
    const account = await this.prisma.emailAccount.findFirst({ where: { id, orgId } });
    if (!account) throw new NotFoundException(`Email account ${id} not found`);

    const messages = await this.prisma.emailMessage.count({ where: { accountId: id } });
    await this.prisma.$transaction([
      this.prisma.emailMessage.updateMany({ where: { accountId: id }, data: { accountId: null } }),
      this.prisma.emailAccount.delete({ where: { id } }),
    ]);
    return { deleted: true, messagesKept: messages };
  }

  async findAllForOrg(orgId: string) {
    const accounts = await this.prisma.emailAccount.findMany({ where: { orgId }, orderBy: { createdAt: "asc" } });
    return accounts.map(sanitize);
  }

  async create(orgId: string, dto: UpsertEmailAccountDto) {
    const created = await this.prisma.emailAccount.create({
      data: { orgId, ...this.encryptCredentials(dto) } as unknown as Prisma.EmailAccountCreateInput,
    });
    return sanitize(created);
  }

  async update(orgId: string, id: string, dto: Partial<UpsertEmailAccountDto>) {
    const existing = await this.prisma.emailAccount.findFirst({ where: { id, orgId } });
    if (!existing) throw new NotFoundException("Email account not found");
    const updated = await this.prisma.emailAccount.update({
      where: { id },
      data: this.encryptCredentials(dto),
    });
    return sanitize(updated);
  }

  // ---- Email Hub: per-user account access grants (Part: User Access & Permissions) ----

  /** Everyone with a grant for this account, for the Settings access-list UI. */
  async listAccessForAccount(orgId: string, accountId: string) {
    const account = await this.prisma.emailAccount.findFirst({ where: { id: accountId, orgId } });
    if (!account) throw new NotFoundException("Email account not found");
    return this.prisma.emailAccountAccess.findMany({
      where: { accountId },
      include: { user: { select: { id: true, name: true, email: true, role: true } } },
    });
  }

  async grantAccess(orgId: string, accountId: string, userId: string, canReply: boolean) {
    const [account, user] = await Promise.all([
      this.prisma.emailAccount.findFirst({ where: { id: accountId, orgId } }),
      this.prisma.user.findFirst({ where: { id: userId, orgId } }),
    ]);
    if (!account) throw new NotFoundException("Email account not found");
    if (!user) throw new NotFoundException("User not found");
    return this.prisma.emailAccountAccess.upsert({
      where: { userId_accountId: { userId, accountId } },
      create: { userId, accountId, canReply },
      update: { canReply },
    });
  }

  async revokeAccess(orgId: string, accountId: string, userId: string) {
    const account = await this.prisma.emailAccount.findFirst({ where: { id: accountId, orgId } });
    if (!account) throw new NotFoundException("Email account not found");
    const res = await this.prisma.emailAccountAccess.deleteMany({ where: { accountId, userId } });
    return { revoked: res.count };
  }

  /**
   * Retries every FAILED email for the org right now, one direct send attempt
   * each — the bulk counterpart to LeadsService.resendEmail, which does the
   * same thing but one message at a time from a lead's page. Exists for
   * exactly the case that follows fixing a mailbox: a bad password (or hit
   * compliance gate) can fail a whole backlog at once, and a fix on the
   * account doesn't retry any of them by itself.
   *
   * FAILED is the only eligible status for the same reason resendFailedMessage
   * restricts to it: resending an already-SENT message would email the same
   * prospect twice. Runs sequentially, not in parallel — these count against
   * the same per-mailbox daily/hourly limits EmailProviderService enforces
   * per send, so racing them would just have most of the batch lose that
   * race and fail on a limit that had room a moment earlier.
   */
  async resendAllFailed(orgId: string) {
    const failed = await this.prisma.emailMessage.findMany({
      where: { status: "FAILED", lead: { orgId } },
      select: { id: true },
    });
    let sent = 0;
    for (const message of failed) {
      const result = await this.emailProvider.sendMessageNow(message.id);
      if (result.status === "SENT") sent++;
    }
    return { attempted: failed.length, sent };
  }

  /** Mailbox health for the Sequences dashboard (Part F1) — sends today vs. daily limit. */
  async health(orgId: string) {
    const accounts = await this.prisma.emailAccount.findMany({ where: { orgId }, orderBy: { createdAt: "asc" } });
    const since = new Date();
    since.setHours(0, 0, 0, 0);

    // One grouped query instead of one count() per mailbox — each was its
    // own DB round trip before, all fired in parallel but still each paying
    // this DB's real per-query latency rather than sharing one trip.
    const sentCounts = await this.prisma.emailMessage.groupBy({
      by: ["accountId"],
      where: { accountId: { in: accounts.map((a) => a.id) }, sentAt: { gte: since } },
      _count: { _all: true },
    });
    const sentByAccount = new Map(sentCounts.map((c) => [c.accountId, c._count._all]));

    return accounts.map((account) => ({ ...sanitize(account), sentToday: sentByAccount.get(account.id) ?? 0 }));
  }

  /**
   * Read-only view for Lead Generation Settings — which mailbox(es) will
   * actually be used to send, nothing else. Full setup (credentials, IMAP,
   * the sendingEnabled switch itself) lives only in Email Hub Settings now;
   * this is deliberately not `@Roles(ADMIN)` since any Lead Gen user should
   * be able to see what will send, just not change it.
   */
  async listSendingOptions(orgId: string) {
    const accounts = await this.prisma.emailAccount.findMany({
      where: { orgId, status: "ACTIVE", sendingEnabled: true },
      select: { id: true, address: true, displayName: true, dailyLimit: true },
      orderBy: { address: "asc" },
    });
    const since = new Date();
    since.setHours(0, 0, 0, 0);

    const sentCounts = await this.prisma.emailMessage.groupBy({
      by: ["accountId"],
      where: { accountId: { in: accounts.map((a) => a.id) }, sentAt: { gte: since } },
      _count: { _all: true },
    });
    const sentByAccount = new Map(sentCounts.map((c) => [c.accountId, c._count._all]));

    return accounts.map((a) => ({ ...a, sentToday: sentByAccount.get(a.id) ?? 0 }));
  }
}
