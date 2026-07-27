import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { NormalizedInboundEvent } from "./gmail-adapter.service";

interface GraphChangeNotification {
  value: Array<{ subscriptionId: string; changeType: string; resource: string }>;
}

/**
 * Translates Microsoft Graph change notifications into normalized inbound
 * events (Part E2 `/webhooks/graph`). Graph notifications only carry a
 * resource path — the message itself has to be fetched with an app-only
 * token (client-credentials flow, `Mail.Read` application permission).
 *
 * Uses a bare `fetch()` against the token + Graph REST endpoints rather than
 * pulling in `@azure/msal-node`/`@microsoft/microsoft-graph-client` — the
 * client-credentials flow is a single POST, not worth an SDK dependency here.
 *
 * NDR/bounce parsing is not implemented — Graph doesn't expose a clean bounce
 * signal the way Gmail's mailer-daemon heuristic does; only reply detection
 * is wired. Flagged rather than faked.
 */
@Injectable()
export class GraphAdapterService {
  private readonly logger = new Logger(GraphAdapterService.name);

  constructor(private readonly config: ConfigService) {}

  private async getAppToken(): Promise<string | null> {
    const clientId = this.config.get<string>("MS_GRAPH_CLIENT_ID");
    const clientSecret = this.config.get<string>("MS_GRAPH_CLIENT_SECRET");
    const tenantId = this.config.get<string>("MS_GRAPH_TENANT_ID");
    if (!clientId || !clientSecret || !tenantId) return null;

    const res = await fetch(`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        scope: "https://graph.microsoft.com/.default",
        grant_type: "client_credentials",
      }),
    });
    if (!res.ok) {
      this.logger.warn(`Failed to acquire Graph app token: ${res.status}`);
      return null;
    }
    const data = (await res.json()) as { access_token?: string };
    return data.access_token ?? null;
  }

  async translate(notification: GraphChangeNotification): Promise<NormalizedInboundEvent[]> {
    const token = await this.getAppToken();
    if (!token) {
      this.logger.warn("MS Graph not configured — cannot resolve change notification");
      return [];
    }

    const events: NormalizedInboundEvent[] = [];
    for (const item of notification.value ?? []) {
      if (item.changeType !== "created") continue;

      const res = await fetch(`https://graph.microsoft.com/v1.0/${item.resource}?$select=from`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) continue;

      const message = (await res.json()) as { from?: { emailAddress?: { address?: string } } };
      const fromEmail = message.from?.emailAddress?.address;
      if (!fromEmail) continue;

      events.push({ eventType: "REPLIED", leadEmail: fromEmail });
    }
    return events;
  }
}
