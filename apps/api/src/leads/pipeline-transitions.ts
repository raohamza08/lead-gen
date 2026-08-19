/**
 * The pipeline state machine now lives in @leadgen/types, because the pipeline
 * board needs the same rules to decide which columns accept a dragged card.
 * Duplicating it here would let the two drift, and the visible symptom would be
 * a drop target that accepts a card the API then rejects.
 *
 * Re-exported rather than removed so existing imports keep working. The API is
 * still the authority: it re-validates every transition regardless of what the
 * client believed was allowed.
 */
export {
  ALLOWED_TRANSITIONS,
  NOT_ABANDONABLE,
  PIPELINE_STAGE_ORDER,
  isValidTransition,
  isValidRewind,
} from "@leadgen/types";
