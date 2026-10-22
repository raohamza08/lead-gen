import { IsBoolean, IsOptional, IsString, MinLength } from "class-validator";

export class UpdateOrganizationDto {
  @IsString()
  @MinLength(1)
  organizationName!: string;

  @IsOptional()
  @IsBoolean()
  hidden?: boolean;

  @IsOptional()
  @IsString()
  vatId?: string;

  @IsOptional()
  @IsString()
  phoneNumber?: string;

  @IsOptional()
  @IsString()
  timezone?: string;
}
