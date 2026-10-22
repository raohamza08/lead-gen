import { IsArray, IsBoolean, IsNumber, IsOptional, IsString, MinLength, ValidateNested } from "class-validator";
import { Type } from "class-transformer";

export class ProposalQuestionDto {
  @IsString()
  question!: string;

  @IsString()
  answer!: string;
}

export class SubmitProposalDto {
  /** Must be explicitly true -- this is the "final review and explicit
   *  confirmation" step the spec requires before any real submission. */
  @IsBoolean()
  confirmed!: boolean;

  /** The contractor-selection record ID from the job posting -- NOT a
   *  freelancer ID by itself, confirmed via introspection. Must be
   *  sourced from the real job posting being applied to. */
  @IsString()
  @MinLength(1)
  selectedContractorId!: string;

  /** The freelancer's legacy-format Upwork user ID. */
  @IsString()
  @MinLength(1)
  oDeskUserID!: string;

  @IsString()
  @MinLength(1)
  jobReference!: string;

  @IsNumber()
  chargedAmount!: number;

  @IsString()
  @MinLength(1)
  coverLetter!: string;

  @IsOptional()
  @IsString()
  occupationId?: string;

  @IsOptional()
  @IsNumber()
  estimatedDuration?: number;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ProposalQuestionDto)
  questions?: ProposalQuestionDto[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  attachments?: string[];
}
