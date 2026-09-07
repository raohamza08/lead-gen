import { IsEnum, IsOptional, IsString, MinLength } from "class-validator";
import { EngagementStatus } from "@prisma/client";

export class UpdateCommentDto {
  @IsOptional() @IsEnum(EngagementStatus) status?: EngagementStatus;
  /** Empty string means "unassign" — same convention as UpdateConversationDto. */
  @IsOptional() @IsString() assignedToUserId?: string;
}

export class ReplyToCommentDto {
  @IsString() @MinLength(1) text!: string;
}
