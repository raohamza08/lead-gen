import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { NotificationCategory } from "@prisma/client";
import { PrismaService } from "../common/prisma/prisma.service";
import { NotificationsService } from "../notifications/notifications.service";

interface ClassifyInput {
  fromName: string | null | undefined;
  fromEmail: string;
  subject: string;
  bodyText: string;
}

/**
 * Judges a thread's first inbound message against the email_lead_classifier
 * agent and, if it looks like a viable prospect, tags it for a human to
 * confirm (Part: Lead Room / Smart Email Classification) — never creates a
 * lead itself, that's still EmailHubService.addToLead on a person's click.
 *
 * Same shape as CaseStudiesService.review(): fire-and-forget from the
 * caller's side (EmailHubSyncWorker), log-only on failure, never throws — a
 * worker outage must not break mail sync.
 */
@Injectable()
export class EmailLeadClassifierService {
  private readonly logger = new Logger(EmailLeadClassifierService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly notifications: NotificationsService,
  ) {}

  async classifyAndTag(orgId: string, messageId: string, email: ClassifyInput): Promise<void> {
    const aiWorkersUrl = this.config.get<string>("AI_WORKERS_URL", "http://localhost:8000");
    try {
      const res = await fetch(`${aiWorkersUrl}/email/classify-lead`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orgId,
          fromName: email.fromName,
          fromEmail: email.fromEmail,
          subject: email.subject,
          bodyText: email.bodyText,
        }),
        signal: AbortSignal.timeout(90_000),
      });
      if (!res.ok) throw new Error(`worker responded ${res.status}`);
      const result = (await res.json()) as { isCandidate: boolean; reason: string };

      if (!result.isCandidate) return;

      await this.prisma.inboundEmailMessage.update({
        where: { id: messageId },
        data: {
          suggestedCategory: "POSSIBLE_LEAD",
          aiSuggestedAction: result.reason || "Looks like a viable prospect — worth a look.",
        },
      });

      // A human needs to confirm this one (Part: Lead Room / Smart Email
      // Classification) -- surfaced via the bell, not just a badge someone
      // has to happen to scroll past in the inbox.
      await this.notifications.notify(orgId, {
        category: NotificationCategory.EMAIL,
        type: "POSSIBLE_LEAD_EMAIL",
        severity: "WARNING",
        title: "Possible Lead Detected",
        message: `Possible lead from ${email.fromName || email.fromEmail}: "${email.subject}"`,
        entityType: "inboundEmailMessage",
        entityId: messageId,
        actionUrl: "/email-hub?view=leads",
      });
    } catch (err) {
      this.logger.warn(`Lead classification failed for message ${messageId}: ${(err as Error).message}`);
    }
  }
}
