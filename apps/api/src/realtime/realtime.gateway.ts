import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JwtService } from "@nestjs/jwt";
import { OnGatewayConnection, WebSocketGateway, WebSocketServer } from "@nestjs/websockets";
import { Server, Socket } from "socket.io";
import { JwtClaims } from "@leadgen/types";
import { corsOriginValidator } from "../common/cors";

/**
 * Pushes state changes to connected dashboards the instant they happen, so no
 * screen needs a manual refresh, poll, or button click to see current state.
 * Every event is scoped to the caller's org room — one org's activity never
 * reaches another's browser tab.
 *
 * Event catalogue (payloads are intentionally thin — just enough to know
 * *what* changed; listeners refetch or already hold the rest):
 *   lead.created        { leadId }
 *   extractionRun.progress { runId, filterId, status, leadsFound, leadsVerified, duplicatesSkipped, priorityMix, error? }
 *   lead.stageChanged    { leadId, stage, previousStage }
 *   lead.updated         { leadId }               — score/enrichment/review edited
 *   agentRun.started     { leadId, agent, responsibility } — before it runs
 *   agentRun.recorded    { leadId?, agent, status, notes, durationMs }
 *   email.sent           { leadId, emailMessageId }
 *   email.failed         { leadId, emailMessageId }
 *   notification.created { id, category, title, severity, message, actionUrl?, leadId? }
 *   notification.userStateChanged { ids, readAt?, dismissedAt? } — pushed to
 *     the acting user's own room so a second open tab stays in sync without polling
 *   socialInbox.messageReceived    { conversationId, socialAccountId }
 *   socialInbox.conversationUpdated { conversationId } — status/assignment changed
 */
@Injectable()
@WebSocketGateway({
  cors: { origin: corsOriginValidator, credentials: true },
})
export class RealtimeGateway implements OnGatewayConnection {
  private readonly logger = new Logger(RealtimeGateway.name);

  @WebSocketServer()
  private server!: Server;

  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Authenticated the same way the HTTP JwtStrategy is (same secret, same
   * claims shape) — but socket.io's handshake has no header pipeline for
   * Passport to hook into, so the token is verified directly here instead of
   * reusing JwtAuthGuard.
   */
  handleConnection(client: Socket): void {
    const token =
      (client.handshake.auth?.token as string | undefined) ??
      (client.handshake.query?.token as string | undefined);
    if (!token) {
      client.disconnect(true);
      return;
    }
    try {
      const claims = this.jwt.verify<JwtClaims>(token, {
        secret: this.config.get<string>("JWT_ACCESS_SECRET"),
      });
      client.join(`org:${claims.orgId}`);
      // Per-user room (Part: Notification Center, 2026-08-31) — lets a
      // notification target exactly the users eligible to see it (per their
      // module access / admin tier) instead of every socket in the org
      // receiving everything and the frontend filtering it out.
      client.join(`user:${claims.sub}`);
    } catch (err) {
      this.logger.debug(`Rejected socket connection: ${(err as Error).message}`);
      client.disconnect(true);
    }
  }

  /** The single choke point every service pushes through — callers never
   *  touch `server` directly, so a future change to room naming or transport
   *  only has one place to update. */
  emitToOrg(orgId: string, event: string, payload: unknown): void {
    this.server?.to(`org:${orgId}`).emit(event, payload);
  }

  /** Targets exactly one user's connections (all their open tabs) — used for
   *  permission-filtered notification delivery and for syncing read/dismiss
   *  state back to a user's own other open tabs. */
  emitToUser(userId: string, event: string, payload: unknown): void {
    this.server?.to(`user:${userId}`).emit(event, payload);
  }
}
