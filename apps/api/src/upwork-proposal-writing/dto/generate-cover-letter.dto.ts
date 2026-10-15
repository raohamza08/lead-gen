import { IsString, IsUrl } from "class-validator";

export class GenerateCoverLetterDto {
  @IsString() @IsUrl({ require_protocol: true }) jobUrl!: string;
}
