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

  /** Scopes the batch to one campaign's own leads (Part: proper Campaign
   *  system, 2026-11-05, explicit user request — "jab campaign open karen
   *  tab hi wahan proper pipeline show ho jaye") — the campaign dashboard's
   *  own "Move to Pipeline" action, distinct from the org-wide one on the
   *  Leads page. */
  @IsOptional() @IsString()
  campaignId?: string;
}
