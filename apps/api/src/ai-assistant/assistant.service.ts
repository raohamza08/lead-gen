import { Injectable } from "@nestjs/common";
import { JwtClaims } from "@leadgen/types";
import { GeminiClient } from "../upwork-proposal-writing/services/gemini.client";
import { AssistantContextService } from "./assistant-context.service";

export interface AssistantMessage {
  role: "user" | "assistant";
  content: string;
}

const SYSTEM_INSTRUCTION = `You are Outly's AI assistant, built into its CRM/lead-gen dashboard.
Only answer using the CONTEXT block provided with each question — it is a live, permission-filtered
snapshot of this specific user's own data. Never invent numbers or facts that aren't in CONTEXT.
If the answer isn't in CONTEXT, say plainly that you don't have that information rather than guessing.
Keep answers short and direct, like a helpful coworker, not a formal report.`;

/**
 * Stateless by design (Part: AI chat assistant, 2026-10-21 — explicit scope
 * decision, see the search/AI-assistant plan): no chat history is persisted
 * server-side. The frontend keeps the conversation in memory for the
 * session and may resend recent turns as `history` for continuity; nothing
 * here writes that history to the database.
 */
@Injectable()
export class AssistantService {
  constructor(
    private readonly gemini: GeminiClient,
    private readonly context: AssistantContextService,
  ) {}

  async answer(user: JwtClaims, message: string, history?: AssistantMessage[]): Promise<string> {
    const contextBlock = await this.context.build(user, message);

    const historyText = history?.length
      ? `\n\nPREVIOUS TURNS IN THIS CONVERSATION:\n${history.map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`).join("\n")}`
      : "";

    const prompt = `CONTEXT:\n${contextBlock || "(no data sources available to this user)"}${historyText}\n\nQUESTION:\n${message}`;

    return this.gemini.generateText(SYSTEM_INSTRUCTION, prompt, { temperature: 0.2 });
  }
}
