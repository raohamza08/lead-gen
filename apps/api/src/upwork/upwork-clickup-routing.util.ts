/**
 * Static profile-name → ClickUp destination routing (Part: Upwork →
 * ClickUp card automation, explicit user request, 2026-10-16). Hardcoded
 * rather than admin-configurable because the user gave an exact, closed
 * list of names/paths, not a pattern that changes often — same posture as
 * UpworkProposalWritingSettings' default excludedCountries list before an
 * admin UI existed for it, just without the UI since none was asked for.
 *
 * IDs below were resolved live against the real ClickUp workspace
 * (`clickup_get_workspace_hierarchy` / `clickup_get_list` /
 * `clickup_get_workspace_members`), not guessed — "Project space" in the
 * user's wording is this workspace's "Projects" space.
 */

export type UpworkClickupFolder = "GRAPHIC" | "TECH" | "WEB";

export interface UpworkClickupRoute {
  folder: UpworkClickupFolder;
  listId: string;
  /** ClickUp user id for the task's real `assignees`. */
  assigneeUserId: number;
  /** That same assignee's exact ClickUp account name — used to look up a
   *  matching "Assigned Members" dropdown option live (explicit user
   *  request, 2026-10-16: "the assigned member will be ahmad and bilal
   *  only with their respective folders"). Matched by exact name against
   *  the field's real options at sync time, not a hardcoded option id —
   *  if the dropdown has no exact-name match (true for "Ahmad" today),
   *  the field is left unset rather than picking a different real
   *  person's name. */
  assigneeName: string;
  /** "Department" custom field option id. */
  departmentOptionId: string;
  /** "Assigned Team Lead" custom field option id. */
  teamLeadOptionId: string;
}

const BILAL_USER_ID = 101573133; // Muhammad Bilal
const AHMAD_USER_ID = 101564713; // "Ahmad" (ahmad.euroshub@gmail.com) — confirmed with the user as "Ahmad Ch", 2026-10-16

const GRAPHIC_LIST_ID = "1100740000001490"; // Projects > Graphic > Graphic Upwork
const TECH_LIST_ID = "1100740000002589"; // Projects > Tech > Tech Upwork
const WEB_LIST_ID = "1100740000002593"; // Projects > Web / Ecommerce > Upwork

// "Department" custom field option ids (shared field, same id across all 3 lists).
const DEPARTMENT_GRAPHICS = "7d05d0da-9644-482a-9582-b4d6ef5cb272";
const DEPARTMENT_DEVELOPMENT = "a79cfd86-5f87-443c-b49c-2d8f6f25fdd4";

// "Assigned Team Lead" custom field option ids.
const TEAM_LEAD_M_BILAL = "bb420542-25ee-496a-9cfe-182b71fbcc5b";
const TEAM_LEAD_AHMAD = "50a5d5a9-97c6-441e-af86-d4e6e82c10fc"; // "Ahmad " — the plain-Ahmad option, not "M Ahmad"

const GRAPHIC_ROUTE: UpworkClickupRoute = {
  folder: "GRAPHIC",
  listId: GRAPHIC_LIST_ID,
  assigneeUserId: BILAL_USER_ID,
  assigneeName: "Muhammad Bilal",
  departmentOptionId: DEPARTMENT_GRAPHICS,
  teamLeadOptionId: TEAM_LEAD_M_BILAL,
};

const TECH_ROUTE: UpworkClickupRoute = {
  folder: "TECH",
  listId: TECH_LIST_ID,
  assigneeUserId: AHMAD_USER_ID,
  assigneeName: "Ahmad",
  departmentOptionId: DEPARTMENT_DEVELOPMENT,
  teamLeadOptionId: TEAM_LEAD_AHMAD,
};

const WEB_ROUTE: UpworkClickupRoute = {
  folder: "WEB",
  listId: WEB_LIST_ID,
  assigneeUserId: AHMAD_USER_ID,
  assigneeName: "Ahmad",
  departmentOptionId: DEPARTMENT_DEVELOPMENT,
  teamLeadOptionId: TEAM_LEAD_AHMAD,
};

const PROFILE_ROUTES: Record<string, UpworkClickupRoute> = {
  laiba: GRAPHIC_ROUTE, kainat: GRAPHIC_ROUTE, zain: GRAPHIC_ROUTE, zainab: GRAPHIC_ROUTE,
  bilal: GRAPHIC_ROUTE, ayesha: GRAPHIC_ROUTE, amna: GRAPHIC_ROUTE, sehrish: GRAPHIC_ROUTE, mahnoor: GRAPHIC_ROUTE,
  saira: TECH_ROUTE, syeda: TECH_ROUTE, waqar: TECH_ROUTE, waleed: TECH_ROUTE,
  junaid: TECH_ROUTE, nabeel: TECH_ROUTE, zaheer: TECH_ROUTE, nadeem: TECH_ROUTE,
  asif: WEB_ROUTE, jibran: WEB_ROUTE,
};

/** Proposal profile names are stored freeform (e.g. "Laiba ID", "Laiba") —
 *  match on the first word, case-insensitively, rather than requiring an
 *  exact string. */
export function resolveUpworkClickupRoute(profileName: string): UpworkClickupRoute | undefined {
  const firstWord = profileName.trim().split(/\s+/)[0]?.toLowerCase();
  return firstWord ? PROFILE_ROUTES[firstWord] : undefined;
}

// "Upwork Profile" custom field id (shared field, same id across all 3
// lists). Its options are matched LIVE against the field's real options at
// sync time (see UpworkClickupSyncService.resolveProfileOption), not a
// hardcoded snapshot here — explicit user request, 2026-10-16: "the
// dropdown for upwork profile should be filled with the profile name that
// is added in the system, take it from there" — so a name added to
// ClickUp's dropdown later (e.g. "Mahnoor ID") just starts matching
// without a code change.
export const UPWORK_PROFILE_FIELD_ID = "ff83e577-6ce3-44cf-ae58-4683aedeee68";

// "Contract Type" custom field (shared field, same id across all 3 lists) —
// direct mapping from UpworkProposal.pricingType.
export const CONTRACT_TYPE_FIELD_ID = "16f06002-06c4-41db-ad25-47ac1080cf58";
export const CONTRACT_TYPE_OPTIONS = {
  HOURLY: "071c6781-ec95-431a-b352-def820d1c85b",
  FIXED: "f25ffec8-9160-4e29-93a1-ac682dbbd619",
} as const;

export const DEPARTMENT_FIELD_ID = "7468beaa-416e-49ca-a657-51796570ac65";
export const TEAM_LEAD_FIELD_ID = "8ce48b74-4034-4402-a2d1-2fd2b4920e68";
export const ASSIGNED_MEMBERS_FIELD_ID = "6c1461cd-30bf-4f3e-b64e-a8c736ce617c";

// "Communication Channel" (labels field) — every one of these projects
// originates on Upwork, so this is set the same way every time, not
// per-route.
export const COMMUNICATION_CHANNEL_FIELD_ID = "da62ee4e-68c8-4920-b83e-8d4170d4357b";
export const COMMUNICATION_CHANNEL_UPWORK_LABEL_ID = "6e82bd4f-d740-435c-937a-c4befc51012d";

// "Phase" (not required) — every new card starts at Planning.
export const PHASE_FIELD_ID = "cda3628b-0d22-4e77-bbcb-8887ebf7b3a9";
export const PHASE_PLANNING_OPTION_ID = "eb86945d-de4d-4f16-99d0-7956c837afb6";

export const CLICKUP_ONBOARDING_STATUS = "onboarding";
export const CLICKUP_TEST_TASK_STATUS = "test tasks";
export const CLICKUP_MEETING_STATUS = "meeting";
