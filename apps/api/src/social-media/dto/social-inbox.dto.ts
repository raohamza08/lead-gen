import { IsEnum, IsOptional, IsString, MinLength } from "class-validator";
import { ConversationStatus } from "@prisma/client";

export class UpdateConversationDto {
  @IsOptional() @IsEnum(ConversationStatus) status?: ConversationStatus;
  /** Empty string means "unassign" — an actual null can't travel over JSON
   *  the same way a missing key can, so the controller treats "" as the
   *  unassign signal explicitly rather than overloading undefined for both
   *  "don't change this" and "clear it". */
  @IsOptional() @IsString() assignedToUserId?: string;
}

export class ReplyDto {
  @IsString() @MinLength(1) text!: string;
}

export class CreateNoteDto {
  @IsString() @MinLength(1) note!: string;
}

export class UpdateNoteDto {
  @IsString() @MinLength(1) note!: string;
}
