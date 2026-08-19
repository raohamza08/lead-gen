import { PipelineStage } from "./enums";

/**
 * Valid forward transitions through the sales pipeline.
 *
 * Shared rather than living in the API, because the pipeline board needs the
 * same rules to decide which columns accept a dragged card. Duplicating the
 * state machine in the frontend would let the two drift, and the visible
 * symptom would be a drop target that accepts a card the API then rejects.
 *
 * The API remains the authority and re-validates every transition — this copy
 * drives the affordance, not the decision.
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
  [PipelineStage.EMAIL_1_SENT]: [PipelineStage.WAITING_EMAIL_2],
  [PipelineStage.WAITING_EMAIL_2]: [PipelineStage.EMAIL_2_SENT],
  [PipelineStage.EMAIL_2_SENT]: [PipelineStage.WAITING_EMAIL_3],
  [PipelineStage.WAITING_EMAIL_3]: [PipelineStage.EMAIL_3_SENT],
  [PipelineStage.EMAIL_3_SENT]: [PipelineStage.WAITING_EMAIL_4],
  [PipelineStage.WAITING_EMAIL_4]: [PipelineStage.EMAIL_4_SENT],
  [PipelineStage.EMAIL_4_SENT]: [PipelineStage.WAITING_EMAIL_5],
  [PipelineStage.WAITING_EMAIL_5]: [PipelineStage.EMAIL_5_SENT],
  [PipelineStage.EMAIL_5_SENT]: [PipelineStage.LINKEDIN_OUTREACH],
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
export const NOT_ABANDONABLE: PipelineStage[] = [
  PipelineStage.WON,
  PipelineStage.CLIENT_ONBOARDING,
];

export function isValidTransition(from: PipelineStage, to: PipelineStage): boolean {
  if (to === PipelineStage.LOST) {
    return !NOT_ABANDONABLE.includes(from);
  }
  return ALLOWED_TRANSITIONS[from]?.includes(to) ?? false;
}

/**
 * The pipeline's rungs in forward order, LOST excluded — it's an abandon
 * state reachable from almost anywhere (see isValidTransition above), not a
 * position on this ladder. Enum declaration order already is this order
 * (Object.values on a string enum preserves declaration order), so this is
 * just that with LOST filtered out rather than a second source of truth to
 * keep in sync.
 *
 * Backs rewind (below): moving a lead "back" means picking any rung earlier
 * than its current one, not only the single step immediately before it —
 * useful when a card was advanced several stages too far, or an automated
 * action needs undoing from further along than one step back reaches.
 */
export const PIPELINE_STAGE_ORDER: PipelineStage[] = Object.values(PipelineStage).filter(
  (stage) => stage !== PipelineStage.LOST,
);

/**
 * Whether `to` is a legal rewind target from `from` — a correction, not a
 * pipeline transition, so it deliberately ignores ALLOWED_TRANSITIONS
 * entirely (that graph encodes what the automation does next, not what a
 * human undoing a mistake should be allowed to pick).
 *
 * LOST is handled specially in both directions:
 *   - as a destination, never valid here — marking a lead Lost is a distinct
 *     action (isValidTransition) with its own meaning, not a "step back".
 *   - as the current stage, treated as unconstrained rather than looked up
 *     in PIPELINE_STAGE_ORDER (it isn't in there) — a lead can be marked
 *     Lost from anywhere, so reviving one has no single "earlier" rung to
 *     measure against; every real stage is a valid revival target.
 */
export function isValidRewind(from: PipelineStage, to: PipelineStage): boolean {
  if (to === PipelineStage.LOST) return false;
  if (from === PipelineStage.LOST) return PIPELINE_STAGE_ORDER.includes(to);

  const fromIndex = PIPELINE_STAGE_ORDER.indexOf(from);
  const toIndex = PIPELINE_STAGE_ORDER.indexOf(to);
  if (fromIndex === -1 || toIndex === -1) return false;
  return toIndex < fromIndex;
}
