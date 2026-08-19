import { IsBoolean, IsIn, IsObject, IsOptional, IsString } from "class-validator";

/** Posted by the ai-workers "email" agent once one step of the 5-email
 *  sequence is drafted (Part: 5-email sequence, 2026-08-12). */
export class CreateEmailDraftDto {
  @IsIn([1, 2, 3, 4, 5])
  sequenceStep!: number;

  @IsString()
  subject!: string;

  @IsString()
  bodyHtml!: string;

  @IsObject()
  rationale!: {
    hook: string;
    insight: string;
    evidence: string | null;
    reframe: string;
    cta: string;
    /** Why `needsReview` was set — an unresolved placeholder, or a
     *  voice/structure rule still broken after one retry. */
    reviewNotes?: string[];
  };

  /** Set by the worker's deterministic lint (gemini_agent/lint.py) when the
   *  draft contains an unresolved [BRACKET PLACEHOLDER] or still breaks a
   *  voice/structure rule after one retry — forces human approval regardless
   *  of the org's autoSendEnabled setting. Never auto-send on a guess. */
  @IsOptional()
  @IsBoolean()
  needsReview?: boolean;
}
