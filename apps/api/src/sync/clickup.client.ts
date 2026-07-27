import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

const CLICKUP_API_BASE = "https://api.clickup.com/api/v2";

export interface ClickupTaskFields {
  companyName: string;
  website?: string | null;
  contactName?: string | null;
  jobTitle?: string | null;
  email?: string | null;
  phone?: string | null;
  leadScore?: number;
  fitReason?: string | null;
}

/**
 * Thin fetch()-based ClickUp API v2 client (Part C5). Uses the global fetch
 * available on Node >=18 rather than pulling in an SDK — ClickUp's REST
 * surface is small enough that a dedicated client adds little value here.
 */
@Injectable()
export class ClickupClient {
  private readonly logger = new Logger(ClickupClient.name);

  constructor(private readonly config: ConfigService) {}

  isConfigured(): boolean {
    return Boolean(this.config.get<string>("CLICKUP_API_TOKEN"));
  }

  private async request<T>(path: string, init: RequestInit): Promise<T> {
    const token = this.config.get<string>("CLICKUP_API_TOKEN");
    const res = await fetch(`${CLICKUP_API_BASE}${path}`, {
      ...init,
      headers: {
        Authorization: token ?? "",
        "Content-Type": "application/json",
        ...(init.headers ?? {}),
      },
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`ClickUp API ${res.status} on ${path}: ${body}`);
    }
    return res.json() as Promise<T>;
  }

  async createTask(listId: string, fields: ClickupTaskFields): Promise<{ id: string }> {
    const description = [
      fields.website ? `Website: ${fields.website}` : null,
      fields.contactName ? `Contact: ${fields.contactName}${fields.jobTitle ? ` (${fields.jobTitle})` : ""}` : null,
      fields.email ? `Email: ${fields.email}` : null,
      fields.phone ? `Phone: ${fields.phone}` : null,
      fields.leadScore !== undefined ? `Lead Score: ${fields.leadScore}` : null,
      fields.fitReason ? `Fit: ${fields.fitReason}` : null,
    ]
      .filter(Boolean)
      .join("\n");

    return this.request<{ id: string }>(`/list/${listId}/task`, {
      method: "POST",
      body: JSON.stringify({ name: fields.companyName, description }),
    });
  }

  async updateTaskStatus(taskId: string, status: string): Promise<void> {
    await this.request(`/task/${taskId}`, {
      method: "PUT",
      body: JSON.stringify({ status }),
    });
  }

  async createSubtask(parentTaskId: string, listId: string, name: string, assigneeUserId?: string): Promise<{ id: string }> {
    return this.request<{ id: string }>(`/list/${listId}/task`, {
      method: "POST",
      body: JSON.stringify({
        name,
        parent: parentTaskId,
        assignees: assigneeUserId ? [assigneeUserId] : undefined,
      }),
    });
  }
}
