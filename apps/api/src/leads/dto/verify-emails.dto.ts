import { ArrayMaxSize, ArrayMinSize, IsArray, IsString } from "class-validator";

/** Bulk counterpart to POST /leads/:id/verify-email — the Ready column's
 *  "Verify emails" button (Part: reliability overhaul, 2026-08-31). Capped
 *  at 500: this is meant for one pipeline column's worth of leads, not an
 *  org-wide re-verification sweep. */
export class VerifyEmailsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @IsString({ each: true })
  leadIds!: string[];
}
