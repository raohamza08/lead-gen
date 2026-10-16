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
  /** ClickUp user id for the task's `assignees`. */
  assigneeUserId: number;
  /** "Department" custom field option id. */
  departmentOptionId: string;
  /** "Assigned Team Lead" custom field option id. */
  teamLeadOptionId: string;
  /** "Assigned Members" custom field option id — undefined where no
   *  option in that dropdown actually matches the real assignee (the Tech/
   *  Web assignee "Ahmad" has no corresponding option there; left unset
   *  rather than picking a different real person's name). */
  assignedMembersOptionId?: string;
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

// "Assigned Members" custom field option id — only Bilal has a clean match.
const ASSIGNED_MEMBERS_BILAL = "def26e2f-07ef-4635-aa95-e161aba68967"; // "Muhammad Bilal"

const GRAPHIC_ROUTE: UpworkClickupRoute = {
  folder: "GRAPHIC",
  listId: GRAPHIC_LIST_ID,
  assigneeUserId: BILAL_USER_ID,
  departmentOptionId: DEPARTMENT_GRAPHICS,
  teamLeadOptionId: TEAM_LEAD_M_BILAL,
  assignedMembersOptionId: ASSIGNED_MEMBERS_BILAL,
};

const TECH_ROUTE: UpworkClickupRoute = {
  folder: "TECH",
  listId: TECH_LIST_ID,
  assigneeUserId: AHMAD_USER_ID,
  departmentOptionId: DEPARTMENT_DEVELOPMENT,
  teamLeadOptionId: TEAM_LEAD_AHMAD,
};

const WEB_ROUTE: UpworkClickupRoute = {
  folder: "WEB",
  listId: WEB_LIST_ID,
  assigneeUserId: AHMAD_USER_ID,
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

// "Upwork Profile" custom field option ids (shared field, same id across
// all 3 lists) — only 16 of the 19 routed profile names have a matching
// option today; mahnoor/junaid/nadeem have none (confirmed live against
// the field's real options, not assumed) and are deliberately left unset
// rather than guessing a near-match.
const UPWORK_PROFILE_FIELD_ID = "ff83e577-6ce3-44cf-ae58-4683aedeee68";
const UPWORK_PROFILE_OPTIONS: Record<string, string> = {
  amna: "c5dff182-bdf4-4b90-9a37-698e8673899a",
  asif: "61289576-a781-4569-b562-8e34fc31d4c1",
  ayesha: "a2a15a51-93d8-4527-bf6d-10d0c34b74cd",
  bilal: "1ef03e01-92d1-456e-ba2e-10ee8629a7f3",
  jibran: "fe0f1b39-2156-4442-bd05-1ea58d23bc84",
  kainat: "fee9c268-d955-4741-8273-146b29a0976d",
  laiba: "cea4c34d-07f6-4d2c-9936-a73379228078",
  nabeel: "4ee5d8f4-8cec-47d4-9c20-5a6f21dde5d7",
  saira: "06b41a32-6f6e-46da-938a-3229ee1c81e4",
  sehrish: "05ad4a77-fa76-4b8f-a7c5-5fd30e39365a",
  syeda: "2b0ce7e1-ac83-4855-b853-4b601480c1dc",
  waleed: "25cafe96-1d4a-4ea4-954d-84cd569c012e",
  waqar: "ed57bd29-dc36-418c-841b-f2fe30377a2d",
  zaheer: "36ab6452-0ea7-40be-ad6d-4d26488c92ed",
  zain: "d4b4642e-f9d2-4380-8bb3-c7e7dc8cf6e2",
  zainab: "6493fddc-543a-4b2e-9c52-9a7530add2e9",
};

export function buildUpworkProfileCustomField(profileName: string): { id: string; value: unknown } | undefined {
  const firstWord = profileName.trim().split(/\s+/)[0]?.toLowerCase();
  const optionId = firstWord ? UPWORK_PROFILE_OPTIONS[firstWord] : undefined;
  return optionId ? { id: UPWORK_PROFILE_FIELD_ID, value: optionId } : undefined;
}

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
