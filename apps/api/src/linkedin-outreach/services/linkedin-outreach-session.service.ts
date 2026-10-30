import { ConflictException, ForbiddenException, Injectable, Logger, NotFoundException, OnModuleInit } from "@nestjs/common";
import * as path from "path";
import { promises as fs } from "fs";
import { chromium, BrowserContext, Page, CDPSession } from "playwright";
import { PrismaService } from "../../common/prisma/prisma.service";
import { RealtimeGateway } from "../../realtime/realtime.gateway";
import { AuditLogService } from "../../audit-log/audit-log.service";

const REAL_CHROME_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
const VIEWPORT = { width: 1366, height: 900 };
/** Caps outgoing screencast frames to roughly this interval — Chrome's own
 *  CDP screencast is change-driven, not fixed-fps, but a fast series of
 *  mouse-move repaints could otherwise flood the single-vCPU box and every
 *  connected socket; see hetzner-vps-deployment memory's documented RAM/CPU
 *  ceiling. ~8fps is plenty for a shift worker reading/clicking a feed. */
const MIN_FRAME_INTERVAL_MS = 120;
const DEFAULT_IDLE_TIMEOUT_MS = 15 * 60 * 1000;

interface Holder {
  userId: string;
  userName: string;
  claimedAt: Date;
}

/**
 * Owns one persistent, server-side Chromium browser PER CONNECTED ACCOUNT
 * (Part: LinkedIn Outreach, shared-session shift handoff — originally one
 * shared company profile per org, extended 2026-10-30 to multiple named
 * accounts per org on explicit user request, so e.g. a company page and a
 * couple of individual sales profiles can each stay logged in side by
 * side). Every map below is keyed by accountId (LinkedinOutreachAccount.id),
 * not orgId — an org simply owns N of these rows now instead of at most one.
 *
 * Deliberately NOT eager on module init, unlike WhatsAppQrSessionManagerService's
 * auto-resume-everything — a deploy restart should not spin up resident
 * Chromium instances on its own; each account launches lazily on its first
 * claim() after a restart/idle-close. Login survives both because each
 * account's browser context is launched via `launchPersistentContext`
 * against its own on-disk profile directory (LINKEDIN_SESSION_DIR/<accountId>),
 * never wiped by closing the process — exactly like never signing out of a
 * real saved Chrome profile. Nothing in this file stores, autofills, or logs
 * any LinkedIn password: the only path credentials ever take is live
 * keystrokes a real person types through handleInput() during that
 * account's first login, forwarded straight to the page via CDP, same as
 * remotely driving a browser.
 *
 * One claim at a time PER ACCOUNT, by design (one shift worker driving any
 * given account at once) — see claim()/takeover(). Different accounts can
 * be claimed by different people simultaneously; each is its own resident
 * browser, so running several at once multiplies RAM/CPU use on this app's
 * documented 2GB-RAM VPS ceiling — the per-account idle-close (below) is the
 * only backstop against that, so don't remove it without checking headroom.
 */
@Injectable()
export class LinkedinOutreachSessionService implements OnModuleInit {
  private readonly logger = new Logger(LinkedinOutreachSessionService.name);
  private readonly contexts = new Map<string, BrowserContext>();
  private readonly pages = new Map<string, Page>();
  private readonly cdpSessions = new Map<string, CDPSession>();
  private readonly holders = new Map<string, Holder>();
  private readonly idleTimers = new Map<string, NodeJS.Timeout>();
  private readonly lastFrameAt = new Map<string, number>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeGateway,
    private readonly auditLog: AuditLogService,
  ) {}

  /** Registers the client->server side of live control on RealtimeGateway's
   *  extension point (see that gateway's own docblock) — mouse/key events
   *  forwarded from the canvas arrive here, not through a REST endpoint,
   *  since per-event HTTP overhead would be noticeable for something
   *  marketed as "remote control." Payload shape is validated by hand
   *  (socket payloads don't go through Nest's ValidationPipe) rather than
   *  via a DTO that would otherwise exist for no other caller. Every
   *  payload now carries which account it targets — see handleInput's own
   *  docblock for why no extra per-event org-ownership DB check is needed. */
  onModuleInit(): void {
    this.realtime.registerHandler("linkedinSession.input", (_client, claims, payload) => {
      if (!payload || typeof payload !== "object") return;
      const event = payload as Record<string, unknown>;
      const { type, accountId } = event;
      if (typeof accountId !== "string" || !accountId) return;
      if (type === "mouseMove" || type === "mousePressed" || type === "mouseReleased") {
        if (typeof event.x !== "number" || typeof event.y !== "number") return;
        const button = event.button === "right" || event.button === "middle" ? event.button : "left";
        this.handleInput(accountId, claims.sub, { type, x: event.x, y: event.y, button }).catch(() => undefined);
      } else if (type === "keyDown" || type === "keyUp") {
        if (typeof event.key !== "string" || typeof event.code !== "string") return;
        this.handleInput(accountId, claims.sub, { type, key: event.key, code: event.code }).catch(() => undefined);
      } else if (type === "insertText") {
        if (typeof event.text !== "string") return;
        this.handleInput(accountId, claims.sub, { type, text: event.text }).catch(() => undefined);
      }
    });
  }

  private userDataDir(accountId: string): string {
    const root = process.env.LINKEDIN_SESSION_DIR || path.join(process.cwd(), "storage", "linkedin-sessions");
    return path.join(root, accountId);
  }

  private idleTimeoutMs(): number {
    const raw = Number(process.env.LINKEDIN_SESSION_IDLE_TIMEOUT_MS);
    return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_IDLE_TIMEOUT_MS;
  }

  /** Throws if the account doesn't exist or belongs to a different org —
   *  the one DB-backed ownership check every account-scoped action goes
   *  through before touching anything in-memory or on disk. */
  private async requireAccount(orgId: string, accountId: string) {
    const account = await this.prisma.linkedinOutreachAccount.findUnique({ where: { id: accountId } });
    if (!account) throw new NotFoundException("LinkedIn account not found.");
    if (account.orgId !== orgId) throw new ForbiddenException("This LinkedIn account belongs to a different organization.");
    return account;
  }

  /** Launches (or confirms already-launched) the persistent context for this
   *  account — a no-op if a browser is already resident. */
  private async ensureResident(accountId: string): Promise<Page> {
    const existing = this.pages.get(accountId);
    if (existing && !existing.isClosed()) return existing;

    const context = await chromium.launchPersistentContext(this.userDataDir(accountId), {
      headless: true,
      viewport: VIEWPORT,
      userAgent: REAL_CHROME_UA,
    });
    this.contexts.set(accountId, context);

    const page = context.pages()[0] ?? (await context.newPage());
    this.pages.set(accountId, page);
    // A crashed/closed page (e.g. renderer OOM) must not leave this service
    // thinking a browser is still resident for this account — the next
    // claim() should relaunch cleanly rather than handing back a dead page.
    page.once("close", () => {
      this.pages.delete(accountId);
      this.cdpSessions.delete(accountId);
    });

    const url = page.url();
    if (!url || url === "about:blank") {
      await page.goto("https://www.linkedin.com/feed/", { waitUntil: "domcontentloaded" }).catch(() => undefined);
    }
    return page;
  }

  private clearIdleTimer(accountId: string): void {
    const timer = this.idleTimers.get(accountId);
    if (timer) {
      clearTimeout(timer);
      this.idleTimers.delete(accountId);
    }
  }

  /** Starts the countdown to free this account's resident Chromium once
   *  nobody holds a claim — does NOT touch the on-disk profile, so the next
   *  claim relaunches still logged in. */
  private scheduleIdleClose(accountId: string): void {
    this.clearIdleTimer(accountId);
    const timer = setTimeout(() => {
      this.closeResident(accountId).catch((err) =>
        this.logger.warn(`Failed to idle-close LinkedIn session for account ${accountId}: ${(err as Error).message}`),
      );
    }, this.idleTimeoutMs());
    this.idleTimers.set(accountId, timer);
  }

  private async closeResident(accountId: string): Promise<void> {
    this.idleTimers.delete(accountId);
    const context = this.contexts.get(accountId);
    this.contexts.delete(accountId);
    this.pages.delete(accountId);
    this.cdpSessions.delete(accountId);
    if (context) await context.close().catch(() => undefined);
  }

  private async detectStatus(page: Page): Promise<"ACTIVE" | "AWAITING_LOGIN"> {
    const url = page.url();
    if (/linkedin\.com\/(login|checkpoint|uas)/i.test(url)) return "AWAITING_LOGIN";
    return "ACTIVE";
  }

  private async persistStatus(accountId: string, status: "ACTIVE" | "AWAITING_LOGIN", holder?: Holder): Promise<void> {
    await this.prisma.linkedinOutreachAccount
      .update({
        where: { id: accountId },
        data: {
          status,
          lastHolderUserId: holder?.userId,
          lastHolderName: holder?.userName,
          lastActiveAt: new Date(),
        },
      })
      .catch((err) => this.logger.warn(`Failed to persist LinkedIn account status for ${accountId}: ${(err as Error).message}`));
  }

  private async startScreencast(accountId: string, page: Page): Promise<void> {
    let cdp = this.cdpSessions.get(accountId);
    if (!cdp) {
      cdp = await page.context().newCDPSession(page);
      this.cdpSessions.set(accountId, cdp);
      cdp.on("Page.screencastFrame", (frame: { data: string; sessionId: number; metadata: unknown }) => {
        const now = Date.now();
        const last = this.lastFrameAt.get(accountId) ?? 0;
        // Ack every frame regardless (Chrome pauses the stream until acked),
        // but only forward frames to the socket at the throttled rate above.
        cdp!.send("Page.screencastFrameAck", { sessionId: frame.sessionId }).catch(() => undefined);
        if (now - last < MIN_FRAME_INTERVAL_MS) return;
        this.lastFrameAt.set(accountId, now);
        this.emitForAccount(accountId, "linkedinSession.frame", { data: frame.data });
      });
    }
    await cdp.send("Page.startScreencast", { format: "jpeg", quality: 60, maxWidth: VIEWPORT.width, maxHeight: VIEWPORT.height });
  }

  private async stopScreencast(accountId: string): Promise<void> {
    const cdp = this.cdpSessions.get(accountId);
    if (cdp) await cdp.send("Page.stopScreencast").catch(() => undefined);
  }

  /** `user` carries only what JwtClaims has (sub/orgId/role/email) — the
   *  holder's display name is looked up once here rather than widened onto
   *  JwtClaims app-wide for this one feature. */
  private async resolveUserName(userId: string): Promise<string> {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { name: true } });
    return user?.name ?? "Someone";
  }

  /** Every realtime push for an account goes org-wide (there's no cheap
   *  per-account socket room without widening RealtimeGateway further) —
   *  the payload always carries accountId so a client only acts on it if
   *  that's the account currently being watched/driven. */
  private emitForAccount(accountId: string, event: string, payload: Record<string, unknown>): void {
    this.realtime.emitToOrg(this.accountOrgCache.get(accountId) ?? "", event, { accountId, ...payload });
  }

  // Cache of accountId -> orgId, populated whenever an account is touched —
  // lets emitForAccount target the right org room from hot paths (screencast
  // frames) without a DB round trip per frame.
  private readonly accountOrgCache = new Map<string, string>();

  async listAccounts(orgId: string) {
    const rows = await this.prisma.linkedinOutreachAccount.findMany({ where: { orgId }, orderBy: { createdAt: "asc" } });
    return rows.map((row) => {
      this.accountOrgCache.set(row.id, orgId);
      const holder = this.holders.get(row.id);
      return {
        id: row.id,
        label: row.label,
        status: row.status,
        isResident: this.pages.has(row.id),
        holder: holder ? { userId: holder.userId, userName: holder.userName, claimedAt: holder.claimedAt } : null,
        lastHolderName: row.lastHolderName,
        lastActiveAt: row.lastActiveAt,
      };
    });
  }

  async addAccount(orgId: string, userId: string, label: string) {
    const trimmed = label.trim().slice(0, 60) || "New account";
    const row = await this.prisma.linkedinOutreachAccount.create({ data: { orgId, label: trimmed, status: "LOGGED_OUT" } });
    this.accountOrgCache.set(row.id, orgId);
    this.auditLog.write({ orgId, actorId: userId, action: "LINKEDIN_ACCOUNT_ADDED", entityType: "linkedin_outreach_account", entityId: row.id });
    return { id: row.id, label: row.label, status: row.status, isResident: false, holder: null, lastHolderName: null, lastActiveAt: null };
  }

  /** Primary-admin-only, destructive — tears down the resident browser (if
   *  any), wipes its on-disk profile, and removes the account row entirely.
   *  Unlike logoutAndReset below, there's no coming back from this one
   *  short of adding the account again and logging in from scratch. */
  async removeAccount(orgId: string, accountId: string, userId: string): Promise<void> {
    await this.requireAccount(orgId, accountId);
    await this.stopScreencast(accountId);
    this.holders.delete(accountId);
    this.clearIdleTimer(accountId);
    await this.closeResident(accountId);
    await fs.rm(this.userDataDir(accountId), { recursive: true, force: true }).catch(() => undefined);
    await this.prisma.linkedinOutreachAccount.delete({ where: { id: accountId } }).catch(() => undefined);
    this.accountOrgCache.delete(accountId);
    this.auditLog.write({ orgId, actorId: userId, action: "LINKEDIN_ACCOUNT_REMOVED", entityType: "linkedin_outreach_account", entityId: accountId });
    this.realtime.emitToOrg(orgId, "linkedinSession.removed", { accountId });
  }

  async claim(orgId: string, accountId: string, userId: string, opts: { force?: boolean } = {}) {
    await this.requireAccount(orgId, accountId);
    const existingHolder = this.holders.get(accountId);
    if (existingHolder && existingHolder.userId !== userId && !opts.force) {
      throw new ConflictException(
        `Currently held by ${existingHolder.userName} — use "Take over" if you need it right now.`,
      );
    }
    const isTakeover = Boolean(existingHolder && existingHolder.userId !== userId);

    const userName = await this.resolveUserName(userId);
    const page = await this.ensureResident(accountId);
    this.clearIdleTimer(accountId);
    const holder: Holder = { userId, userName, claimedAt: new Date() };
    this.holders.set(accountId, holder);
    await this.startScreencast(accountId, page);

    const status = await this.detectStatus(page);
    await this.persistStatus(accountId, status, holder);

    this.auditLog.write({
      orgId,
      actorId: userId,
      action: isTakeover ? "LINKEDIN_SESSION_TAKEOVER" : "LINKEDIN_SESSION_CLAIMED",
      entityType: "linkedin_outreach_account",
      entityId: accountId,
    });
    if (isTakeover && existingHolder) {
      this.realtime.emitToUser(existingHolder.userId, "linkedinSession.kicked", { accountId, by: userName });
    }
    this.emitForAccount(accountId, "linkedinSession.lock", { holder: { userId, userName, claimedAt: holder.claimedAt } });
    this.emitForAccount(accountId, "linkedinSession.status", { status });
    return { status, holder: { userId, userName, claimedAt: holder.claimedAt } };
  }

  async release(orgId: string, accountId: string, userId: string): Promise<void> {
    await this.requireAccount(orgId, accountId);
    const holder = this.holders.get(accountId);
    if (!holder || holder.userId !== userId) return;

    await this.stopScreencast(accountId);
    this.holders.delete(accountId);
    this.auditLog.write({ orgId, actorId: userId, action: "LINKEDIN_SESSION_RELEASED", entityType: "linkedin_outreach_account", entityId: accountId });
    this.emitForAccount(accountId, "linkedinSession.lock", { holder: null });
    this.scheduleIdleClose(accountId);
  }

  /** Rejects silently (no-op) rather than throwing for a non-holder's stray
   *  input event — the frontend already won't send these unless it believes
   *  it holds the claim, so a mismatch here means a stale client, not an
   *  attack worth a loud error on every mouse-move. No separate org-ownership
   *  DB check here: holder.userId is only ever set by claim(), which already
   *  verified the account belongs to the claimer's org, so matching against
   *  it is sufficient without a per-event round trip. */
  async handleInput(
    accountId: string,
    userId: string,
    event:
      | { type: "mouseMove" | "mousePressed" | "mouseReleased"; x: number; y: number; button?: "left" | "right" | "middle" }
      | { type: "keyDown" | "keyUp"; key: string; code: string }
      | { type: "insertText"; text: string },
  ): Promise<void> {
    const holder = this.holders.get(accountId);
    if (!holder || holder.userId !== userId) return;
    const cdp = this.cdpSessions.get(accountId);
    if (!cdp) return;

    try {
      if (event.type === "mouseMove" || event.type === "mousePressed" || event.type === "mouseReleased") {
        await cdp.send("Input.dispatchMouseEvent", {
          type: event.type === "mouseMove" ? "mouseMoved" : event.type === "mousePressed" ? "mousePressed" : "mouseReleased",
          x: event.x,
          y: event.y,
          button: event.button ?? "left",
          // Chrome requires a non-zero clickCount on BOTH the press and the
          // release for Input.dispatchMouseEvent to synthesize an actual
          // click — omitting it on release (as this used to) left every
          // click silently not registering while the page still looked
          // interactive (Part: LinkedIn Outreach, 2026-10-30 bug fix,
          // explicit user report — "not able to click or write").
          clickCount: event.type === "mouseMove" ? undefined : 1,
        });
      } else if (event.type === "keyDown" || event.type === "keyUp") {
        await cdp.send("Input.dispatchKeyEvent", { type: event.type, key: event.key, code: event.code });
      } else if (event.type === "insertText") {
        await cdp.send("Input.insertText", { text: event.text });
      }
    } catch (err) {
      this.logger.debug(`Dropped LinkedIn session input event for account ${accountId}: ${(err as Error).message}`);
    }
  }

  /** Primary-admin-only, destructive — wipes the on-disk profile, so the
   *  next claim starts from a genuinely fresh LinkedIn login. Keeps the
   *  account row (just resets its status), unlike removeAccount above.
   *  Mirrors WhatsAppQrSessionManagerService.logout(). */
  async logoutAndReset(orgId: string, accountId: string, userId: string): Promise<void> {
    await this.requireAccount(orgId, accountId);
    await this.stopScreencast(accountId);
    this.holders.delete(accountId);
    this.clearIdleTimer(accountId);
    await this.closeResident(accountId);
    await fs.rm(this.userDataDir(accountId), { recursive: true, force: true }).catch(() => undefined);
    await this.prisma.linkedinOutreachAccount
      .update({ where: { id: accountId }, data: { status: "LOGGED_OUT", lastHolderUserId: null, lastHolderName: null } })
      .catch((err) => this.logger.warn(`Failed to persist LinkedIn logout for account ${accountId}: ${(err as Error).message}`));
    this.auditLog.write({ orgId, actorId: userId, action: "LINKEDIN_SESSION_LOGOUT", entityType: "linkedin_outreach_account", entityId: accountId });
    this.emitForAccount(accountId, "linkedinSession.lock", { holder: null });
    this.emitForAccount(accountId, "linkedinSession.status", { status: "LOGGED_OUT" });
  }
}
