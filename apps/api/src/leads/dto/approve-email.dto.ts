import { IsEnum, IsOptional, IsString } from "class-validator";

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
}
