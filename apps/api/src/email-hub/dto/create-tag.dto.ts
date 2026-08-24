import { IsHexColor, IsOptional, IsString, MinLength } from "class-validator";

export class CreateTagDto {
  @IsString() @MinLength(1) name!: string;
  @IsOptional() @IsHexColor() color?: string;
}

export class UpdateTagDto {
  @IsOptional() @IsString() @MinLength(1) name?: string;
  @IsOptional() @IsHexColor() color?: string;
}
