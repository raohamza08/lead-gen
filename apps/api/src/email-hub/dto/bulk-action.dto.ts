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

export enum IgnoreScope {
  SENDER = "SENDER",
  DOMAIN = "DOMAIN",
}

export class BulkActionDto {
  @IsArray() @IsString({ each: true }) messageIds!: string[];
  @IsEnum(BulkAction) action!: BulkAction;
  /** Required for ADD_TAG / REMOVE_TAG, ignored otherwise. */
  @IsOptional() @IsString() tagId?: string;
  /** IGNORE only (Part: Lead Upload Analytics / Email Performance / Ignore
   *  Groups, 2026-09-01) — SENDER (default, matches prior behavior exactly)
   *  mutes only the exact address; DOMAIN mutes every sender at that
   *  address's domain. Ignored for every other action, including UNIGNORE —
   *  unignoring always reverses whatever rule(s) actually match the
   *  selected messages, regardless of how broad they were. */
  @IsOptional() @IsEnum(IgnoreScope) ignoreScope?: IgnoreScope;
}
