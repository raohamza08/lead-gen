import { IsString, MinLength } from "class-validator";

export class ChangePasswordDto {
  @IsString() currentPassword!: string;
  /** Same minimum as team-section.tsx's temporary-password field — one
   *  password-strength rule across every path that sets one. */
  @IsString() @MinLength(8) newPassword!: string;
  @IsString() confirmPassword!: string;
}
