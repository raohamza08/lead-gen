import { IsArray, IsIn, IsOptional, IsString, MaxLength, ValidateNested } from "class-validator";
import { Type } from "class-transformer";

export class AssistantHistoryTurnDto {
  @IsIn(["user", "assistant"])
  role!: "user" | "assistant";

  @IsString()
  @MaxLength(4000)
  content!: string;
}

export class SendAssistantMessageDto {
  @IsString()
  @MaxLength(2000)
  message!: string;

  // Frontend-held conversation so far (Part: AI chat assistant, 2026-10-21 —
  // no server-side chat history, see AssistantService's own docblock).
  // Capped short server-side too — this is context for the LLM prompt, not a
  // transcript store, so only the last few turns are worth sending anyway.
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AssistantHistoryTurnDto)
  history?: AssistantHistoryTurnDto[];
}
