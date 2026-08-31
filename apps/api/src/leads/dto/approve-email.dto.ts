import { IsBoolean, IsEnum, IsOptional, IsString } from "class-validator";

export enum ApproveEmailAction {
  APPROVE = "APPROVE",
  EDIT = "EDIT",
  REJECT = "REJECT",
}

export class ApproveEmailDto {
  @IsString()
  emailMessageId!: string;

  @IsEnum(ApproveEmailAction)
  action!: ApproveEmailAction;

  @IsOptional()
  @IsString()
  editedBodyHtml?: string;

  @IsOptional()
  @IsString()
  editedSubject?: string;

  /** "Track Email" checkbox — off unless the sender explicitly opts in
   *  (Part: reliability overhaul, 2026-08-31). Ignored on REJECT. */
  @IsOptional()
  @IsBoolean()
  trackEmailOpen?: boolean;
}
