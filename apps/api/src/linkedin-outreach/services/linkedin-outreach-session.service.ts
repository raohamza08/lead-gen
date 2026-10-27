import { ConflictException, Injectable, Logger, OnModuleInit } from "@nestjs/common";
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
 * Owns the one persistent, server-side Chromium browser per org that stays
 * logged into the company's shared LinkedIn profile (Part: LinkedIn
 * Outreach, shared-session shift handoff — explicit user request: three
 * office shifts, one person at a time, log in once instead of every shift
 * re-authenticating).
 *
 * Deliberately NOT eager on module init, unlike WhatsAppQrSessionManagerService's
 * auto-resume-everything — a deploy restart should not spin up a resident
 * Chromium on its own; it launches lazily on the first claim() after a
 * restart/idle-close. Login survives both because the browser context is
 * launched via `launchPersistentContext` against an on-disk profile
 * directory (LINKEDIN_SESSION_DIR), never wiped by closing the process —
 * exactly like never signing out of a real saved Chrome profile. Nothing in
 * this file stores, autofills, or logs the LinkedIn password: the only path
 * credentials ever take is live keystrokes a real person types through
 * handleInput() during the first login, forwarded straight to the page via
 * CDP, same as remotely driving a browser.
 *
 * One claim at a time per org, by design (one shift worker on duty) — see
 * claim()/takeover(). The resident browser is closed (not the on-disk
 * profile) after an idle period with nobody holding it, trading a ~2-5s
 * relaunch cost against this app's documented 2GB-RAM VPS ceiling.
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
   *  via a DTO that would otherwise exist for no other caller. */
  onModuleInit(): void {
    this.realtime.registerHandler("linkedinSession.input", (_client, claims, payload) => {
      if (!payload || typeof payload !== "object") return;
      const event = payload as Record<string, unknown>;
      const { type } = event;
      if (type === "mouseMove" || type === "mousePressed" || type === "mouseReleased") {
        if (typeof event.x !== "number" || typeof event.y !== "number") return;
        const button = event.button === "right" || event.button === "middle" ? event.button : "left";
        this.handleInput(claims.orgId, claims.sub, { type, x: event.x, y: event.y, button }).catch(() => undefined);
      } else if (type === "keyDown" || type === "keyUp") {
        if (typeof event.key !== "string" || typeof event.code !== "string") return;
        this.handleInput(claims.orgId, claims.sub, { type, key: event.key, code: event.code }).catch(() => undefined);
      } else if (type === "insertText") {
        if (typeof event.text !== "string") return;
        this.handleInput(claims.orgId, claims.sub, { type, text: event.text }).catch(() => undefined);
      }
    });
  }

  private userDataDir(orgId: string): string {
    const root = process.env.LINKEDIN_SESSION_DIR || path.join(process.cwd(), "storage", "linkedin-sessions");
    return path.join(root, orgId);
  }

  private idleTimeoutMs(): number {
    const raw = Number(process.env.LINKEDIN_SESSION_IDLE_TIMEOUT_MS);
    return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_IDLE_TIMEOUT_MS;
  }

  /** Launches (or confirms already-launched) the persistent context for this
   *  org — a no-op if a browser is already resident. */
  private async ensureResident(orgId: string): Promise<Page> {
    const existing = this.pages.get(orgId);
    if (existing && !existing.isClosed()) return existing;

    const context = await chromium.launchPersistentContext(this.userDataDir(orgId), {
      headless: true,
      viewport: VIEWPORT,
      userAgent: REAL_CHROME_UA,
    });
    this.contexts.set(orgId, context);

    const page = context.pages()[0] ?? (await context.newPage());
    this.pages.set(orgId, page);
    // A crashed/closed page (e.g. renderer OOM) must not leave this service
    // thinking a browser is still resident for this org — the next claim()
    // should relaunch cleanly rather than handing back a dead page.
    page.once("close", () => {
      this.pages.delete(orgId);
      this.cdpSessions.delete(orgId);
    });

    const url = page.url();
    if (!url || url === "about:blank") {
      await page.goto("https://www.linkedin.com/feed/", { waitUntil: "domcontentloaded" }).catch(() => undefined);
    }
    return page;
  }

  private clearIdleTimer(orgId: string): void {
    const timer = this.idleTimers.get(orgId);
    if (timer) {
      clearTimeout(timer);
      this.idleTimers.delete(orgId);
    }
  }

  /** Starts the countdown to free this org's resident Chromium once nobody
   *  holds a claim — does NOT touch the on-disk profile, so the next claim
   *  relaunches still logged in. */
  private scheduleIdleClose(orgId: string): void {
    this.clearIdleTimer(orgId);
    const timer = setTimeout(() => {
      this.closeResident(orgId).catch((err) =>
        this.logger.warn(`Failed to idle-close LinkedIn session for org ${orgId}: ${(err as Error).message}`),
      );
    }, this.idleTimeoutMs());
    this.idleTimers.set(orgId, timer);
  }

  private async closeResident(orgId: string): Promise<void> {
    this.idleTimers.delete(orgId);
    const context = this.contexts.get(orgId);
    this.contexts.delete(orgId);
    this.pages.delete(orgId);
    this.cdpSessions.delete(orgId);
    if (context) await context.close().catch(() => undefined);
  }

  private async detectStatus(page: Page): Promise<"ACTIVE" | "AWAITING_LOGIN"> {
    const url = page.url();
    if (/linkedin\.com\/(login|checkpoint|uas)/i.test(url)) return "AWAITING_LOGIN";
    return "ACTIVE";
  }

  private async persistStatus(orgId: string, status: "ACTIVE" | "AWAITING_LOGIN", holder?: Holder): Promise<void> {
    await this.prisma.linkedinOutreachSession
      .upsert({
        where: { orgId },
        update: {
          status,
          lastHolderUserId: holder?.userId,
          lastHolderName: holder?.userName,
          lastActiveAt: new Date(),
        },
        create: {
          orgId,
          status,
          lastHolderUserId: holder?.userId,
          lastHolderName: holder?.userName,
          lastActiveAt: new Date(),
        },
      })
      .catch((err) => this.logger.warn(`Failed to persist LinkedIn session status for org ${orgId}: ${(err as Error).message}`));
  }

  private async startScreencast(orgId: string, page: Page): Promise<void> {
    let cdp = this.cdpSessions.get(orgId);
    if (!cdp) {
      cdp = await page.context().newCDPSession(page);
      this.cdpSessions.set(orgId, cdp);
      cdp.on("Page.screencastFrame", (frame: { data: string; sessionId: number; metadata: unknown }) => {
        const now = Date.now();
        const last = this.lastFrameAt.get(orgId) ?? 0;
        // Ack every frame regardless (Chrome pauses the stream until acked),
        // but only forward frames to the socket at the throttled rate above.
        cdp!.send("Page.screencastFrameAck", { sessionId: frame.sessionId }).catch(() => undefined);
        if (now - last < MIN_FRAME_INTERVAL_MS) return;
        this.lastFrameAt.set(orgId, now);
        this.realtime.emitToOrg(orgId, "linkedinSession.frame", { data: frame.data });
      });
    }
    await cdp.send("Page.startScreencast", { format: "jpeg", quality: 60, maxWidth: VIEWPORT.width, maxHeight: VIEWPORT.height });
  }

  private async stopScreencast(orgId: string): Promise<void> {
    const cdp = this.cdpSessions.get(orgId);
    if (cdp) await cdp.send("Page.stopScreencast").catch(() => undefined);
  }

  /** `user` carries only what JwtClaims has (sub/orgId/role/email) — the
   *  holder's display name is looked up once here rather than widened onto
   *  JwtClaims app-wide for this one feature. */
  private async resolveUserName(userId: string): Promise<string> {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { name: true } });
    return user?.name ?? "Someone";
  }

  async getStatus(orgId: string) {
    const row = await this.prisma.linkedinOutreachSession.findUnique({ where: { orgId } });
    const holder = this.holders.get(orgId);
    return {
      status: row?.status ?? "LOGGED_OUT",
      isResident: this.pages.has(orgId),
      holder: holder ? { userId: holder.userId, userName: holder.userName, claimedAt: holder.claimedAt } : null,
      lastHolderName: row?.lastHolderName ?? null,
      lastActiveAt: row?.lastActiveAt ?? null,
    };
  }

  async claim(orgId: string, userId: string, opts: { force?: boolean } = {}) {
    const existingHolder = this.holders.get(orgId);
    if (existingHolder && existingHolder.userId !== userId && !opts.force) {
      throw new ConflictException(
        `Currently held by ${existingHolder.userName} — use "Take over" if you need it right now.`,
      );
    }
    const isTakeover = Boolean(existingHolder && existingHolder.userId !== userId);

    const userName = await this.resolveUserName(userId);
    const page = await this.ensureResident(orgId);
    this.clearIdleTimer(orgId);
    const holder: Holder = { userId, userName, claimedAt: new Date() };
    this.holders.set(orgId, holder);
    await this.startScreencast(orgId, page);

    const status = await this.detectStatus(page);
    await this.persistStatus(orgId, status, holder);

    this.auditLog.write({
      orgId,
      actorId: userId,
      action: isTakeover ? "LINKEDIN_SESSION_TAKEOVER" : "LINKEDIN_SESSION_CLAIMED",
      entityType: "linkedin_outreach_session",
      entityId: orgId,
    });
    if (isTakeover && existingHolder) {
      this.realtime.emitToUser(existingHolder.userId, "linkedinSession.kicked", { by: userName });
    }
    this.realtime.emitToOrg(orgId, "linkedinSession.lock", { holder: { userId, userName, claimedAt: holder.claimedAt } });
    this.realtime.emitToOrg(orgId, "linkedinSession.status", { status });
    return { status, holder: { userId, userName, claimedAt: holder.claimedAt } };
  }

  async release(orgId: string, userId: string): Promise<void> {
    const holder = this.holders.get(orgId);
    if (!holder || holder.userId !== userId) return;

    await this.stopScreencast(orgId);
    this.holders.delete(orgId);
    this.auditLog.write({ orgId, actorId: userId, action: "LINKEDIN_SESSION_RELEASED", entityType: "linkedin_outreach_session", entityId: orgId });
    this.realtime.emitToOrg(orgId, "linkedinSession.lock", { holder: null });
    this.scheduleIdleClose(orgId);
  }

  /** Rejects silently (no-op) rather than throwing for a non-holder's stray
   *  input event — the frontend already won't send these unless it believes
   *  it holds the claim, so a mismatch here means a stale client, not an
   *  attack worth a loud error on every mouse-move. */
  async handleInput(
    orgId: string,
    userId: string,
    event:
      | { type: "mouseMove" | "mousePressed" | "mouseReleased"; x: number; y: number; button?: "left" | "right" | "middle" }
      | { type: "keyDown" | "keyUp"; key: string; code: string }
      | { type: "insertText"; text: string },
  ): Promise<void> {
    const holder = this.holders.get(orgId);
    if (!holder || holder.userId !== userId) return;
    const cdp = this.cdpSessions.get(orgId);
    if (!cdp) return;

    try {
      if (event.type === "mouseMove" || event.type === "mousePressed" || event.type === "mouseReleased") {
        await cdp.send("Input.dispatchMouseEvent", {
          type: event.type === "mouseMove" ? "mouseMoved" : event.type === "mousePressed" ? "mousePressed" : "mouseReleased",
          x: event.x,
          y: event.y,
          button: event.button ?? "left",
          clickCount: event.type === "mousePressed" ? 1 : undefined,
        });
      } else if (event.type === "keyDown" || event.type === "keyUp") {
        await cdp.send("Input.dispatchKeyEvent", { type: event.type, key: event.key, code: event.code });
      } else if (event.type === "insertText") {
        await cdp.send("Input.insertText", { text: event.text });
      }
    } catch (err) {
      this.logger.debug(`Dropped LinkedIn session input event for org ${orgId}: ${(err as Error).message}`);
    }
  }

  /** Primary-admin-only, destructive — wipes the on-disk profile, so the
   *  next claim starts from a genuinely fresh LinkedIn login. Mirrors
   *  WhatsAppQrSessionManagerService.logout(). */
  async logoutAndReset(orgId: string, userId: string): Promise<void> {
    await this.stopScreencast(orgId);
    this.holders.delete(orgId);
    this.clearIdleTimer(orgId);
    await this.closeResident(orgId);
    await fs.rm(this.userDataDir(orgId), { recursive: true, force: true }).catch(() => undefined);
    await this.prisma.linkedinOutreachSession
      .upsert({
        where: { orgId },
        update: { status: "LOGGED_OUT", lastHolderUserId: null, lastHolderName: null },
        create: { orgId, status: "LOGGED_OUT" },
      })
      .catch((err) => this.logger.warn(`Failed to persist LinkedIn logout for org ${orgId}: ${(err as Error).message}`));
    this.auditLog.write({ orgId, actorId: userId, action: "LINKEDIN_SESSION_LOGOUT", entityType: "linkedin_outreach_session", entityId: orgId });
    this.realtime.emitToOrg(orgId, "linkedinSession.lock", { holder: null });
    this.realtime.emitToOrg(orgId, "linkedinSession.status", { status: "LOGGED_OUT" });
  }
}
