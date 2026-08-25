import { IsArray, IsBoolean, IsOptional, IsString, ValidateNested } from "class-validator";
import { Type } from "class-transformer";

export class UpdateUserModulesDto {
  @IsOptional() @IsBoolean() leadGenAccess?: boolean;
  @IsOptional() @IsBoolean() emailHubAccess?: boolean;
  @IsOptional() @IsBoolean() socialMediaAccess?: boolean;
}

export class UpdateUserEmailAccountAccessDto {
  @IsString() accountId!: string;
  @IsBoolean() granted!: boolean;
  @IsOptional() @IsBoolean() canReply?: boolean;
}

export class UpdateUserSocialAccountAccessDto {
  @IsString() accountId!: string;
  @IsBoolean() granted!: boolean;
  @IsOptional() @IsBoolean() canPublish?: boolean;
  @IsOptional() @IsBoolean() canApprove?: boolean;
}

export class UpdateUserAccessDto {
  @IsOptional() @ValidateNested() @Type(() => UpdateUserModulesDto)
  modules?: UpdateUserModulesDto;

  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => UpdateUserEmailAccountAccessDto)
  emailAccounts?: UpdateUserEmailAccountAccessDto[];

  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => UpdateUserSocialAccountAccessDto)
  socialAccounts?: UpdateUserSocialAccountAccessDto[];
}
