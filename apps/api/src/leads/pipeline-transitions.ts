import { PipelineStage } from "@leadgen/types";

/**
 * Valid forward transitions per the pipeline state diagram (Part C6). A lead can
 * also be moved to LOST from any active stage (abandoned deal), which is
 * handled as a special case rather than listed on every row.
 */
export const ALLOWED_TRANSITIONS: Record<PipelineStage, PipelineStage[]> = {
  [PipelineStage.NEW_LEAD]: [PipelineStage.UNDER_REVIEW],
  [PipelineStage.UNDER_REVIEW]: [PipelineStage.READY_FOR_OUTREACH],
  [PipelineStage.READY_FOR_OUTREACH]: [PipelineStage.EMAIL_1_SENT],
  [PipelineStage.EMAIL_1_SENT]: [PipelineStage.WAITING_2_DAYS],
  [PipelineStage.WAITING_2_DAYS]: [PipelineStage.EMAIL_2_SENT],
  [PipelineStage.EMAIL_2_SENT]: [PipelineStage.WAITING_1_2_DAYS],
  [PipelineStage.WAITING_1_2_DAYS]: [PipelineStage.GEMINI_DRAFTING],
  [PipelineStage.GEMINI_DRAFTING]: [PipelineStage.PERSONALIZED_PITCH],
  [PipelineStage.PERSONALIZED_PITCH]: [PipelineStage.LINKEDIN_OUTREACH],
  [PipelineStage.LINKEDIN_OUTREACH]: [PipelineStage.REPLIED],
  [PipelineStage.REPLIED]: [PipelineStage.MEETING_BOOKED],
  [PipelineStage.MEETING_BOOKED]: [PipelineStage.PROPOSAL_SENT],
  [PipelineStage.PROPOSAL_SENT]: [PipelineStage.WON, PipelineStage.LOST],
  [PipelineStage.WON]: [],
  [PipelineStage.LOST]: [],
};

export function isValidTransition(from: PipelineStage, to: PipelineStage): boolean {
  if (to === PipelineStage.LOST && from !== PipelineStage.WON) {
    return true; // a deal can be abandoned from any active stage
  }
  return ALLOWED_TRANSITIONS[from]?.includes(to) ?? false;
}
