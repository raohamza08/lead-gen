import { IsOptional, IsString, MinLength } from "class-validator";

/// Invite Proposal Writing (Part: Invite Proposal Writing, 2026-10-24,
/// explicit user request — "the person can paste the invite content there
/// and the system can generate a cover letter for this one"). An Upwork
/// invite is a client-sent message, not a scraped job posting — there's no
/// URL to fetch and no structured facts (spend tier, country, posting age)
/// to extract, so this DTO is deliberately just the raw pasted text plus
/// the same optional known-client-name override every other generate
/// endpoint supports.
export class GenerateInviteCoverLetterDto {
  @IsString() @MinLength(20) inviteText!: string;

  @IsOptional() @IsString() knownClientName?: string;
}
