import { IsOptional, IsString, MinLength } from "class-validator";

export class CreateCaseStudyDto {
  @IsOptional() @IsString() title?: string;
  @IsString() @MinLength(20) rawStory!: string;
  @IsString() submittedIndustry!: string;
}
