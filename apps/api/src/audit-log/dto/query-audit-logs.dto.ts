import { IsIn, IsOptional, IsString } from "class-validator";

export class QueryAuditLogsDto {
  @IsOptional() @IsString() actorId?: string;
  @IsOptional() @IsString() entityType?: string;
  @IsOptional() @IsString() action?: string;
  @IsOptional() @IsIn(["SUCCESS", "FAILURE"]) result?: "SUCCESS" | "FAILURE";
  @IsOptional() @IsString() leadId?: string;
  @IsOptional() @IsString() dateFrom?: string;
  @IsOptional() @IsString() dateTo?: string;
  @IsOptional() @IsString() search?: string;
  @IsOptional() @IsString() page?: string;
  @IsOptional() @IsString() pageSize?: string;
}
