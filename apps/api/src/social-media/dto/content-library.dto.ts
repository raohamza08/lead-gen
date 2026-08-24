import { IsArray, IsOptional, IsString } from "class-validator";

export class CreateHashtagGroupDto {
  @IsString() name!: string;
  @IsArray() @IsString({ each: true }) hashtags!: string[];
}

export class UpdateHashtagGroupDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsArray() @IsString({ each: true }) hashtags?: string[];
}

export class CreateContentTemplateDto {
  @IsString() name!: string;
  @IsString() category!: string;
  @IsString() bodyTemplate!: string;
}

export class UpdateContentTemplateDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsString() category?: string;
  @IsOptional() @IsString() bodyTemplate?: string;
}

export class CreateMediaFolderDto {
  @IsString() name!: string;
  @IsOptional() @IsString() parentId?: string;
}
