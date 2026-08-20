import { IsBoolean, IsEmail, IsOptional, IsString } from "class-validator";

/**
 * Fixes the specific data gap that lets a lead reach outreach with no way to
 * actually contact it: a hand-entered lead can be created with no email at
 * all, and until now there was no way to add one afterwards short of editing
 * the database directly. Deliberately scoped to contact fields only — not a
 * general lead-edit endpoint.
 */
export class UpdateLeadContactDto {
  // Validated as an email for the same reason CreateManualLeadDto validates
  // it — a typo here becomes a bounce that damages the sending domain.
  @IsOptional() @IsEmail({}, { message: "email must be a valid address" }) email?: string;
  @IsOptional() @IsString() contactName?: string;
  @IsOptional() @IsString() jobTitle?: string;
  @IsOptional() @IsString() phone?: string;
  /** Mirrors CreateManualLeadDto's trust model: an operator confirming an
   *  email is real and reachable is what unblocks outreach, same as it does
   *  at creation time — this isn't automatic just because a value was typed. */
  @IsOptional() @IsBoolean() verifiedEmail?: boolean;
}
