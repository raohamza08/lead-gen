import { IsOptional, IsString, MaxLength } from "class-validator";

export class UpdateOrgBrandingDto {
  /** Substituted for {{org.name}} — the company name in the signature's
   *  second line. Independent of emailFromName below; a professional name,
   *  not necessarily the org's legal/internal name. */
  @IsOptional() @IsString() @MaxLength(120)
  emailOrgName?: string;

  /** The From display name recipients see in their inbox next to the
   *  mailbox address (unless a specific mailbox overrides it in Settings >
   *  Email accounts). Independent of emailOrgName/emailSenderName — set
   *  separately so the inbox identity doesn't have to match either
   *  signature line. Falls back to emailOrgName when unset. */
  @IsOptional() @IsString() @MaxLength(120)
  emailFromName?: string;

  /** Substituted for {{sender.name}} — the signature's first line only
   *  (e.g. "Team", or a person's name). No longer doubles as the From
   *  display name — see emailFromName above. */
  @IsOptional() @IsString() @MaxLength(120)
  emailSenderName?: string;

  /** Substituted for {{org.postal_address}} — required by CAN-SPAM in every
   *  commercial email, same as the unsubscribe link. */
  @IsOptional() @IsString() @MaxLength(300)
  postalAddress?: string;
}
