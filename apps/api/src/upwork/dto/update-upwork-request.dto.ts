import { Type } from "class-transformer";
import { ArrayMinSize, IsArray, IsDateString, IsOptional, IsString, ValidateNested } from "class-validator";
import { UpworkRequestItemInputDto } from "./upwork-request-item.dto";

/** Only reachable by the request's own Project Manager, and only while the
 *  request is still DRAFT or SUBMITTED (Part: Upwork Requests, 2026-10-01)
 *  — once a reviewer has moved it to UNDER_REVIEW or further, the request is
 *  locked so the thing being reviewed can't shift underneath the reviewer.
 *  `items`, when present, replaces the whole set wholesale (same pattern as
 *  UpworkService.updatePicklists), not a diff. */
export class UpdateUpworkRequestDto {
  @IsOptional() @IsDateString() requestDate?: string;
  @IsOptional() @IsString() notes?: string;

  @IsOptional() @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true }) @Type(() => UpworkRequestItemInputDto)
  items?: UpworkRequestItemInputDto[];
}
