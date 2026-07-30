import { IsOptional, IsString, MaxLength } from "class-validator";

export class UpdateOrgBrandingDto {
  /** Substituted for {{org.name}} in outreach emails — a professional name,
   *  not necessarily the org's legal/internal name. */
  @IsOptional() @IsString() @MaxLength(120)
  emailOrgName?: string;

  /** Substituted for {{sender.name}} and used as the From display name, so
   *  recipients see a person/company name instead of the bare mailbox address. */
  @IsOptional() @IsString() @MaxLength(120)
  emailSenderName?: string;
}
