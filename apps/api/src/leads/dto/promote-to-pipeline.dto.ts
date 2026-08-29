import { IsEnum, IsInt, IsOptional, IsString, Min } from "class-validator";
import { LeadSourceLayer } from "@leadgen/types";

export class PromoteToPipelineDto {
  /** Omitted = every un-promoted lead regardless of source. */
  @IsOptional() @IsEnum(LeadSourceLayer)
  sourceLayer?: LeadSourceLayer;

  /** Omitted = every matching lead, not just a batch of it. */
  @IsOptional() @IsInt() @Min(1)
  limit?: number;

  /** Promotes exactly this one lead (the lead detail page's own action),
   *  ignoring sourceLayer/limit. */
  @IsOptional() @IsString()
  leadId?: string;
}
