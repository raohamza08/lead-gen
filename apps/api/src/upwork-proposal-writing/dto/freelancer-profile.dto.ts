import { IsBoolean, IsOptional, IsString, MinLength } from "class-validator";

export class CreateFreelancerProfileDto {
  @IsString() @MinLength(1) name!: string;
  @IsString() @MinLength(1) niche!: string;
}

export class UpdateFreelancerProfileDto {
  @IsOptional() @IsString() @MinLength(1) name?: string;
  @IsOptional() @IsString() @MinLength(1) niche?: string;
  @IsOptional() @IsBoolean() active?: boolean;
}
