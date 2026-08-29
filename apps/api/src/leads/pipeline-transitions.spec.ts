import { PipelineStage } from "@leadgen/types";
import { ALLOWED_TRANSITIONS, isValidTransition } from "./pipeline-transitions";

describe("isValidTransition", () => {
  it("allows the full documented forward path", () => {
    const path: [PipelineStage, PipelineStage][] = [
      [PipelineStage.READY_FOR_OUTREACH, PipelineStage.EMAIL_1_SENT],
      [PipelineStage.EMAIL_1_SENT, PipelineStage.WAITING_EMAIL_2],
      [PipelineStage.WAITING_EMAIL_2, PipelineStage.EMAIL_2_SENT],
      [PipelineStage.EMAIL_2_SENT, PipelineStage.WAITING_EMAIL_3],
      [PipelineStage.WAITING_EMAIL_3, PipelineStage.EMAIL_3_SENT],
      [PipelineStage.EMAIL_3_SENT, PipelineStage.WAITING_EMAIL_4],
      [PipelineStage.WAITING_EMAIL_4, PipelineStage.EMAIL_4_SENT],
      [PipelineStage.EMAIL_4_SENT, PipelineStage.WAITING_EMAIL_5],
      [PipelineStage.WAITING_EMAIL_5, PipelineStage.EMAIL_5_SENT],
      [PipelineStage.EMAIL_5_SENT, PipelineStage.LINKEDIN_OUTREACH],
      [PipelineStage.LINKEDIN_OUTREACH, PipelineStage.LINKEDIN_FOLLOW_UP],
      [PipelineStage.LINKEDIN_FOLLOW_UP, PipelineStage.REPLIED],
      [PipelineStage.REPLIED, PipelineStage.MEETING_BOOKED],
      [PipelineStage.MEETING_BOOKED, PipelineStage.PROPOSAL_SENT],
      [PipelineStage.PROPOSAL_SENT, PipelineStage.NEGOTIATION],
      [PipelineStage.NEGOTIATION, PipelineStage.WON],
      [PipelineStage.WON, PipelineStage.CLIENT_ONBOARDING],
    ];
    for (const [from, to] of path) {
      expect(isValidTransition(from, to)).toBe(true);
    }
  });

  it("allows the legitimate branches, so a skipped step doesn't strand a deal", () => {
    // Replied to the first LinkedIn touch, no follow-up needed.
    expect(isValidTransition(PipelineStage.LINKEDIN_OUTREACH, PipelineStage.REPLIED)).toBe(true);
    // Accepted the proposal without a negotiation round.
    expect(isValidTransition(PipelineStage.PROPOSAL_SENT, PipelineStage.WON)).toBe(true);
  });

  it("rejects skipping stages", () => {
    expect(isValidTransition(PipelineStage.READY_FOR_OUTREACH, PipelineStage.WON)).toBe(false);
    expect(isValidTransition(PipelineStage.EMAIL_1_SENT, PipelineStage.LINKEDIN_OUTREACH)).toBe(false);
  });

  it("rejects moving backwards", () => {
    expect(isValidTransition(PipelineStage.WAITING_EMAIL_2, PipelineStage.READY_FOR_OUTREACH)).toBe(false);
    expect(isValidTransition(PipelineStage.WON, PipelineStage.NEGOTIATION)).toBe(false);
  });

  it("allows abandoning to LOST from any active stage", () => {
    expect(isValidTransition(PipelineStage.EMAIL_1_SENT, PipelineStage.LOST)).toBe(true);
    expect(isValidTransition(PipelineStage.LINKEDIN_FOLLOW_UP, PipelineStage.LOST)).toBe(true);
    expect(isValidTransition(PipelineStage.NEGOTIATION, PipelineStage.LOST)).toBe(true);
  });

  it("refuses to mark a won or onboarding deal as lost", () => {
    // Would corrupt won/lost reporting: the deal is closed and being delivered.
    expect(isValidTransition(PipelineStage.WON, PipelineStage.LOST)).toBe(false);
    expect(isValidTransition(PipelineStage.CLIENT_ONBOARDING, PipelineStage.LOST)).toBe(false);
  });

  it("treats CLIENT_ONBOARDING and LOST as the only terminal stages", () => {
    const terminal = Object.entries(ALLOWED_TRANSITIONS)
      .filter(([, next]) => next.length === 0)
      .map(([stage]) => stage);
    expect(terminal.sort()).toEqual([PipelineStage.CLIENT_ONBOARDING, PipelineStage.LOST].sort());
  });

  it("covers every stage in the enum, so a new stage cannot be forgotten", () => {
    // A stage missing from the map returns false for every transition, which
    // would silently strand every lead that reached it.
    for (const stage of Object.values(PipelineStage)) {
      expect(ALLOWED_TRANSITIONS[stage]).toBeDefined();
    }
  });

  it("never lists a stage that is not in the enum", () => {
    const valid = new Set(Object.values(PipelineStage));
    for (const [from, next] of Object.entries(ALLOWED_TRANSITIONS)) {
      expect(valid.has(from as PipelineStage)).toBe(true);
      for (const to of next) expect(valid.has(to)).toBe(true);
    }
  });
});
