import { Type } from "class-transformer";
import { ArrayMinSize, IsArray, IsDateString, IsIn, IsOptional, IsString, ValidateNested } from "class-validator";
import { UpworkRequestItemInputDto } from "./upwork-request-item.dto";

/** A request always has at least one profile/ID line (spec section 16 — "a
 *  request cannot be submitted without at least one ID/profile"). `status`
 *  only accepts DRAFT or SUBMITTED at creation time — UNDER_REVIEW/APPROVED/
 *  REJECTED/COMPLETED are reviewer-only transitions, made through the
 *  separate review endpoint, never set directly by whoever is creating the
 *  request. */
export class CreateUpworkRequestDto {
  @IsDateString() requestDate!: string;
  @IsOptional() @IsString() notes?: string;
  @IsOptional() @IsIn(["DRAFT", "SUBMITTED"]) status?: "DRAFT" | "SUBMITTED";

  @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true }) @Type(() => UpworkRequestItemInputDto)
  items!: UpworkRequestItemInputDto[];
}
