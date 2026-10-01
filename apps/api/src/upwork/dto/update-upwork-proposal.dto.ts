import { UpworkProposalStatus } from "@prisma/client";
import { IsEnum, IsNumber, IsOptional, IsString, Min, MinLength } from "class-validator";

/** Everything an operator would ever edit after the initial submission —
 *  following up on outcome, not re-answering the original form. Type,
 *  profile, job link etc. are treated as immutable facts about the submission
 *  itself, same reasoning as leads.service.ts never letting a lead's source
 *  fields change after creation. `projectHours` is the one exception worth
 *  calling out: it's deliberately editable here even though it was part of
 *  the original form, since the real hour count for a project often isn't
 *  known until after it's won (Part: Upwork Requests, 2026-10-01). */
export class UpdateUpworkProposalDto {
  @IsOptional() @IsEnum(UpworkProposalStatus) status?: UpworkProposalStatus;
  @IsOptional() @IsString() clientName?: string;
  @IsOptional() @IsString() closedBy?: string;
  @IsOptional() @IsString() clickupTaskId?: string;
  @IsOptional() @IsString() @MinLength(1) coverLetter?: string;
  @IsOptional() @IsNumber() @Min(0) projectHours?: number;
}
