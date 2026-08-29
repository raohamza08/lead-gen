import { ArrayMinSize, ArrayMaxSize, IsArray, IsString } from "class-validator";

export class BulkDeleteLeadsDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(500) @IsString({ each: true })
  leadIds!: string[];
}
