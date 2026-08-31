import { IsBoolean, IsObject, IsOptional, IsString } from "class-validator";

export class StartAgentExecutionDto {
  @IsString()
  orgId!: string;

  @IsString()
  leadId!: string;

  @IsString()
  agent!: string;

  @IsOptional()
  @IsObject()
  payload?: Record<string, unknown>;
}

export class SucceedAgentExecutionDto {
  @IsString()
  orgId!: string;

  @IsString()
  leadId!: string;

  @IsString()
  agent!: string;

  @IsString()
  executionId!: string;
}

export class FailAgentExecutionDto {
  @IsString()
  orgId!: string;

  @IsString()
  leadId!: string;

  @IsString()
  agent!: string;

  @IsString()
  executionId!: string;

  @IsString()
  errorDetail!: string;

  @IsBoolean()
  retryable!: boolean;

  @IsOptional()
  @IsBoolean()
  skipNotification?: boolean;
}
