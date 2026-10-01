import { IsNumber, IsString, Min, MinLength } from "class-validator";

/** One profile/ID line within a request — shared shape between create and
 *  update (Part: Upwork Requests, 2026-10-01). `requestedHours` must be
 *  strictly positive: zero or negative hours against a profile isn't a
 *  meaningful line item (spec section 16 — "hours cannot be negative" and
 *  "each selected ID/profile must have valid hours"). */
export class UpworkRequestItemInputDto {
  @IsString() @MinLength(1) profileName!: string;
  @IsNumber() @Min(0.01) requestedHours!: number;
}
