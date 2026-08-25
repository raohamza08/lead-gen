import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from "@nestjs/common";
import { EmailAccountsService } from "./email-accounts.service";
import { UpdateEmailAccountDto, UpsertEmailAccountDto } from "./dto/upsert-email-account.dto";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import { Roles } from "../common/decorators/roles.decorator";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { JwtClaims, Role } from "@leadgen/types";

/**
 * Full mailbox setup (sending config + inbound IMAP sync) — Email Hub
 * Settings only, admin-only end to end: every route here is `@Roles(ADMIN)`,
 * no view-only tier. Lead Generation never manages accounts directly — it
 * only reads which mailboxes are actually eligible to send, via the
 * unrestricted `sending-options` endpoint below.
 */
@Controller("settings/email-accounts")
@UseGuards(JwtAuthGuard, RolesGuard)
export class EmailAccountsController {
  constructor(private readonly service: EmailAccountsService) {}

  @Get()
  @Roles(Role.ADMIN)
  findAll(@CurrentUser() user: JwtClaims) {
    return this.service.findAllForOrg(user.orgId);
  }

  @Get("health")
  @Roles(Role.ADMIN)
  health(@CurrentUser() user: JwtClaims) {
    return this.service.health(user.orgId);
  }

  /**
   * The one thing Lead Generation is allowed to see about mailboxes: which
   * ones are actually eligible to send right now. No @Roles() — any
   * authenticated user with Lead Generation access reads this, same as any
   * other Lead Gen data; the full account list/credentials above stay
   * admin-only in Email Hub Settings.
   */
  @Get("sending-options")
  sendingOptions(@CurrentUser() user: JwtClaims) {
    return this.service.listSendingOptions(user.orgId);
  }

  /**
   * Safety-net cleanup for emails stuck showing QUEUED after their send job
   * already died in the queue (e.g. a mailbox's credentials went bad and
   * every retry failed) — replaces manually patching the database. See
   * EmailAccountsService.reconcileStuck for why this exists alongside the
   * worker's own automatic handling.
   */
  @Post("reconcile-stuck")
  @Roles(Role.ADMIN)
  reconcileStuck(@CurrentUser() user: JwtClaims) {
    return this.service.reconcileStuck(user.orgId);
  }

  /**
   * Re-queues every FAILED email in one click — the follow-up to fixing a
   * mailbox (e.g. a bad password): none of the backlog it caused retries on
   * its own once BullMQ has given up on it. See EmailAccountsService.resendAllFailed.
   */
  @Post("resend-all-failed")
  @Roles(Role.ADMIN)
  resendAllFailed(@CurrentUser() user: JwtClaims) {
    return this.service.resendAllFailed(user.orgId);
  }

  @Post()
  @Roles(Role.ADMIN)
  create(@CurrentUser() user: JwtClaims, @Body() dto: UpsertEmailAccountDto) {
    return this.service.create(user.orgId, dto);
  }

  @Patch(":id")
  @Roles(Role.ADMIN)
  update(@CurrentUser() user: JwtClaims, @Param("id") id: string, @Body() dto: UpdateEmailAccountDto) {
    return this.service.update(user.orgId, id, dto);
  }

  /**
   * Sends a real test email through this mailbox to the signed-in user.
   *
   * Sending for real, rather than merely checking the credentials parse, is the
   * point: SMTP auth can succeed while the provider still refuses to relay, and
   * an app password can be valid but scoped wrongly. Both only surface on an
   * actual send — and discovering them partway through a live campaign means
   * failed sends against real prospects.
   *
   * Deliberately bypasses the compliance gate: the recipient is the operator's
   * own address, so suppression lists and unsubscribe links do not apply, and
   * running the gate here would block the test for the wrong reason.
   */
  @Post(":id/test")
  @Roles(Role.ADMIN)
  sendTest(@CurrentUser() user: JwtClaims, @Param("id") id: string) {
    return this.service.sendTest(user.orgId, id, user.email);
  }

  @Delete(":id")
  @Roles(Role.ADMIN)
  remove(@CurrentUser() user: JwtClaims, @Param("id") id: string) {
    return this.service.remove(user.orgId, id);
  }

  // ---- Email Hub: per-user account access grants (Part: User Access & Permissions) ----

  @Get(":id/access")
  @Roles(Role.ADMIN)
  listAccess(@CurrentUser() user: JwtClaims, @Param("id") id: string) {
    return this.service.listAccessForAccount(user.orgId, id);
  }

  @Post(":id/access")
  @Roles(Role.ADMIN)
  grantAccess(
    @CurrentUser() user: JwtClaims,
    @Param("id") id: string,
    @Body() body: { userId: string; canReply?: boolean },
  ) {
    return this.service.grantAccess(user.orgId, id, body.userId, body.canReply ?? true);
  }

  @Delete(":id/access/:userId")
  @Roles(Role.ADMIN)
  revokeAccess(@CurrentUser() user: JwtClaims, @Param("id") id: string, @Param("userId") userId: string) {
    return this.service.revokeAccess(user.orgId, id, userId);
  }
}
