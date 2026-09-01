import { classifySendFailure } from "./failure-classifier";

describe("classifySendFailure", () => {
  it("classifies a missing verified email as INVALID_EMAIL", () => {
    expect(classifySendFailure("Lead has no verified email address")).toBe("INVALID_EMAIL");
  });

  it("classifies a suppression-list rejection as SUPPRESSED", () => {
    expect(classifySendFailure("Recipient is on the suppression list (HARD_BOUNCE)")).toBe("SUPPRESSED");
  });

  it("classifies an exhausted daily/hourly limit as PROVIDER_LIMIT", () => {
    expect(classifySendFailure("No email account available within its daily/hourly send limit")).toBe(
      "PROVIDER_LIMIT",
    );
  });

  it("classifies a raw SMTP/connection error as SMTP_PROVIDER_ERROR", () => {
    expect(classifySendFailure("connect ECONNREFUSED 127.0.0.1:587")).toBe("SMTP_PROVIDER_ERROR");
    expect(classifySendFailure("Invalid login: 535 authentication failed")).toBe("SMTP_PROVIDER_ERROR");
  });

  it("falls back to OTHER for an unrecognized message rather than guessing", () => {
    expect(classifySendFailure("something completely unexpected happened")).toBe("OTHER");
  });

  it("is case-insensitive", () => {
    expect(classifySendFailure("SUPPRESSION LIST")).toBe("SUPPRESSED");
  });
});
