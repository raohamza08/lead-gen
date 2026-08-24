import { IsBoolean, IsEmail, IsEnum, IsIn, IsInt, IsOptional, IsString, Max, Min } from "class-validator";
import { EmailProvider, EmailAccountStatus } from "@prisma/client";

export class UpsertEmailAccountDto {
  @IsEnum(EmailProvider)
  provider!: EmailProvider;

  @IsEmail()
  address!: string;

  /** Shown as the From display name instead of the bare address. Falls back
   *  to Settings > Email branding's sender name when unset. */
  @IsOptional() @IsString() displayName?: string;

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

  // ---- Email Hub: inbound IMAP sync ----
  @IsOptional() @IsString()
  imapHost?: string;

  @IsOptional() @IsInt()
  imapPort?: number;

  @IsOptional() @IsIn(["SSL", "STARTTLS", "NONE"])
  imapEncryption?: string;

  @IsOptional() @IsString()
  imapUsername?: string;

  /** Plaintext in the request; encrypted at rest by EmailAccountsService
   *  before it ever touches the database. Blank/omitted on an update means
   *  "keep the existing one" — same convention the frontend already uses
   *  for smtpPassword/oauthRefreshToken. */
  @IsOptional() @IsString()
  imapPassword?: string;

  /** Internal label shown in the Email Hub UI — distinct from displayName
   *  (the outbound From name a recipient sees). */
  @IsOptional() @IsString()
  mailboxLabel?: string;

  @IsOptional() @IsBoolean()
  inboundSyncEnabled?: boolean;
}
