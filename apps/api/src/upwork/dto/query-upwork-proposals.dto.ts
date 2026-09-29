import { UpworkProposalStatus, UpworkProposalType } from "@prisma/client";
import { IsEnum, IsOptional, IsString } from "class-validator";

export class QueryUpworkProposalsDto {
  @IsOptional() @IsEnum(UpworkProposalType) type?: UpworkProposalType;
  @IsOptional() @IsEnum(UpworkProposalStatus) status?: UpworkProposalStatus;
  @IsOptional() @IsString() submittedBy?: string;
  @IsOptional() @IsString() from?: string;
  @IsOptional() @IsString() to?: string;
  @IsOptional() @IsString() page?: string;
  @IsOptional() @IsString() pageSize?: string;
}
