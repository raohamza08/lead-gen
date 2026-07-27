import { PipelineStage } from "@leadgen/types";
import { isValidTransition } from "./pipeline-transitions";

describe("isValidTransition", () => {
  it("allows the documented forward path (Part C6)", () => {
    expect(isValidTransition(PipelineStage.NEW_LEAD, PipelineStage.UNDER_REVIEW)).toBe(true);
    expect(isValidTransition(PipelineStage.UNDER_REVIEW, PipelineStage.READY_FOR_OUTREACH)).toBe(true);
    expect(isValidTransition(PipelineStage.PROPOSAL_SENT, PipelineStage.WON)).toBe(true);
  });

  it("rejects skipping stages", () => {
    expect(isValidTransition(PipelineStage.NEW_LEAD, PipelineStage.READY_FOR_OUTREACH)).toBe(false);
    expect(isValidTransition(PipelineStage.NEW_LEAD, PipelineStage.WON)).toBe(false);
  });

  it("allows abandoning to LOST from any active stage", () => {
    expect(isValidTransition(PipelineStage.EMAIL_1_SENT, PipelineStage.LOST)).toBe(true);
    expect(isValidTransition(PipelineStage.LINKEDIN_OUTREACH, PipelineStage.LOST)).toBe(true);
  });

  it("does not allow moving out of terminal states", () => {
    expect(isValidTransition(PipelineStage.WON, PipelineStage.LOST)).toBe(false);
    expect(isValidTransition(PipelineStage.LOST, PipelineStage.NEW_LEAD)).toBe(false);
  });
});
