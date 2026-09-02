import { Type } from "class-transformer";
import { IsArray, IsBoolean, IsOptional, IsString, MinLength, ValidateNested } from "class-validator";

export class OutboundAttachmentDto {
  @IsString() @MinLength(1) filename!: string;
  @IsOptional() @IsString() contentType?: string;
  @IsString() @MinLength(1) contentBase64!: string;
}

export class ReplyMessageDto {
  @IsString() @MinLength(1) bodyHtml!: string;
  @IsOptional() @IsBoolean() replyAll?: boolean;
  /** Send-from override (Part: UI/UX Redesign, 2026-09-02) — defaults to the
   *  account that received the original message when omitted, matching the
   *  previous (only) behavior. Threading headers (In-Reply-To/References)
   *  work regardless of which account actually sends, since they key off
   *  Message-ID, not sender identity. */
  @IsOptional() @IsString() accountId?: string;
  @IsOptional() @IsArray() @IsString({ each: true }) cc?: string[];
  @IsOptional() @IsArray() @IsString({ each: true }) bcc?: string[];
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => OutboundAttachmentDto)
  attachments?: OutboundAttachmentDto[];
  /** "Track Email" checkbox — off unless explicitly checked (Part:
   *  reliability overhaul, 2026-08-31). */
  @IsOptional() @IsBoolean() trackOpen?: boolean;
}

export class ComposeEmailDto {
  @IsString() accountId!: string;
  @IsArray() @IsString({ each: true }) to!: string[];
  @IsOptional() @IsArray() @IsString({ each: true }) cc?: string[];
  @IsOptional() @IsArray() @IsString({ each: true }) bcc?: string[];
  @IsString() @MinLength(1) subject!: string;
  @IsString() @MinLength(1) bodyHtml!: string;
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => OutboundAttachmentDto)
  attachments?: OutboundAttachmentDto[];
  @IsOptional() @IsBoolean() trackOpen?: boolean;
}
