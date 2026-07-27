import { IsBoolean, IsEmail, IsEnum, IsInt, IsOptional, IsString, Max, Min } from "class-validator";
import { EmailProvider, EmailAccountStatus } from "@prisma/client";

export class UpsertEmailAccountDto {
  @IsEnum(EmailProvider)
  provider!: EmailProvider;

  @IsEmail()
  address!: string;

  @IsOptional() @IsInt() @Min(1) @Max(500)
  dailyLimit?: number;

  @IsOptional() @IsInt() @Min(1) @Max(100)
  hourlyLimit?: number;

  @IsOptional() @IsBoolean()
  warmupActive?: boolean;

  @IsOptional() @IsEnum(EmailAccountStatus)
  status?: EmailAccountStatus;

  @IsOptional() @IsString()
  oauthRefreshToken?: string;

  @IsOptional() @IsString()
  smtpHost?: string;

  @IsOptional() @IsInt()
  smtpPort?: number;

  @IsOptional() @IsString()
  smtpUsername?: string;

  @IsOptional() @IsString()
  smtpPassword?: string;
}
