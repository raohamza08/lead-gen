import { UpworkProposalStatus } from "@prisma/client";
import { IsEnum, IsOptional, IsString, MinLength } from "class-validator";

/** Everything an operator would ever edit after the initial submission —
 *  following up on outcome, not re-answering the original form. Type,
 *  profile, job link etc. are treated as immutable facts about the submission
 *  itself, same reasoning as leads.service.ts never letting a lead's source
 *  fields change after creation. */
export class UpdateUpworkProposalDto {
  @IsOptional() @IsEnum(UpworkProposalStatus) status?: UpworkProposalStatus;
  @IsOptional() @IsString() clientName?: string;
  @IsOptional() @IsString() closedBy?: string;
  @IsOptional() @IsString() clickupTaskId?: string;
  @IsOptional() @IsString() @MinLength(1) coverLetter?: string;
}
