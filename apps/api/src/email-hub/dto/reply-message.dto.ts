import { IsArray, IsBoolean, IsOptional, IsString, MinLength } from "class-validator";

export class ReplyMessageDto {
  @IsString() @MinLength(1) bodyHtml!: string;
  @IsOptional() @IsBoolean() replyAll?: boolean;
}

export class ComposeEmailDto {
  @IsString() accountId!: string;
  @IsArray() @IsString({ each: true }) to!: string[];
  @IsOptional() @IsArray() @IsString({ each: true }) cc?: string[];
  @IsOptional() @IsArray() @IsString({ each: true }) bcc?: string[];
  @IsString() @MinLength(1) subject!: string;
  @IsString() @MinLength(1) bodyHtml!: string;
}
