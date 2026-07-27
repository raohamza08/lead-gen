import { IsEmail, IsEnum, IsString, MinLength } from "class-validator";
import { Role } from "@leadgen/types";

export class CreateUserDto {
  @IsEmail()
  email!: string;

  @IsString()
  name!: string;

  @IsString()
  @MinLength(8)
  password!: string;

  @IsEnum(Role)
  role!: Role;
}
