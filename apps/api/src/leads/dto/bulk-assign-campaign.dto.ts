import { ArrayMaxSize, ArrayMinSize, IsArray, IsOptional, IsString } from "class-validator";

export class BulkAssignCampaignDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(500) @IsString({ each: true })
  leadIds!: string[];

  /** Omitted/null = detach from any campaign. */
  @IsOptional() @IsString()
  campaignId?: string | null;
}
