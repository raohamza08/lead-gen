import { IsEnum, IsOptional, IsString, MinLength } from "class-validator";
import { ConversationStatus } from "@prisma/client";

export class UpdateConversationDto {
  @IsOptional() @IsEnum(ConversationStatus) status?: ConversationStatus;
  /** Empty string means "unassign" — an actual null can't travel over JSON
   *  the same way a missing key can, so the controller treats "" as the
   *  unassign signal explicitly rather than overloading undefined for both
   *  "don't change this" and "clear it". */
  @IsOptional() @IsString() assignedToUserId?: string;
  /** Manual override for a contact's display name (Part: WhatsApp Team
   *  Inbox contact rename, 2026-10-26) -- lets a team member set a real
   *  name once they recognize who it is, for the cases where the platform
   *  never provides one at all (confirmed for WhatsApp QR's LID-routed
   *  contacts: WhatsApp withholds the real name/number from a linked
   *  device, no amount of polling fixes that). Setting this also sets
   *  SocialConversation.contactNameLocked, so a later platform-reported
   *  name (even WhatsApp's own masked placeholder) can't silently
   *  overwrite it again -- see persistMessage's own docblock for the bug
   *  this fixed. Clearing it back to empty un-locks it. */
  @IsOptional() @IsString() contactName?: string;
}

export class ReplyDto {
  @IsString() @MinLength(1) text!: string;
}

/** Starting a brand-new WhatsApp conversation (Part: Social Inbox removal /
 *  per-module messaging follow-up, 2026-10-21, explicit user request — "add
 *  an option for whatsapp to send a message from here as well") — `to` is
 *  whatever the operator typed (any punctuation/spacing), normalized to
 *  digits-only server-side before sending/persisting so it matches the
 *  format WhatsApp's own webhook later reports for this same contact's
 *  reply (see SocialWebhookController.handleWhatsAppMessage's
 *  externalConversationId: message.from). */
export class StartConversationDto {
  @IsString() @MinLength(5) to!: string;
  @IsString() @MinLength(1) text!: string;
}

export class CreateNoteDto {
  @IsString() @MinLength(1) note!: string;
}

export class UpdateNoteDto {
  @IsString() @MinLength(1) note!: string;
}
