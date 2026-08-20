import { IsString, MaxLength } from "class-validator";

export class UpdateAgentPromptDto {
  /** Used verbatim as the agent's prompt — see shared/prompts.py on the AI
   *  workers side for why no server-side templating is applied to it. */
  @IsString()
  @MaxLength(20000)
  prompt!: string;
}
