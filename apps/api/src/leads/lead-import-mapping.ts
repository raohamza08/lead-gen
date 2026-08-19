/**
 * Auto-maps a CSV's column headers onto CreateManualLeadDto fields (Part:
 * lead import). Dictionary-based rather than fuzzy/ML matching on purpose —
 * every guess is explainable ("this header matched this synonym"), which
 * matters because a wrong guess silently mis-files a column and the
 * uploader may not notice before importing. The confirm-mapping screen is
 * the real safety net; this only has to get the common cases right.
 */
import { parse } from "csv-parse/sync";

export interface ImportableField {
  key: string;
  label: string;
}

/** Every Lead field a CSV column can be mapped onto, in the order shown on
 *  the mapping screen. Kept in sync with CreateManualLeadDto by hand — it's
 *  a small, stable list and a generated version would need the same care
 *  taken over labels anyway. */
export const IMPORTABLE_FIELDS: ImportableField[] = [
  { key: "companyName", label: "Company name" },
  { key: "website", label: "Website" },
  { key: "linkedinUrl", label: "Company LinkedIn" },
  { key: "contactName", label: "Contact name" },
  { key: "jobTitle", label: "Job title" },
  { key: "contactLinkedinUrl", label: "Contact LinkedIn" },
  { key: "email", label: "Email" },
  { key: "personalEmail", label: "Personal email" },
  { key: "phone", label: "Phone" },
  { key: "industry", label: "Industry" },
  { key: "country", label: "Country" },
  { key: "city", label: "City" },
  { key: "employeeCount", label: "Employee count" },
  { key: "businessDescription", label: "Business description" },
  { key: "notes", label: "Notes" },
];

/** Synonyms are normalised the same way headers are before matching — see
 *  `normalise` below — so casing/punctuation/spacing never matters. */
const SYNONYMS: Record<string, string[]> = {
  companyName: ["company", "companyname", "business", "businessname", "organization", "organisation", "org", "orgname", "accountname", "firmname"],
  website: ["website", "url", "web", "site", "domain", "companywebsite", "webaddress", "homepage"],
  linkedinUrl: ["linkedin", "linkedinurl", "companylinkedin", "linkedinpage", "linkedincompany"],
  contactName: ["contact", "contactname", "name", "fullname", "personname", "leadname"],
  jobTitle: ["title", "jobtitle", "position", "role", "designation"],
  contactLinkedinUrl: ["contactlinkedin", "personallinkedin", "linkedinprofile", "profilelinkedin"],
  email: ["email", "workemail", "businessemail", "emailaddress", "companyemail", "mail"],
  personalEmail: ["personalemail", "personalemailaddress", "privateemail", "homeemail"],
  phone: ["phone", "phonenumber", "mobile", "mobilenumber", "contactnumber", "tel", "telephone", "cell"],
  industry: ["industry", "sector", "vertical", "niche", "category"],
  country: ["country", "nation"],
  city: ["city", "town", "location"],
  employeeCount: ["employees", "employeecount", "headcount", "companysize", "teamsize", "numemployees", "staffcount"],
  businessDescription: ["description", "about", "businessdescription", "summary", "overview", "bio"],
  notes: ["notes", "note", "comment", "comments", "remarks"],
};

function normalise(header: string): string {
  return header.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Best-guess field for each header. Exact normalised match wins; failing
 * that, a substring match (either direction) against a synonym, preferring
 * the longest synonym that matched (a longer match is a more specific,
 * more trustworthy signal — "companyname" beating the bare "name" synonym
 * under contactName, say). Each field is only ever assigned to one column:
 * once claimed, later headers compete for what's left, so two columns
 * never silently overwrite the same Lead field.
 */
export function suggestMapping(headers: string[]): Record<string, string | null> {
  const normalisedHeaders = headers.map(normalise);
  const claimed = new Set<string>();
  const result: Record<string, string | null> = {};

  // Pass 1: exact matches, in header order, so an earlier column wins a tie.
  headers.forEach((header, i) => {
    const norm = normalisedHeaders[i];
    for (const [field, synonyms] of Object.entries(SYNONYMS)) {
      if (claimed.has(field)) continue;
      if (synonyms.includes(norm)) {
        result[header] = field;
        claimed.add(field);
        return;
      }
    }
  });

  // Pass 2: substring matches for anything pass 1 left unmapped.
  headers.forEach((header, i) => {
    if (result[header]) return;
    const norm = normalisedHeaders[i];
    let best: { field: string; len: number } | null = null;
    for (const [field, synonyms] of Object.entries(SYNONYMS)) {
      if (claimed.has(field)) continue;
      for (const syn of synonyms) {
        if (norm.includes(syn) || syn.includes(norm)) {
          if (!best || syn.length > best.len) best = { field, len: syn.length };
        }
      }
    }
    if (best) {
      result[header] = best.field;
      claimed.add(best.field);
    } else {
      result[header] = null;
    }
  });

  return result;
}

/** Every field that must come through as a number, not a trimmed string —
 *  used by mapRowToDto below to know when to coerce a cell's raw text. */
const NUMERIC_FIELDS = new Set(["employeeCount"]);

/** Loose enough to catch a genuinely malformed cell without rejecting real
 *  addresses class-validator's stricter @IsEmail would also accept — this
 *  runs per-cell on free-text spreadsheet data, not a typed form field. */
const EMAIL_LIKE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function parseCsvHeaders(csv: string): string[] {
  const rows = parse(csv, { columns: false, skip_empty_lines: true, trim: true, to_line: 1 }) as string[][];
  return rows[0] ?? [];
}

export function parseCsvRows(csv: string): Record<string, string>[] {
  return parse(csv, { columns: true, skip_empty_lines: true, trim: true }) as Record<string, string>[];
}

/**
 * Applies a confirmed header->field mapping to one parsed CSV row, producing
 * the field set `insertManualLead` expects. Per-cell, not per-DTO,
 * validation: an email-shaped column with one bad cell drops just that
 * cell rather than failing the whole row — the company might still be
 * worth importing without it.
 */
export function mapRowToDto(row: Record<string, string>, mapping: Record<string, string | null>): Record<string, unknown> {
  const dto: Record<string, unknown> = {};
  for (const [header, field] of Object.entries(mapping)) {
    if (!field) continue;
    const raw = row[header];
    if (raw === undefined || raw === null) continue;
    const value = raw.trim();
    if (!value) continue;

    if (field === "email" || field === "personalEmail") {
      if (EMAIL_LIKE.test(value)) dto[field] = value;
      continue;
    }
    if (NUMERIC_FIELDS.has(field)) {
      const n = Number(value.replace(/[^0-9.]/g, ""));
      if (!Number.isNaN(n) && n >= 0) dto[field] = Math.round(n);
      continue;
    }
    dto[field] = value;
  }
  return dto;
}
