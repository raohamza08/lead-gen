import { PipelineStage } from "@leadgen/types";

/**
 * Valid forward transitions through the sales pipeline.
 *
 * A lead can also be moved to LOST from any active stage (an abandoned deal),
 * handled as a special case in isValidTransition rather than repeated on every
 * row.
 *
 * Two stages branch, and both branches are real:
 *   - LINKEDIN_OUTREACH may go to LINKEDIN_FOLLOW_UP (connection accepted) or
 *     straight to REPLIED (they answered the first touch).
 *   - PROPOSAL_SENT may go to NEGOTIATION or straight to WON.
 * Forcing the linear path would strand deals that legitimately skip a step, and
 * a stranded deal is invisible in the funnel.
 */
export const ALLOWED_TRANSITIONS: Record<PipelineStage, PipelineStage[]> = {
  [PipelineStage.NEW_LEAD]: [PipelineStage.VERIFIED],
  [PipelineStage.VERIFIED]: [PipelineStage.RESEARCH_COMPLETED],
  [PipelineStage.RESEARCH_COMPLETED]: [PipelineStage.UNDER_REVIEW],
  [PipelineStage.UNDER_REVIEW]: [PipelineStage.READY_FOR_OUTREACH],
  [PipelineStage.READY_FOR_OUTREACH]: [PipelineStage.EMAIL_1_SENT],
  [PipelineStage.EMAIL_1_SENT]: [PipelineStage.WAITING_2_DAYS],
  [PipelineStage.WAITING_2_DAYS]: [PipelineStage.EMAIL_2_SENT],
  [PipelineStage.EMAIL_2_SENT]: [PipelineStage.WAITING_1_2_DAYS],
  [PipelineStage.WAITING_1_2_DAYS]: [PipelineStage.GEMINI_DRAFTING],
  [PipelineStage.GEMINI_DRAFTING]: [PipelineStage.PERSONALIZED_PITCH],
  [PipelineStage.PERSONALIZED_PITCH]: [PipelineStage.LINKEDIN_OUTREACH],
  [PipelineStage.LINKEDIN_OUTREACH]: [PipelineStage.LINKEDIN_FOLLOW_UP, PipelineStage.REPLIED],
  [PipelineStage.LINKEDIN_FOLLOW_UP]: [PipelineStage.REPLIED],
  [PipelineStage.REPLIED]: [PipelineStage.MEETING_BOOKED],
  [PipelineStage.MEETING_BOOKED]: [PipelineStage.PROPOSAL_SENT],
  [PipelineStage.PROPOSAL_SENT]: [PipelineStage.NEGOTIATION, PipelineStage.WON],
  [PipelineStage.NEGOTIATION]: [PipelineStage.WON],
  // WON is not terminal — a closed deal moves into onboarding.
  [PipelineStage.WON]: [PipelineStage.CLIENT_ONBOARDING],
  [PipelineStage.CLIENT_ONBOARDING]: [],
  [PipelineStage.LOST]: [],
};

/** Stages a deal can no longer be abandoned from: it is already won and being
 *  delivered, so marking it LOST would corrupt won/lost reporting. */
const NOT_ABANDONABLE: PipelineStage[] = [PipelineStage.WON, PipelineStage.CLIENT_ONBOARDING];

export function isValidTransition(from: PipelineStage, to: PipelineStage): boolean {
  if (to === PipelineStage.LOST) {
    return !NOT_ABANDONABLE.includes(from);
  }
  return ALLOWED_TRANSITIONS[from]?.includes(to) ?? false;
}
