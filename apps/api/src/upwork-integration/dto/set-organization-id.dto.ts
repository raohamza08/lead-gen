import { IsString, MinLength } from "class-validator";

export class SetOrganizationIdDto {
  @IsString()
  @MinLength(1)
  organizationId!: string;
}
