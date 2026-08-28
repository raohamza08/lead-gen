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
  @IsOptional() @IsArray() @IsString({ each: true }) cc?: string[];
  @IsOptional() @IsArray() @IsString({ each: true }) bcc?: string[];
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => OutboundAttachmentDto)
  attachments?: OutboundAttachmentDto[];
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
}
