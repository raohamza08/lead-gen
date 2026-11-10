import { IsEnum, IsInt, IsOptional, IsString, Max, Min } from "class-validator";
import { Type } from "class-transformer";
import { LeadSourceLayer, PipelineStage } from "@leadgen/types";

export class QueryLeadsDto {
  @IsOptional() @IsEnum(PipelineStage) stage?: PipelineStage;

  /** Lead Room's own listing (/leads) — once a lead is promoted (gets a
   *  PipelineState row, see LeadsService.promoteToPipeline), it belongs to
   *  the Pipeline board only and should stop showing up here. Boolean comes
   *  across the wire as the string "true". */
  @IsOptional() @IsString() unpromotedOnly?: string;

  @IsOptional() @IsString() industry?: string;
  @IsOptional() @IsString() country?: string;
  @IsOptional() @IsString() assignedUserId?: string;
  @IsOptional() @IsString() campaignId?: string;
  @IsOptional() @IsEnum(LeadSourceLayer) sourceLayer?: LeadSourceLayer;
  @IsOptional() @IsString() search?: string;

  /** Filter by Lead.createdAt (Part: table filter/KPI rollout, 2026-10-27,
   *  explicit user request — "add option to filter anything by date in
   *  each table"). Plain ISO date strings ("2026-10-01"); `dateTo` is
   *  treated as inclusive through the end of that calendar day in the
   *  service, same convention as the frontend's own date-range filter. */
  @IsOptional() @IsString() dateFrom?: string;
  @IsOptional() @IsString() dateTo?: string;

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
