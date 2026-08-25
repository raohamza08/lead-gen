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

  /** Explicit opt-in for the outbound rotation — see EmailAccount.sendingEnabled's
   *  schema comment. Defaults false on create; an admin must turn this on
   *  once real send credentials are actually configured and verified. */
  @IsOptional() @IsBoolean()
  sendingEnabled?: boolean;

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

/**
 * PATCH /settings/email-accounts/:id accepts a partial update — editing a
 * mailbox's IMAP settings/label/sync toggle from Email Hub Settings never
 * re-sends `provider`/`address` (see EmailHubAccountsSection.saveAccount).
 * UpsertEmailAccountDto's `provider`/`address` have no `@IsOptional()`
 * because they ARE required on create; reusing that class directly on the
 * PATCH endpoint made every such edit fail validation with "provider must be
 * one of ..., address must be an email" even though nothing was wrong with
 * either field — the request just correctly omitted them.
 */
export class UpdateEmailAccountDto {
  @IsOptional() @IsEnum(EmailProvider)
  provider?: EmailProvider;

  @IsOptional() @IsEmail()
  address?: string;

  @IsOptional() @IsString() displayName?: string;

  @IsOptional() @IsInt() @Min(1) @Max(500)
  dailyLimit?: number;

  @IsOptional() @IsInt() @Min(1) @Max(100)
  hourlyLimit?: number;

  @IsOptional() @IsBoolean()
  warmupActive?: boolean;

  @IsOptional() @IsEnum(EmailAccountStatus)
  status?: EmailAccountStatus;

  @IsOptional() @IsBoolean()
  sendingEnabled?: boolean;

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

  @IsOptional() @IsString()
  imapHost?: string;

  @IsOptional() @IsInt()
  imapPort?: number;

  @IsOptional() @IsIn(["SSL", "STARTTLS", "NONE"])
  imapEncryption?: string;

  @IsOptional() @IsString()
  imapUsername?: string;

  @IsOptional() @IsString()
  imapPassword?: string;

  @IsOptional() @IsString()
  mailboxLabel?: string;

  @IsOptional() @IsBoolean()
  inboundSyncEnabled?: boolean;
}
