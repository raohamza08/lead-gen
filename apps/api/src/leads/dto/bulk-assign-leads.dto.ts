import { ArrayMaxSize, ArrayMinSize, IsArray, IsOptional, IsString } from "class-validator";

export class BulkAssignLeadsDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(500) @IsString({ each: true })
  leadIds!: string[];

  /** Omitted/null = unassign. */
  @IsOptional() @IsString()
  assignedUserId?: string | null;
}
