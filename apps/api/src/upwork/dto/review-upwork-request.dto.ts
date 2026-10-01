import { IsIn, IsOptional, IsString } from "class-validator";

/** Reviewer-only transition (Part: Upwork Requests, 2026-10-01) — DRAFT and
 *  SUBMITTED are excluded here on purpose: a reviewer moves a request
 *  forward, never back to an author-only state. */
export class ReviewUpworkRequestDto {
  @IsIn(["UNDER_REVIEW", "APPROVED", "REJECTED", "COMPLETED"])
  status!: "UNDER_REVIEW" | "APPROVED" | "REJECTED" | "COMPLETED";

  @IsOptional() @IsString() reviewNotes?: string;
}
