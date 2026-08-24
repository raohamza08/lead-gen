import { IsArray, IsEnum, IsOptional, IsString } from "class-validator";

export enum BulkAction {
  READ = "READ",
  UNREAD = "UNREAD",
  IMPORTANT = "IMPORTANT",
  UNIMPORTANT = "UNIMPORTANT",
  IGNORE = "IGNORE",
  UNIGNORE = "UNIGNORE",
  ADD_TAG = "ADD_TAG",
  REMOVE_TAG = "REMOVE_TAG",
  DELETE = "DELETE",
}

export class BulkActionDto {
  @IsArray() @IsString({ each: true }) messageIds!: string[];
  @IsEnum(BulkAction) action!: BulkAction;
  /** Required for ADD_TAG / REMOVE_TAG, ignored otherwise. */
  @IsOptional() @IsString() tagId?: string;
}
