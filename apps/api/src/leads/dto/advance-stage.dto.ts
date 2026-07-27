import { IsEnum } from "class-validator";
import { PipelineStage } from "@leadgen/types";

export class AdvanceStageDto {
  @IsEnum(PipelineStage)
  stage!: PipelineStage;
}
