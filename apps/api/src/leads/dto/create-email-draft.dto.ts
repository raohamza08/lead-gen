import { IsObject, IsString } from "class-validator";

/** Posted by the Gemini Personalization Agent once Email #3 is drafted (Part D2). */
export class CreateEmailDraftDto {
  @IsString()
  subject!: string;

  @IsString()
  bodyHtml!: string;

  @IsObject()
  rationale!: {
    problemsIdentified: string[];
    automationIdeas: string[];
    roiEstimateBasis: string;
    roadmapSteps: string[];
  };
}
