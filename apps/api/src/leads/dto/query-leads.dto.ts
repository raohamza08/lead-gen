import { IsEnum, IsInt, IsOptional, IsString, Max, Min } from "class-validator";
import { Type } from "class-transformer";
import { LeadSourceLayer, PipelineStage } from "@leadgen/types";

export class QueryLeadsDto {
  @IsOptional() @IsEnum(PipelineStage) stage?: PipelineStage;
  @IsOptional() @IsString() industry?: string;
  @IsOptional() @IsString() country?: string;
  @IsOptional() @IsString() assignedUserId?: string;
  @IsOptional() @IsEnum(LeadSourceLayer) sourceLayer?: LeadSourceLayer;
  @IsOptional() @IsString() search?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  pageSize?: number = 50;
}
