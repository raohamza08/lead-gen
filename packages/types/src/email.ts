import { EmailEventType, EmailMessageStatus } from "./enums";

export interface EmailAccount {
  id: string;
  orgId: string;
  provider: "GMAIL" | "MICROSOFT_365" | "SMTP";
  address: string;
  dailyLimit: number;
  hourlyLimit: number;
  warmupActive: boolean;
  status: "ACTIVE" | "PAUSED" | "SUSPENDED";
}

export interface EmailMessage {
  id: string;
  leadId: string;
  accountId: string | null;
  sequenceStep: 1 | 2 | 3;
  subject: string;
  bodyHtml: string;
  generatedBy: "TEMPLATE" | "CLAUDE" | "GEMINI" | "HUMAN_EDIT";
  status: EmailMessageStatus;
  scheduledAt: string | null;
  sentAt: string | null;
}

export interface EmailEvent {
  id: string;
  messageId: string;
  eventType: EmailEventType;
  occurredAt: string;
  meta: Record<string, unknown>;
}

export interface EmailDraftRationale {
  problemsIdentified: string[];
  automationIdeas: string[];
  roiEstimateBasis: string;
  roadmapSteps: string[];
}
