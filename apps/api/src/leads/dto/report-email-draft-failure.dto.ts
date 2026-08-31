import { IsIn, IsString } from "class-validator";

/** Posted by the ai-workers "email" agent when drafting a step of the
 *  5-email sequence produced no usable output (Claude CLI error, timeout, or
 *  a lint failure that survived the retry) — the counterpart to
 *  CreateEmailDraftDto for the failure path, which previously had no way to
 *  reach the API at all (see gemini_agent/runner.py). */
export class ReportEmailDraftFailureDto {
  @IsIn([1, 2, 3, 4, 5])
  sequenceStep!: number;

  @IsString()
  reason!: string;
}
