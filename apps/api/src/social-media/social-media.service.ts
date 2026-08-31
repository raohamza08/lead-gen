import { BadRequestException, ForbiddenException, Inject, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JwtClaims, Role } from "@leadgen/types";
import { Prisma, SocialAccount, SocialAutomation, SocialPlatform, SocialPostStatus, NotificationCategory } from "@prisma/client";
import { PrismaService } from "../common/prisma/prisma.service";
import { EncryptionService } from "../common/crypto/encryption.service";
import { apiPublicUrl } from "../common/api-url";
import { dashboardUrl } from "../common/cors";
import { RealtimeGateway } from "../realtime/realtime.gateway";
import { NotificationsService } from "../notifications/notifications.service";
import { SocialProviderRegistryService } from "./providers/social-provider-registry.service";
import { XProvider } from "./providers/x.provider";
import { OAuthStateStore, PendingOAuthConnection } from "./oauth-state.store";
import { PendingAccountSelectionStore } from "./pending-account-selection.store";
import { ConnectedAccountProfile } from "./providers/social-platform-provider.interface";
import { MEDIA_STORAGE_SERVICE, MediaStorageService } from "./media/media-storage.interface";
import { mediaPublicUrl } from "./media/media-url";
import { CreateSocialAccountDto, GrantSocialAccountAccessDto, UpdateSocialAccountSettingsDto } from "./dto/social-account.dto";
import { CreatePostDto, RecurrenceRuleDto, UpdatePostDto } from "./dto/social-post.dto";
import {
  CreateContentTemplateDto,
  CreateHashtagGroupDto,
  CreateMediaFolderDto,
  UpdateContentTemplateDto,
  UpdateHashtagGroupDto,
} from "./dto/content-library.dto";
import { CreateSocialAutomationDto, UpdateSocialAutomationDto } from "./dto/social-automation.dto";

export interface ListPostsQuery {
  status?: SocialPostStatus;
  accountId?: string;
  page?: number;
  pageSize?: number;
}

const DEFAULT_PAGE_SIZE = 30;
const MAX_RECURRENCE_OCCURRENCES = 12; // a cap, not a full RRULE engine — enough to cover a typical campaign without unbounded row generation

/**
 * Backs the Social Media Management module end to end. Mirrors EmailHubService's
 * shape deliberately: `SocialAccountAccess` is checked the same way
 * EmailAccountAccess is (null = ADMIN/no restriction, otherwise an explicit
 * per-account grant — absence means no access), and every provider call goes
 * through SocialProviderRegistryService rather than a switch statement here.
 */
@Injectable()
export class SocialMediaService {
  private readonly logger = new Logger(SocialMediaService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly encryption: EncryptionService,
    private readonly realtime: RealtimeGateway,
    private readonly notifications: NotificationsService,
    private readonly registry: SocialProviderRegistryService,
    private readonly oauthState: OAuthStateStore,
    private readonly pendingSelection: PendingAccountSelectionStore,
    @Inject(MEDIA_STORAGE_SERVICE) private readonly storage: MediaStorageService,
  ) {}

  // ---------------------------------------------------------------------
  // Access control (same contract as EmailHubService)
  // ---------------------------------------------------------------------

  private async accessibleAccountIds(user: JwtClaims): Promise<string[] | null> {
    if (user.role === Role.ADMIN) return null;
    const grants = await this.prisma.socialAccountAccess.findMany({ where: { userId: user.sub }, select: { accountId: true } });
    return grants.map((g) => g.accountId);
  }

  private async assertAccountAccess(
    user: JwtClaims,
    accountId: string,
    require: "publish" | "approve" | null = null,
  ) {
    if (user.role === Role.ADMIN) return;
    const grant = await this.prisma.socialAccountAccess.findUnique({
      where: { userId_accountId: { userId: user.sub, accountId } },
    });
    if (!grant) throw new ForbiddenException("You do not have access to this account");
    if (require === "publish" && !grant.canPublish) throw new ForbiddenException("You cannot publish to this account");
    if (require === "approve" && !grant.canApprove) throw new ForbiddenException("You cannot approve posts for this account");
  }

  private async assertAccountsAccess(user: JwtClaims, accountIds: string[], require: "publish" | "approve" | null = null) {
    await Promise.all(accountIds.map((id) => this.assertAccountAccess(user, id, require)));
  }

  private async writeAudit(orgId: string, actorId: string | undefined, action: string, extra: { postId?: string; accountId?: string; diff?: unknown } = {}) {
    await this.prisma.socialAuditLog.create({
      data: { orgId, actorId, action, postId: extra.postId, accountId: extra.accountId, diff: (extra.diff as Prisma.InputJsonValue) ?? {} },
    });
  }

  // ---------------------------------------------------------------------
  // Capability registry
  // ---------------------------------------------------------------------

  getCapabilityRegistry() {
    return this.registry.capabilityRegistry();
  }

  // ---------------------------------------------------------------------
  // Accounts
  // ---------------------------------------------------------------------

  async listAccounts(user: JwtClaims) {
    const accountIds = await this.accessibleAccountIds(user);
    const accounts = await this.prisma.socialAccount.findMany({
      where: { orgId: user.orgId, ...(accountIds ? { id: { in: accountIds } } : {}) },
      orderBy: { createdAt: "asc" },
    });
    const capabilities = this.registry.capabilityRegistry();

    // Most recent publish failure per account, if any (Part: Social Media
    // Hub -- accounts overview surfaces issues, not just connected status).
    // One query across every account, first-match-per-account taken in JS,
    // rather than N+1 per-account lookups.
    const failures = await this.prisma.socialPostVersion.findMany({
      where: { accountId: { in: accounts.map((a) => a.id) }, publishError: { not: null } },
      orderBy: { lastAttemptAt: "desc" },
      select: { accountId: true, publishError: true },
    });
    const lastErrorByAccount = new Map<string, string | null>();
    for (const f of failures) {
      // f.accountId is only ever null for a version whose account was since
      // deleted -- excluded here by the `in: accounts.map(...)` filter above
      // already, this guard is just to satisfy the column's nullable type.
      if (f.accountId && !lastErrorByAccount.has(f.accountId)) lastErrorByAccount.set(f.accountId, f.publishError);
    }

    return accounts.map((a) => ({
      ...this.sanitizeAccount(a),
      capabilities: capabilities[a.platform],
      lastPublishError: lastErrorByAccount.get(a.id) ?? null,
    }));
  }

  private sanitizeAccount<T extends { accessTokenEnc: string | null; refreshTokenEnc: string | null }>(account: T) {
    const { accessTokenEnc, refreshTokenEnc, ...rest } = account;
    return { ...rest, connected: Boolean(accessTokenEnc) };
  }

  async createAccountPlaceholder(orgId: string, dto: CreateSocialAccountDto) {
    return this.prisma.socialAccount.create({
      data: { orgId, platform: dto.platform, username: dto.username, displayName: dto.displayName },
    });
  }

  async updateAccountSettings(orgId: string, id: string, dto: UpdateSocialAccountSettingsDto) {
    const existing = await this.prisma.socialAccount.findFirst({ where: { id, orgId } });
    if (!existing) throw new NotFoundException("Social account not found");
    const updated = await this.prisma.socialAccount.update({ where: { id }, data: dto });
    return this.sanitizeAccount(updated);
  }

  /** Manual retry (Part: Unified Social Media DM Monitoring) — for an
   *  account connected before subscribeWebhook existed, or one whose
   *  subscription needs redoing after a token refresh. Same call
   *  connectProfile makes automatically on a fresh connect. */
  async subscribeAccountWebhook(user: JwtClaims, id: string) {
    const account = await this.prisma.socialAccount.findFirst({ where: { id, orgId: user.orgId } });
    if (!account) throw new NotFoundException("Social account not found");
    try {
      await this.registry.for(account.platform).subscribeWebhook?.(account);
    } catch (err) {
      throw new BadRequestException((err as Error).message);
    }
    return { subscribed: true };
  }

  async disconnectAccount(user: JwtClaims, id: string) {
    const existing = await this.prisma.socialAccount.findFirst({ where: { id, orgId: user.orgId } });
    if (!existing) throw new NotFoundException("Social account not found");
    const updated = await this.prisma.socialAccount.update({
      where: { id },
      data: { status: "DISCONNECTED", accessTokenEnc: null, refreshTokenEnc: null, tokenExpiresAt: null },
    });
    await this.writeAudit(user.orgId, user.sub, "ACCOUNT_DISCONNECTED", { accountId: id });
    await this.notifications.notify(user.orgId, {
      category: NotificationCategory.SOCIAL,
      type: "SOCIAL_ACCOUNT_DISCONNECTED",
      severity: "WARNING",
      title: "Social Account Disconnected",
      message: `${existing.platform} account @${existing.username} was disconnected.`,
      entityType: "socialAccount",
      entityId: id,
      actionUrl: "/social-media/accounts",
    });
    return this.sanitizeAccount(updated);
  }

  /**
   * Permanent removal (Part: Settings > Social Accounts — distinct from
   * disconnectAccount, which keeps the row and just drops the token). Post
   * history is kept and loses its account link (SocialPostVersion.accountId
   * is nullable, SetNull on delete) — same "record survives, link doesn't"
   * contract as EmailAccountsService.remove. Conversations/messages/notes
   * and access grants cascade-delete: they're operational data scoped to
   * this specific connected account, not standalone business records.
   */
  async deleteAccount(user: JwtClaims, id: string) {
    const existing = await this.prisma.socialAccount.findFirst({ where: { id, orgId: user.orgId } });
    if (!existing) throw new NotFoundException("Social account not found");
    await this.prisma.socialAccount.delete({ where: { id } });
    await this.writeAudit(user.orgId, user.sub, "ACCOUNT_DELETED", { accountId: id, diff: { platform: existing.platform, username: existing.username } });
    return { deleted: true };
  }

  async listAccessForAccount(orgId: string, accountId: string) {
    const account = await this.prisma.socialAccount.findFirst({ where: { id: accountId, orgId } });
    if (!account) throw new NotFoundException("Social account not found");
    return this.prisma.socialAccountAccess.findMany({
      where: { accountId },
      include: { user: { select: { id: true, name: true, email: true, role: true } } },
    });
  }

  async grantAccess(orgId: string, accountId: string, dto: GrantSocialAccountAccessDto) {
    const [account, targetUser] = await Promise.all([
      this.prisma.socialAccount.findFirst({ where: { id: accountId, orgId } }),
      this.prisma.user.findFirst({ where: { id: dto.userId, orgId } }),
    ]);
    if (!account) throw new NotFoundException("Social account not found");
    if (!targetUser) throw new NotFoundException("User not found");
    return this.prisma.socialAccountAccess.upsert({
      where: { userId_accountId: { userId: dto.userId, accountId } },
      create: {
        userId: dto.userId,
        accountId,
        canView: dto.canView ?? true,
        canPublish: dto.canPublish ?? false,
        canApprove: dto.canApprove ?? false,
      },
      update: { canView: dto.canView, canPublish: dto.canPublish, canApprove: dto.canApprove },
    });
  }

  async revokeAccess(orgId: string, accountId: string, userId: string) {
    const account = await this.prisma.socialAccount.findFirst({ where: { id: accountId, orgId } });
    if (!account) throw new NotFoundException("Social account not found");
    const res = await this.prisma.socialAccountAccess.deleteMany({ where: { accountId, userId } });
    return { revoked: res.count };
  }

  // ---------------------------------------------------------------------
  // Feed & messages (Part: Social Media Hub) — no automation, no AI:
  // getConversations/getMessages are read-only, sendReply is one direct API
  // call triggered by a human clicking send in the UI, same shape as
  // EmailHubService.replyToEmail.
  // ---------------------------------------------------------------------

  private async getOwnedAccount(user: JwtClaims, accountId: string, require: "publish" | "approve" | null = null) {
    const account = await this.prisma.socialAccount.findFirst({ where: { id: accountId, orgId: user.orgId } });
    if (!account) throw new NotFoundException("Social account not found");
    await this.assertAccountAccess(user, accountId, require);
    return account;
  }

  /** Providers throw plain PlatformNotConfiguredError/Error (not an
   *  HttpException) for expected, operator-actionable states like "this
   *  platform has no messaging API" — same reasoning as initiateConnect's
   *  catch block, re-thrown as BadRequestException so the real message
   *  reaches the UI instead of AllExceptionsFilter's generic 500. */
  private asBadRequest(err: unknown): never {
    throw new BadRequestException((err as Error).message);
  }

  async getFeed(user: JwtClaims, accountId: string) {
    const account = await this.getOwnedAccount(user, accountId);
    const provider = this.registry.for(account.platform);
    try {
      const items = await provider.listFeed(account);
      const ownVersions = await this.prisma.socialPostVersion.findMany({
        where: { accountId, externalPostId: { not: null } },
        select: { externalPostId: true },
      });
      const ownPostIds = new Set(ownVersions.map((v) => v.externalPostId));
      return items.map((item) => ({ ...item, isOwnPost: ownPostIds.has(item.externalPostId) }));
    } catch (err) {
      this.asBadRequest(err);
    }
  }

  // Conversations/messages/reply moved to SocialInboxService (Part: Unified
  // Social Media DM Monitoring) -- the persisted inbox replaces this
  // module's old live-fetch-only DM tab, which is why there's no
  // getConversations/getMessages/sendReply here anymore.

  // ---------------------------------------------------------------------
  // OAuth connect flow
  // ---------------------------------------------------------------------

  private callbackRedirectUri(platform: SocialPlatform): string {
    return `${apiPublicUrl()}/social-oauth/callback/${platform}`;
  }

  async initiateConnect(user: JwtClaims, platform: SocialPlatform, accountId?: string) {
    const provider = this.registry.for(platform);
    const pkce = platform === "X" ? XProvider.generatePkce() : undefined;
    const state = this.oauthState.create({ orgId: user.orgId, userId: user.sub, platform, accountId, pkceVerifier: pkce?.verifier });
    try {
      let url = provider.getOAuthUrl(state, this.callbackRedirectUri(platform));
      if (pkce) url += `&code_challenge=${pkce.challenge}`;
      return { url };
    } catch (err) {
      // Providers throw plain PlatformNotConfiguredError/Error, not an
      // HttpException — AllExceptionsFilter deliberately collapses any
      // non-HttpException into a generic "Internal server error" so real bugs
      // never leak internals. That's correct for a genuine bug, but this is
      // an expected, operator-actionable state (Part 32's "explain the
      // platform limitation"), so it must be re-thrown as one to actually
      // reach the UI with a real message.
      throw new BadRequestException((err as Error).message);
    }
  }

  /** The upsert+audit+notify+emit block shared by every path that actually
   *  connects one account — the auto path below (exactly one match) and
   *  selectPendingAccount (an operator's manual pick from several matches). */
  private async connectProfile(
    pending: Pick<PendingOAuthConnection, "orgId" | "userId">,
    platform: SocialPlatform,
    profile: ConnectedAccountProfile,
  ) {
    const account = await this.prisma.socialAccount.upsert({
      where: { orgId_platform_username: { orgId: pending.orgId, platform, username: profile.username } },
      create: {
        orgId: pending.orgId,
        platform,
        username: profile.username,
        displayName: profile.displayName,
        profileImageUrl: profile.profileImageUrl,
        accountType: profile.accountType,
        externalAccountId: profile.externalAccountId,
        status: "CONNECTED",
        accessTokenEnc: this.encryption.encrypt(profile.accessToken),
        refreshTokenEnc: profile.refreshToken ? this.encryption.encrypt(profile.refreshToken) : undefined,
        tokenExpiresAt: profile.expiresAt,
        connectedByUserId: pending.userId,
        connectedAt: new Date(),
      },
      update: {
        displayName: profile.displayName,
        profileImageUrl: profile.profileImageUrl,
        accountType: profile.accountType,
        externalAccountId: profile.externalAccountId,
        status: "CONNECTED",
        accessTokenEnc: this.encryption.encrypt(profile.accessToken),
        refreshTokenEnc: profile.refreshToken ? this.encryption.encrypt(profile.refreshToken) : undefined,
        tokenExpiresAt: profile.expiresAt,
        connectedByUserId: pending.userId,
        connectedAt: new Date(),
      },
    });

    await this.writeAudit(pending.orgId, pending.userId, "ACCOUNT_CONNECTED", { accountId: account.id, diff: { platform, username: profile.username } });
    await this.notifications.notify(pending.orgId, {
      category: NotificationCategory.SOCIAL,
      type: "SOCIAL_ACCOUNT_CONNECTED",
      severity: "WARNING",
      title: "Social Account Connected",
      message: `${platform} account @${profile.username} connected successfully.`,
      entityType: "socialAccount",
      entityId: account.id,
      actionUrl: "/social-media/accounts",
    });
    this.realtime.emitToOrg(pending.orgId, "socialMedia.accountConnected", { accountId: account.id, platform });

    // Best-effort: a subscription failure shouldn't fail the connect itself
    // (the account is still usable, just relying on the reconciliation poll
    // worker until this succeeds) -- Part: Unified Social Media DM
    // Monitoring's webhook-primary/poll-fallback design.
    try {
      await this.registry.for(platform).subscribeWebhook?.(account);
    } catch (err) {
      this.logger.warn(`Webhook subscription failed for ${platform} account ${account.id}: ${(err as Error).message}`);
    }

    return account;
  }

  /** Called from the public OAuth callback controller — returns a frontend URL to redirect the browser to, success or failure. */
  async handleOAuthCallback(platform: SocialPlatform, code: string | undefined, state: string | undefined): Promise<string> {
    const accountsUrl = `${dashboardUrl()}/social-media/accounts`;
    if (!code || !state) return `${accountsUrl}?social_connect_error=${encodeURIComponent("Missing code/state from provider")}`;

    const pending = this.oauthState.consume(state);
    if (!pending || pending.platform !== platform) {
      return `${accountsUrl}?social_connect_error=${encodeURIComponent("This connection request expired or is invalid — please try again")}`;
    }

    try {
      const provider = this.registry.for(platform);
      const profiles = await provider.exchangeCodeForToken(code, this.callbackRedirectUri(platform), pending.pkceVerifier);

      if (profiles.length === 0) {
        return `${accountsUrl}?social_connect_error=${encodeURIComponent("No account was found to connect")}`;
      }

      // A Facebook/Instagram login can resolve to several Pages at once —
      // when it does, don't guess which one the operator meant; hand the
      // list to the picker instead (Part: multi-account OAuth picker).
      if (profiles.length > 1) {
        const pendingId = this.pendingSelection.create({ orgId: pending.orgId, userId: pending.userId, platform, profiles });
        return `${accountsUrl}?social_pending=${pendingId}`;
      }

      await this.connectProfile(pending, platform, profiles[0]);
      return `${accountsUrl}?social_connected=${platform}`;
    } catch (err) {
      this.logger.warn(`OAuth callback failed for ${platform}: ${(err as Error).message}`);
      return `${accountsUrl}?social_connect_error=${encodeURIComponent((err as Error).message.slice(0, 300))}`;
    }
  }

  /** The picker's list — access tokens never leave the backend, the UI only
   *  needs enough to render options and let the operator pick one. */
  async getPendingSelection(user: JwtClaims, pendingId: string) {
    const pending = this.pendingSelection.get(pendingId);
    if (!pending || pending.orgId !== user.orgId) throw new NotFoundException("This selection has expired — please reconnect.");
    return {
      platform: pending.platform,
      accounts: pending.profiles.map((p) => ({
        externalAccountId: p.externalAccountId,
        username: p.username,
        displayName: p.displayName,
        profileImageUrl: p.profileImageUrl,
        accountType: p.accountType,
      })),
    };
  }

  async selectPendingAccount(user: JwtClaims, pendingId: string, externalAccountId: string) {
    const pending = this.pendingSelection.get(pendingId);
    if (!pending || pending.orgId !== user.orgId) throw new NotFoundException("This selection has expired — please reconnect.");
    const profile = pending.profiles.find((p) => p.externalAccountId === externalAccountId);
    if (!profile) throw new NotFoundException("That account was not part of this selection.");
    return this.connectProfile({ orgId: pending.orgId, userId: pending.userId }, pending.platform, profile);
  }

  // ---------------------------------------------------------------------
  // Posts
  // ---------------------------------------------------------------------

  private postInclude = {
    versions: { include: { account: { select: { id: true, platform: true, username: true, displayName: true } } } },
    media: { include: { media: true } },
  } satisfies Prisma.SocialPostInclude;

  async listPosts(user: JwtClaims, query: ListPostsQuery) {
    const accountIds = await this.accessibleAccountIds(user);
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? DEFAULT_PAGE_SIZE;

    const where: Prisma.SocialPostWhereInput = {
      orgId: user.orgId,
      ...(query.status ? { status: query.status } : {}),
      ...(query.accountId ? { versions: { some: { accountId: query.accountId } } } : {}),
      ...(accountIds ? { versions: { some: { accountId: { in: accountIds } } } } : {}),
    };

    const [posts, total] = await Promise.all([
      this.prisma.socialPost.findMany({
        where,
        include: this.postInclude,
        orderBy: [{ scheduledAt: "asc" }, { createdAt: "desc" }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.socialPost.count({ where }),
    ]);
    return { posts: posts.map((p) => this.withMediaUrls(p)), total, page, pageSize };
  }

  async getPost(user: JwtClaims, id: string) {
    const post = await this.prisma.socialPost.findFirst({ where: { id, orgId: user.orgId }, include: this.postInclude });
    if (!post) throw new NotFoundException("Post not found");
    await this.assertAccountsAccess(user, post.versions.map((v) => v.accountId).filter((id): id is string => id !== null));
    return this.withMediaUrls(post);
  }

  private withMediaUrls<T extends { media: { media: { id: string } }[] }>(post: T) {
    return { ...post, media: post.media.map((m) => ({ ...m.media, url: mediaPublicUrl(m.media.id) })) };
  }

  async createPost(user: JwtClaims, dto: CreatePostDto) {
    if (dto.versions.length === 0) throw new BadRequestException("At least one target account is required");
    const accountIds = dto.versions.map((v) => v.accountId);
    await this.assertAccountsAccess(user, accountIds);

    const accounts = await this.prisma.socialAccount.findMany({ where: { id: { in: accountIds }, orgId: user.orgId } });
    if (accounts.length !== new Set(accountIds).size) throw new BadRequestException("One or more target accounts were not found");

    const status: SocialPostStatus = dto.status ?? "DRAFT";
    const post = await this.prisma.socialPost.create({
      data: {
        orgId: user.orgId,
        createdByUserId: user.sub,
        campaignId: dto.campaignId,
        status,
        scheduledAt: dto.scheduledAt ? new Date(dto.scheduledAt) : undefined,
        timezone: dto.timezone,
        recurrenceRule: dto.recurrenceRule ? (dto.recurrenceRule as unknown as Prisma.InputJsonValue) : undefined,
        versions: { create: dto.versions.map((v) => ({ accountId: v.accountId, content: v.content, hashtags: v.hashtags ?? [] })) },
        media: dto.mediaAssetIds ? { create: dto.mediaAssetIds.map((mediaId) => ({ mediaId })) } : undefined,
      },
      include: this.postInclude,
    });

    await this.writeAudit(user.orgId, user.sub, "POST_CREATED", { postId: post.id, diff: { status, accountIds } });

    if (dto.recurrenceRule && dto.scheduledAt) {
      await this.materializeRecurrence(user, post, dto.recurrenceRule, dto);
    }

    this.realtime.emitToOrg(user.orgId, "socialMedia.postCreated", { postId: post.id, status });
    return this.withMediaUrls(post);
  }

  private async materializeRecurrence(user: JwtClaims, basePost: { id: string }, rule: RecurrenceRuleDto, dto: CreatePostDto) {
    const start = new Date(dto.scheduledAt!);
    const end = rule.endDate ? new Date(rule.endDate) : undefined;
    const occurrences: Date[] = [];
    const cursor = new Date(start);

    const advance = () => {
      if (rule.frequency === "DAILY") cursor.setDate(cursor.getDate() + 1);
      else if (rule.frequency === "MONTHLY") cursor.setMonth(cursor.getMonth() + 1);
      else cursor.setDate(cursor.getDate() + 7); // WEEKLY — daysOfWeek refinement below
    };

    while (occurrences.length < MAX_RECURRENCE_OCCURRENCES) {
      advance();
      if (end && cursor > end) break;
      if (rule.frequency === "WEEKLY" && rule.daysOfWeek?.length && !rule.daysOfWeek.includes(cursor.getDay())) continue;
      occurrences.push(new Date(cursor));
    }

    for (const scheduledAt of occurrences) {
      await this.prisma.socialPost.create({
        data: {
          orgId: user.orgId,
          createdByUserId: user.sub,
          campaignId: dto.campaignId,
          status: "DRAFT",
          scheduledAt,
          timezone: dto.timezone,
          versions: { create: dto.versions.map((v) => ({ accountId: v.accountId, content: v.content, hashtags: v.hashtags ?? [] })) },
          media: dto.mediaAssetIds ? { create: dto.mediaAssetIds.map((mediaId) => ({ mediaId })) } : undefined,
        },
      });
    }
  }

  async updatePost(user: JwtClaims, id: string, dto: UpdatePostDto) {
    const post = await this.prisma.socialPost.findFirst({ where: { id, orgId: user.orgId }, include: { versions: true } });
    if (!post) throw new NotFoundException("Post not found");
    if (post.status !== "DRAFT") throw new BadRequestException("Only draft posts can be edited — unschedule or reject first");
    await this.assertAccountsAccess(user, post.versions.map((v) => v.accountId).filter((id): id is string => id !== null));

    if (dto.versions) {
      const accountIds = dto.versions.map((v) => v.accountId);
      await this.assertAccountsAccess(user, accountIds);
      await this.prisma.$transaction([
        this.prisma.socialPostVersion.deleteMany({ where: { postId: id } }),
        this.prisma.socialPostVersion.createMany({
          data: dto.versions.map((v) => ({ postId: id, accountId: v.accountId, content: v.content, hashtags: v.hashtags ?? [] })),
        }),
      ]);
    }
    if (dto.mediaAssetIds) {
      await this.prisma.$transaction([
        this.prisma.socialPostMedia.deleteMany({ where: { postId: id } }),
        this.prisma.socialPostMedia.createMany({ data: dto.mediaAssetIds.map((mediaId) => ({ postId: id, mediaId })) }),
      ]);
    }

    const updated = await this.prisma.socialPost.update({
      where: { id },
      data: {
        scheduledAt: dto.scheduledAt ? new Date(dto.scheduledAt) : undefined,
        timezone: dto.timezone,
        recurrenceRule: dto.recurrenceRule ? (dto.recurrenceRule as unknown as Prisma.InputJsonValue) : undefined,
      },
      include: this.postInclude,
    });
    return this.withMediaUrls(updated);
  }

  async submitForReview(user: JwtClaims, id: string) {
    const post = await this.getPostOr404(user.orgId, id);
    if (post.status !== "DRAFT") throw new BadRequestException(`Cannot submit a post in status ${post.status}`);
    await this.assertAccountsAccess(user, post.versions.map((v) => v.accountId).filter((id): id is string => id !== null));

    const anyApprovalRequired = await this.anyAccountRequiresApproval(post.versions.map((v) => v.accountId).filter((id): id is string => id !== null));
    const nextStatus: SocialPostStatus = anyApprovalRequired ? "PENDING_REVIEW" : "APPROVED";

    const updated = await this.prisma.socialPost.update({ where: { id }, data: { status: nextStatus }, include: this.postInclude });
    await this.writeAudit(user.orgId, user.sub, "POST_SUBMITTED", { postId: id, diff: { nextStatus } });
    this.realtime.emitToOrg(user.orgId, "socialMedia.postUpdated", { postId: id, status: nextStatus });
    if (nextStatus === "PENDING_REVIEW") {
      await this.notifications.notify(user.orgId, {
        category: NotificationCategory.SOCIAL,
        type: "SOCIAL_POST_PENDING_REVIEW",
        severity: "WARNING",
        title: "Post Awaiting Approval",
        message: "A social post is waiting for approval.",
        entityType: "socialPost",
        entityId: id,
        actionUrl: "/social-media/calendar",
      });
    }
    return this.withMediaUrls(updated);
  }

  async approve(user: JwtClaims, id: string) {
    const post = await this.getPostOr404(user.orgId, id);
    if (post.status !== "PENDING_REVIEW") throw new BadRequestException(`Cannot approve a post in status ${post.status}`);
    await this.assertAccountsAccess(user, post.versions.map((v) => v.accountId).filter((id): id is string => id !== null), "approve");

    const nextStatus: SocialPostStatus = post.scheduledAt ? "SCHEDULED" : "APPROVED";
    const updated = await this.prisma.socialPost.update({
      where: { id },
      data: { status: nextStatus, approvedByUserId: user.sub, approvedAt: new Date() },
      include: this.postInclude,
    });
    await this.writeAudit(user.orgId, user.sub, "POST_APPROVED", { postId: id, diff: { nextStatus } });
    this.realtime.emitToOrg(user.orgId, "socialMedia.postUpdated", { postId: id, status: nextStatus });
    return this.withMediaUrls(updated);
  }

  async reject(user: JwtClaims, id: string, reason: string) {
    const post = await this.getPostOr404(user.orgId, id);
    if (post.status !== "PENDING_REVIEW") throw new BadRequestException(`Cannot reject a post in status ${post.status}`);
    await this.assertAccountsAccess(user, post.versions.map((v) => v.accountId).filter((id): id is string => id !== null), "approve");

    const updated = await this.prisma.socialPost.update({
      where: { id },
      data: { status: "REJECTED", rejectionReason: reason },
      include: this.postInclude,
    });
    await this.writeAudit(user.orgId, user.sub, "POST_REJECTED", { postId: id, diff: { reason } });
    this.realtime.emitToOrg(user.orgId, "socialMedia.postUpdated", { postId: id, status: "REJECTED" });
    return this.withMediaUrls(updated);
  }

  async schedule(user: JwtClaims, id: string, scheduledAt?: string) {
    const post = await this.getPostOr404(user.orgId, id);
    if (post.status !== "APPROVED") throw new BadRequestException(`Cannot schedule a post in status ${post.status}`);
    if (!post.scheduledAt && !scheduledAt) throw new BadRequestException("scheduledAt is required");
    await this.assertAccountsAccess(user, post.versions.map((v) => v.accountId).filter((id): id is string => id !== null), "publish");

    const updated = await this.prisma.socialPost.update({
      where: { id },
      data: { status: "SCHEDULED", scheduledAt: scheduledAt ? new Date(scheduledAt) : post.scheduledAt! },
      include: this.postInclude,
    });
    await this.writeAudit(user.orgId, user.sub, "POST_SCHEDULED", { postId: id, diff: { scheduledAt: updated.scheduledAt } });
    this.realtime.emitToOrg(user.orgId, "socialMedia.postUpdated", { postId: id, status: "SCHEDULED" });
    return this.withMediaUrls(updated);
  }

  async cancelSchedule(user: JwtClaims, id: string) {
    const post = await this.getPostOr404(user.orgId, id);
    if (post.status !== "SCHEDULED") throw new BadRequestException(`Cannot unschedule a post in status ${post.status}`);
    await this.assertAccountsAccess(user, post.versions.map((v) => v.accountId).filter((id): id is string => id !== null), "publish");

    const updated = await this.prisma.socialPost.update({ where: { id }, data: { status: "APPROVED" }, include: this.postInclude });
    await this.writeAudit(user.orgId, user.sub, "POST_UNSCHEDULED", { postId: id });
    this.realtime.emitToOrg(user.orgId, "socialMedia.postUpdated", { postId: id, status: "APPROVED" });
    return this.withMediaUrls(updated);
  }

  async retryFailed(user: JwtClaims, id: string) {
    const post = await this.getPostOr404(user.orgId, id);
    if (post.status !== "FAILED") throw new BadRequestException(`Cannot retry a post in status ${post.status}`);
    await this.assertAccountsAccess(user, post.versions.map((v) => v.accountId).filter((id): id is string => id !== null), "publish");

    const updated = await this.prisma.socialPost.update({ where: { id }, data: { status: "SCHEDULED", scheduledAt: new Date() }, include: this.postInclude });
    await this.writeAudit(user.orgId, user.sub, "POST_RETRY", { postId: id });
    this.realtime.emitToOrg(user.orgId, "socialMedia.postUpdated", { postId: id, status: "SCHEDULED" });
    return this.withMediaUrls(updated);
  }

  async deletePost(user: JwtClaims, id: string) {
    const post = await this.getPostOr404(user.orgId, id);
    if (!["DRAFT", "REJECTED"].includes(post.status)) throw new BadRequestException("Only draft or rejected posts can be deleted");
    await this.assertAccountsAccess(user, post.versions.map((v) => v.accountId).filter((id): id is string => id !== null));
    await this.prisma.socialPost.delete({ where: { id } });
    await this.writeAudit(user.orgId, user.sub, "POST_DELETED", { postId: id });
    return { deleted: true };
  }

  private async getPostOr404(orgId: string, id: string) {
    const post = await this.prisma.socialPost.findFirst({ where: { id, orgId }, include: { versions: true } });
    if (!post) throw new NotFoundException("Post not found");
    return post;
  }

  private async anyAccountRequiresApproval(accountIds: string[]): Promise<boolean> {
    const count = await this.prisma.socialAccount.count({ where: { id: { in: accountIds }, approvalRequired: true } });
    return count > 0;
  }

  // ---------------------------------------------------------------------
  // AI content generation (SocialContentAgent, ai-workers)
  // ---------------------------------------------------------------------

  /**
   * Drafts or repurposes a caption via ai-workers' SocialContentAgent — same
   * synchronous fetch-with-timeout shape as CaseStudiesService.review, since
   * the caller (composer, or an automation's CREATE_DRAFT action) is waiting
   * on this one Claude CLI call. Returns null on any failure so callers can
   * fall back to leaving the field blank for a human to fill in, never a
   * silently fabricated caption.
   */
  private async generateAiContent(
    orgId: string,
    input: {
      mode: "generate" | "repurpose";
      platform: SocialPlatform;
      brief?: string;
      sourceContent?: string;
      sourcePlatform?: string;
      brandVoice?: string;
      defaultHashtags?: string[];
      defaultCta?: string;
    },
  ): Promise<{ content: string; hashtags: string[] } | null> {
    const aiWorkersUrl = this.config.get<string>("AI_WORKERS_URL", "http://localhost:8000");
    try {
      const res = await fetch(`${aiWorkersUrl}/social-content/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orgId, ...input }),
        signal: AbortSignal.timeout(90_000),
      });
      if (!res.ok) throw new Error(`worker responded ${res.status}`);
      const data = (await res.json()) as { content?: string; hashtags?: string[] };
      if (!data.content) return null;
      return { content: data.content, hashtags: data.hashtags ?? [] };
    } catch (err) {
      this.logger.error(`Social content generation failed for org ${orgId}: ${(err as Error).message}`);
      return null;
    }
  }

  /** Backs the composer's "Generate with AI" action — generates a caption without creating anything. */
  async generateContent(
    user: JwtClaims,
    input: { mode?: "generate" | "repurpose"; platform: SocialPlatform; brief?: string; sourceContent?: string; sourcePlatform?: SocialPlatform; accountId?: string },
  ) {
    let account: SocialAccount | null = null;
    if (input.accountId) {
      account = await this.prisma.socialAccount.findFirst({ where: { id: input.accountId, orgId: user.orgId } });
    }
    const result = await this.generateAiContent(user.orgId, {
      mode: input.mode ?? "generate",
      platform: input.platform,
      brief: input.brief,
      sourceContent: input.sourceContent,
      sourcePlatform: input.sourcePlatform,
      brandVoice: account?.brandVoice ?? undefined,
      defaultHashtags: account?.defaultHashtags,
      defaultCta: account?.defaultCta ?? undefined,
    });
    if (!result) throw new BadRequestException("Could not generate content — the AI service is unavailable. Try again or write it manually.");
    return result;
  }

  // ---------------------------------------------------------------------
  // Automations (NEW_LEAD trigger — the only trigger wired to something real)
  // ---------------------------------------------------------------------

  /**
   * Fired fire-and-forget from LeadsService on every lead creation path (same
   * pattern as SyncService.onLeadCreated) — never blocks lead creation, and a
   * failure here is logged to SocialAutomationRun, not thrown back at the caller.
   */
  async runAutomationsForNewLead(lead: { id: string; orgId: string; companyName: string; industry?: string | null }) {
    const automations = await this.prisma.socialAutomation.findMany({
      where: { orgId: lead.orgId, triggerType: "NEW_LEAD", active: true },
    });
    for (const automation of automations) {
      try {
        const note = await this.executeAutomation(automation, lead);
        await this.prisma.socialAutomationRun.create({
          data: { automationId: automation.id, triggerRef: lead.id, status: "OK", resultNote: note },
        });
      } catch (err) {
        await this.prisma.socialAutomationRun.create({
          data: { automationId: automation.id, triggerRef: lead.id, status: "FAILED", resultNote: (err as Error).message.slice(0, 500) },
        });
      }
    }
  }

  private async executeAutomation(
    automation: SocialAutomation,
    lead: { id: string; orgId: string; companyName: string; industry?: string | null },
  ): Promise<string> {
    const actions = (automation.actions as unknown as Array<Record<string, unknown>>) ?? [];
    const notes: string[] = [];
    for (const action of actions) {
      if (action.type === "CREATE_DRAFT") {
        const postId = await this.createDraftFromAutomation(automation, action, lead);
        notes.push(`created draft post ${postId}`);
      } else if (action.type === "NOTIFY") {
        await this.notifications.notify(automation.orgId, {
          category: NotificationCategory.SOCIAL,
          type: "SOCIAL_AUTOMATION_FIRED",
          severity: "WARNING",
          title: "Automation Fired",
          message: (action.message as string) || `Automation "${automation.name}" fired for new lead ${lead.companyName}.`,
          leadId: lead.id,
          actionUrl: `/leads/${lead.id}`,
        });
        notes.push("sent notification");
      }
    }
    return notes.join("; ") || "no actions configured";
  }

  private async createDraftFromAutomation(
    automation: SocialAutomation,
    action: Record<string, unknown>,
    lead: { id: string; orgId: string; companyName: string; industry?: string | null },
  ): Promise<string> {
    const accountIds = (action.accountIds as string[]) ?? [];
    if (accountIds.length === 0) throw new Error("CREATE_DRAFT action has no accountIds configured");
    const accounts = await this.prisma.socialAccount.findMany({ where: { id: { in: accountIds }, orgId: automation.orgId } });
    if (accounts.length === 0) throw new Error("None of the configured accounts exist");

    let content: string | null = null;
    let hashtags: string[] = [];
    if (action.templateId) {
      const template = await this.prisma.contentTemplate.findFirst({ where: { id: action.templateId as string, orgId: automation.orgId } });
      if (template) content = template.bodyTemplate.replace(/\{\{\s*companyName\s*\}\}/g, lead.companyName);
    }
    if (!content) {
      const generated = await this.generateAiContent(automation.orgId, {
        mode: "generate",
        platform: accounts[0].platform,
        brief:
          (action.brief as string) ||
          `Announce a new client relationship with ${lead.companyName}${lead.industry ? ` (${lead.industry})` : ""}. Keep it general — no specific results to cite yet.`,
        brandVoice: accounts[0].brandVoice ?? undefined,
        defaultHashtags: accounts[0].defaultHashtags,
      });
      content = generated?.content ?? `We're excited to start working with ${lead.companyName}!`;
      hashtags = generated?.hashtags ?? [];
    }

    const post = await this.prisma.socialPost.create({
      data: {
        orgId: automation.orgId,
        createdByUserId: automation.createdByUserId,
        status: "DRAFT",
        versions: { create: accounts.map((a) => ({ accountId: a.id, content: content!, hashtags: hashtags.length ? hashtags : a.defaultHashtags })) },
      },
    });
    this.realtime.emitToOrg(automation.orgId, "socialMedia.postCreated", { postId: post.id, status: "DRAFT", fromAutomation: automation.id });
    return post.id;
  }

  listAutomations(orgId: string) {
    return this.prisma.socialAutomation.findMany({ where: { orgId }, orderBy: { createdAt: "desc" } });
  }

  createAutomation(user: JwtClaims, dto: CreateSocialAutomationDto) {
    return this.prisma.socialAutomation.create({
      data: {
        orgId: user.orgId,
        name: dto.name,
        triggerType: dto.triggerType,
        actions: dto.actions as unknown as Prisma.InputJsonValue,
        conditions: (dto.conditions ?? {}) as Prisma.InputJsonValue,
        createdByUserId: user.sub,
      },
    });
  }

  async updateAutomation(orgId: string, id: string, dto: UpdateSocialAutomationDto) {
    const existing = await this.prisma.socialAutomation.findFirst({ where: { id, orgId } });
    if (!existing) throw new NotFoundException("Automation not found");
    return this.prisma.socialAutomation.update({
      where: { id },
      data: {
        name: dto.name,
        active: dto.active,
        actions: dto.actions ? (dto.actions as unknown as Prisma.InputJsonValue) : undefined,
        conditions: dto.conditions ? (dto.conditions as unknown as Prisma.InputJsonValue) : undefined,
      },
    });
  }

  async deleteAutomation(orgId: string, id: string) {
    const res = await this.prisma.socialAutomation.deleteMany({ where: { id, orgId } });
    return { deleted: res.count };
  }

  async listAutomationRuns(orgId: string, automationId: string) {
    const automation = await this.prisma.socialAutomation.findFirst({ where: { id: automationId, orgId } });
    if (!automation) throw new NotFoundException("Automation not found");
    return this.prisma.socialAutomationRun.findMany({ where: { automationId }, orderBy: { createdAt: "desc" }, take: 50 });
  }

  // ---------------------------------------------------------------------
  // Media library
  // ---------------------------------------------------------------------

  async listMedia(orgId: string, folderId?: string) {
    const assets = await this.prisma.mediaAsset.findMany({
      where: { orgId, ...(folderId ? { folderId } : {}) },
      orderBy: { createdAt: "desc" },
    });
    return assets.map((a) => ({ ...a, url: mediaPublicUrl(a.id) }));
  }

  async uploadMedia(user: JwtClaims, file: { buffer: Buffer; originalname: string; mimetype: string }, folderId?: string) {
    const saved = await this.storage.save({ buffer: file.buffer, orgId: user.orgId, filename: file.originalname });
    const asset = await this.prisma.mediaAsset.create({
      data: {
        orgId: user.orgId,
        uploadedByUserId: user.sub,
        folderId,
        filename: file.originalname,
        storageKey: saved.storageKey,
        mimeType: file.mimetype,
        sizeBytes: saved.sizeBytes,
      },
    });
    return { ...asset, url: mediaPublicUrl(asset.id) };
  }

  async deleteMedia(orgId: string, id: string) {
    const asset = await this.prisma.mediaAsset.findFirst({ where: { id, orgId } });
    if (!asset) throw new NotFoundException("Media not found");
    await this.prisma.$transaction([
      this.prisma.socialPostMedia.deleteMany({ where: { mediaId: id } }),
      this.prisma.mediaAsset.delete({ where: { id } }),
    ]);
    await this.storage.delete(asset.storageKey);
    return { deleted: true };
  }

  listFolders(orgId: string) {
    return this.prisma.mediaFolder.findMany({ where: { orgId }, orderBy: { name: "asc" } });
  }

  createFolder(orgId: string, dto: CreateMediaFolderDto) {
    return this.prisma.mediaFolder.create({ data: { orgId, name: dto.name, parentId: dto.parentId } });
  }

  // ---------------------------------------------------------------------
  // Hashtag groups & content templates
  // ---------------------------------------------------------------------

  listHashtagGroups(orgId: string) {
    return this.prisma.hashtagGroup.findMany({ where: { orgId }, orderBy: { name: "asc" } });
  }

  createHashtagGroup(orgId: string, dto: CreateHashtagGroupDto) {
    return this.prisma.hashtagGroup.create({ data: { orgId, name: dto.name, hashtags: dto.hashtags } });
  }

  async updateHashtagGroup(orgId: string, id: string, dto: UpdateHashtagGroupDto) {
    const existing = await this.prisma.hashtagGroup.findFirst({ where: { id, orgId } });
    if (!existing) throw new NotFoundException("Hashtag group not found");
    return this.prisma.hashtagGroup.update({ where: { id }, data: dto });
  }

  async deleteHashtagGroup(orgId: string, id: string) {
    const res = await this.prisma.hashtagGroup.deleteMany({ where: { id, orgId } });
    return { deleted: res.count };
  }

  listContentTemplates(orgId: string) {
    return this.prisma.contentTemplate.findMany({ where: { orgId }, orderBy: { name: "asc" } });
  }

  createContentTemplate(orgId: string, dto: CreateContentTemplateDto) {
    return this.prisma.contentTemplate.create({ data: { orgId, ...dto } });
  }

  async updateContentTemplate(orgId: string, id: string, dto: UpdateContentTemplateDto) {
    const existing = await this.prisma.contentTemplate.findFirst({ where: { id, orgId } });
    if (!existing) throw new NotFoundException("Template not found");
    return this.prisma.contentTemplate.update({ where: { id }, data: dto });
  }

  async deleteContentTemplate(orgId: string, id: string) {
    const res = await this.prisma.contentTemplate.deleteMany({ where: { id, orgId } });
    return { deleted: res.count };
  }

  // ---------------------------------------------------------------------
  // Stats
  // ---------------------------------------------------------------------

  async getStats(user: JwtClaims) {
    const accountIds = await this.accessibleAccountIds(user);
    const scope: Prisma.SocialPostWhereInput = {
      orgId: user.orgId,
      ...(accountIds ? { versions: { some: { accountId: { in: accountIds } } } } : {}),
    };

    const [connectedAccounts, draft, pendingReview, scheduled, published, failed] = await Promise.all([
      this.prisma.socialAccount.count({
        where: { orgId: user.orgId, status: "CONNECTED", ...(accountIds ? { id: { in: accountIds } } : {}) },
      }),
      this.prisma.socialPost.count({ where: { ...scope, status: "DRAFT" } }),
      this.prisma.socialPost.count({ where: { ...scope, status: "PENDING_REVIEW" } }),
      this.prisma.socialPost.count({ where: { ...scope, status: "SCHEDULED" } }),
      this.prisma.socialPost.count({ where: { ...scope, status: "PUBLISHED" } }),
      this.prisma.socialPost.count({ where: { ...scope, status: "FAILED" } }),
    ]);
    return { connectedAccounts, draft, pendingReview, scheduled, published, failed };
  }
}
