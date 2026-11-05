import { IsBoolean, IsInt, IsOptional, Min } from "class-validator";

export class UpdateAutomationSettingsDto {
  /** Whether the AI-drafted pitch (Email #3) sends itself once drafted.
   *  Defaults to true — set false to require a human to approve each one
   *  first (PENDING_APPROVAL), same as this system's original launch default. */
  @IsOptional() @IsBoolean() autoSendEnabled?: boolean;

  /** How many AI agent calls (lead discovery, enrichment, drafting) the
   *  DraftSchedulerWorker is allowed to dispatch per rolling hour (Part:
   *  Claude-budget-aware drip scheduler, 2026-11-05) — the only lever that
   *  controls how much of this org's Claude subscription usage the
   *  automated campaign pipeline consumes. There is no safe universal
   *  default: it depends on the org's actual Claude plan tier and how much
   *  headroom a human still needs for their own interactive sessions on the
   *  same login, so this is deliberately tunable, not hardcoded. */
  @IsOptional() @IsInt() @Min(1) claudeAgentCallsPerHour?: number;
}
