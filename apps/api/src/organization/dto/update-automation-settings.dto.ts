import { IsBoolean, IsOptional } from "class-validator";

export class UpdateAutomationSettingsDto {
  /** Whether the AI-drafted pitch (Email #3) sends itself once drafted.
   *  Defaults to true — set false to require a human to approve each one
   *  first (PENDING_APPROVAL), same as this system's original launch default. */
  @IsOptional() @IsBoolean() autoSendEnabled?: boolean;
}
