import { suggestMapping } from "./lead-import-mapping";

describe("suggestMapping", () => {
  it("maps common header variants to the right field", () => {
    const headers = ["Company Name", "Website URL", "Contact Name", "Job Title", "Email Address", "Phone Number"];
    const mapping = suggestMapping(headers);
    expect(mapping["Company Name"]).toBe("companyName");
    expect(mapping["Website URL"]).toBe("website");
    expect(mapping["Contact Name"]).toBe("contactName");
    expect(mapping["Job Title"]).toBe("jobTitle");
    expect(mapping["Email Address"]).toBe("email");
    expect(mapping["Phone Number"]).toBe("phone");
  });

  it("is case- and punctuation-insensitive", () => {
    const mapping = suggestMapping(["  company_name  ", "E-MAIL"]);
    expect(mapping["  company_name  "]).toBe("companyName");
    expect(mapping["E-MAIL"]).toBe("email");
  });

  it("never assigns the same field to two columns", () => {
    // Both plausibly mean "email" — only one can claim the field, the other
    // must fall back to unmapped rather than silently overwriting the same
    // column on import.
    const mapping = suggestMapping(["Email", "Contact Email"]);
    const mapped = Object.values(mapping).filter(Boolean);
    expect(new Set(mapped).size).toBe(mapped.length);
  });

  it("leaves a genuinely unrecognised header unmapped rather than guessing", () => {
    const mapping = suggestMapping(["Favorite Color"]);
    expect(mapping["Favorite Color"]).toBeNull();
  });

  it("distinguishes personal email from work email", () => {
    const mapping = suggestMapping(["Work Email", "Personal Email"]);
    expect(mapping["Work Email"]).toBe("email");
    expect(mapping["Personal Email"]).toBe("personalEmail");
  });
});
