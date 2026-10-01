import { UpworkRequestStatus } from "@prisma/client";
import { IsEnum, IsOptional, IsString } from "class-validator";

export class QueryUpworkRequestsDto {
  @IsOptional() @IsEnum(UpworkRequestStatus) status?: UpworkRequestStatus;
  @IsOptional() @IsString() projectManagerId?: string;
  @IsOptional() @IsString() from?: string;
  @IsOptional() @IsString() to?: string;
  @IsOptional() @IsString() page?: string;
  @IsOptional() @IsString() pageSize?: string;
}
