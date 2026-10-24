const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000/api/v1";

const ACCESS_KEY = "accessToken";
const REFRESH_KEY = "refreshToken";

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn?: number;
}

export interface OutboundAttachmentInput {
  filename: string;
  contentType?: string;
  contentBase64: string;
}

/** Exported for realtime.ts — the socket handshake authenticates with the
 *  same access token every REST call already uses. */
export function getAccessToken(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(ACCESS_KEY);
}

function getRefreshToken(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(REFRESH_KEY);
}

/**
 * Both tokens must be stored. The access token expires after 15 minutes; the
 * refresh token is the only way to get a new one without making the user sign
 * in again. Storing only the access token means the dashboard breaks with a
 * wall of 401s a quarter of an hour after login.
 */
export function setTokens(tokens: AuthTokens) {
  window.localStorage.setItem(ACCESS_KEY, tokens.accessToken);
  if (tokens.refreshToken) window.localStorage.setItem(REFRESH_KEY, tokens.refreshToken);
}

/** Kept for the older call sites that only ever had an access token. */
export function setAccessToken(token: string) {
  window.localStorage.setItem(ACCESS_KEY, token);
}

export function clearTokens() {
  window.localStorage.removeItem(ACCESS_KEY);
  window.localStorage.removeItem(REFRESH_KEY);
}

export const clearAccessToken = clearTokens;

/** Whether a session plausibly exists. Route guards use this to decide whether
 *  to render or bounce to /login; it does not prove the token is still valid. */
export function hasSession(): boolean {
  return Boolean(getAccessToken());
}

export interface CurrentUser {
  sub: string;
  orgId: string;
  role:
    | "ADMIN"
    | "MANAGER"
    | "LEAD_REVIEWER"
    | "SALES_REP"
    | "VIEWER"
    | "PROJECT_MANAGER"
    | "BUSINESS_DEVELOPER"
    | "EMAIL_REVIEWER"
    | "ADS_MANAGER"
    | "LEAD_GEN_MANAGER";
  email: string;
}

/**
 * Reads identity/role off the access token's payload for UI purposes only —
 * showing or hiding admin-only controls like "New user". This is NOT a
 * security boundary: the JWT signature is never checked client-side, so a
 * tampered token could claim any role. The API's own RolesGuard is what
 * actually enforces access on every request; this only decides what renders.
 */
export function getCurrentUser(): CurrentUser | null {
  const token = getAccessToken();
  if (!token) return null;
  try {
    const payload = token.split(".")[1];
    const json = atob(payload.replace(/-/g, "+").replace(/_/g, "/"));
    return JSON.parse(json) as CurrentUser;
  } catch {
    return null;
  }
}

/**
 * De-duplicates concurrent refreshes.
 *
 * The API *rotates* refresh tokens — using one revokes it and issues a new
 * pair. A dashboard page fires several requests at once, so if each 401 kicked
 * off its own refresh, the first would succeed and revoke the token while the
 * rest failed against the now-revoked value, signing the user out mid-session.
 * All callers share one in-flight promise instead.
 */
let refreshInFlight: Promise<string | null> | null = null;

async function refreshAccessToken(): Promise<string | null> {
  if (!refreshInFlight) {
    refreshInFlight = (async (): Promise<string | null> => {
      const refreshToken = getRefreshToken();
      if (!refreshToken) return null;
      try {
        const res = await fetch(`${API_BASE_URL}/auth/refresh`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ refreshToken }),
        });
        if (!res.ok) return null;
        const tokens = (await res.json()) as AuthTokens;
        setTokens(tokens);
        return tokens.accessToken;
      } catch {
        // Network failure, not an auth failure. Returning null signs the user
        // out, which is the safe direction to fail.
        return null;
      }
    })();
  }

  try {
    return await refreshInFlight;
  } finally {
    refreshInFlight = null;
  }
}

function redirectToLogin() {
  if (typeof window === "undefined") return;
  clearTokens();
  // Guard against a redirect loop when the failing request came from /login.
  if (!window.location.pathname.startsWith("/login")) {
    window.location.href = "/login";
  }
}

async function request<T>(path: string, init?: RequestInit, allowRetry = true): Promise<T> {
  const token = getAccessToken();
  const res = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init?.headers,
    },
  });

  // One refresh attempt, then replay the original request. Auth endpoints are
  // excluded: a 401 from /auth/login means bad credentials, and retrying it
  // would loop.
  if (res.status === 401 && allowRetry && !path.startsWith("/auth/")) {
    const refreshed = await refreshAccessToken();
    if (refreshed) return request<T>(path, init, false);
    redirectToLogin();
    throw new Error("Your session has expired. Please sign in again.");
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.message ?? `Request to ${path} failed with ${res.status}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

/**
 * CSV export bypasses `request()` — the response is a file, not JSON, and
 * triggering a save needs a real DOM element, not a return value. The token
 * is attached manually since this isn't a same-origin link a browser could
 * navigate to directly; a plain `<a href>` to the API would hit it with no
 * Authorization header and get a 401.
 */
export async function downloadLeadsCsv(): Promise<void> {
  const token = getAccessToken();
  const res = await fetch(`${API_BASE_URL}/leads/export`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.message ?? `Export failed with ${res.status}`);
  }

  // Blob URLs ignore Content-Disposition (that header only applies to a
  // direct navigation), so the filename has to be pulled out and applied via
  // the <a> element's own `download` attribute instead.
  const disposition = res.headers.get("Content-Disposition") ?? "";
  const filename = /filename="([^"]+)"/.exec(disposition)?.[1] ?? "leads.csv";

  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

/**
 * Admin-only CSV export for the Upwork Bidding/Invite tabs (Part: Upwork
 * Proposals CSV export, 2026-10-13) — same bypass-`request()` reasoning as
 * downloadLeadsCsv above (the response is a file, not JSON). Takes whatever
 * filters the caller currently has applied (type/status/search/from/to) so
 * the export matches what's on screen, not always everything.
 */
export async function downloadUpworkProposalsCsv(params: Record<string, string> = {}): Promise<void> {
  const token = getAccessToken();
  const res = await fetch(`${API_BASE_URL}/upwork/proposals/export?${new URLSearchParams(params).toString()}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.message ?? `Export failed with ${res.status}`);
  }

  const disposition = res.headers.get("Content-Disposition") ?? "";
  const filename = /filename="([^"]+)"/.exec(disposition)?.[1] ?? "upwork-proposals.csv";

  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

/**
 * Same bypass-`request()` reasoning as downloadLeadsCsv above, but opens the
 * blob in a new tab instead of forcing a save — the browser's native PDF/
 * image viewer handles "view", and its own download button (or a save
 * prompt for a type it can't render) handles "download," so one click
 * covers both without the caller needing to choose in advance.
 */
export async function viewEmailAttachment(messageId: string, index: number): Promise<void> {
  const token = getAccessToken();
  const res = await fetch(`${API_BASE_URL}/email-hub/messages/${messageId}/attachments/${index}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.message ?? `Couldn't load attachment (${res.status})`);
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  window.open(url, "_blank");
  // Long enough for the new tab to actually load the resource before the
  // object URL is freed — revoking immediately would race the tab's fetch.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export const api = {
  login: (email: string, password: string) =>
    request<AuthTokens>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    }),
  logout: async () => {
    await request("/auth/logout", { method: "POST" }).catch(() => undefined);
    clearTokens();
  },
  getSummary: () => request("/analytics/summary"),
  getFunnel: () => request("/analytics/funnel"),
  getLeads: (params: Record<string, string> = {}) =>
    request(`/leads?${new URLSearchParams(params).toString()}`),
  getLeadSourceBreakdown: () => request("/leads/source-breakdown"),
  getLeadFilterOptions: () => request<{ industries: string[]; countries: string[] }>("/leads/filter-options"),
  getPromotePreviewCount: (sourceLayer?: string) =>
    request<{ count: number }>(`/leads/promote-preview${sourceLayer ? `?sourceLayer=${sourceLayer}` : ""}`),
  getLead: (id: string) => request(`/leads/${id}`),
  updateReview: (id: string, body: Record<string, unknown>) =>
    request(`/leads/${id}/review`, { method: "PATCH", body: JSON.stringify(body) }),
  updateLeadContact: (id: string, body: Record<string, unknown>) =>
    request(`/leads/${id}/contact`, { method: "PATCH", body: JSON.stringify(body) }),
  advanceStage: (id: string, stage: string) =>
    request(`/leads/${id}/advance-stage`, { method: "POST", body: JSON.stringify({ stage }) }),
  moveBack: (id: string) => request(`/leads/${id}/move-back`, { method: "POST" }),
  rewindLead: (id: string, stage: string) =>
    request(`/leads/${id}/rewind`, { method: "POST", body: JSON.stringify({ stage }) }),
  verifyEmail: (id: string) => request(`/leads/${id}/verify-email`, { method: "POST" }),
  verifyEmails: (leadIds: string[]) =>
    request(`/leads/verify-emails`, { method: "POST", body: JSON.stringify({ leadIds }) }),
  resendEmail: (id: string, emailMessageId: string) =>
    request(`/leads/${id}/emails/${emailMessageId}/resend`, { method: "POST" }),
  // Distinct from resendEmail above: that retries SENDING an email that was
  // already drafted; this retries the DRAFTING itself (e.g. a FAILED
  // EmailMessage with an empty subject/bodyHtml — the draft attempt never
  // produced content in the first place, so there is nothing for resendEmail
  // to send). Backend: LeadsController.generatePitchDraft.
  retryPitchDraft: (id: string) => request(`/leads/${id}/pitch-draft/generate`, { method: "POST" }),
  approveEmail: (id: string, body: Record<string, unknown>) =>
    request(`/leads/${id}/approve-email`, { method: "POST", body: JSON.stringify(body) }),
  createManualLead: (body: Record<string, unknown>) =>
    request("/leads/manual", { method: "POST", body: JSON.stringify(body) }),
  previewLeadImport: (csv: string) =>
    request("/leads/import/preview", { method: "POST", body: JSON.stringify({ csv }) }),
  importLeads: (csv: string, mapping: Record<string, string | null>) =>
    request("/leads/import", { method: "POST", body: JSON.stringify({ csv, mapping }) }),
  deleteLead: (id: string) => request(`/leads/${id}`, { method: "DELETE" }),
  deleteLeadsByStage: (stage: string) =>
    request<{ deleted: number }>(`/leads/by-stage/${stage}`, { method: "DELETE" }),
  promoteLeadsToPipeline: (body: { sourceLayer?: string; limit?: number; leadId?: string }) =>
    request<{ promoted: number }>("/leads/promote-to-pipeline", { method: "POST", body: JSON.stringify(body) }),
  bulkDeleteLeads: (leadIds: string[]) =>
    request<{ deleted: number }>("/leads/bulk-delete", { method: "POST", body: JSON.stringify({ leadIds }) }),
  bulkAssignLeads: (leadIds: string[], assignedUserId: string | null) =>
    request<{ assigned: number }>("/leads/bulk-assign", { method: "POST", body: JSON.stringify({ leadIds, assignedUserId }) }),
  getNicheFilters: () => request("/niche-filters"),
  getFilterDeletionImpact: (id: string) => request(`/niche-filters/${id}/deletion-impact`),
  deleteNicheFilter: (id: string) => request(`/niche-filters/${id}`, { method: "DELETE" }),
  createNicheFilter: (body: Record<string, unknown>) =>
    request("/niche-filters", { method: "POST", body: JSON.stringify(body) }),
  updateNicheFilter: (id: string, body: Record<string, unknown>) =>
    request(`/niche-filters/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  runNicheFilterNow: (id: string) => request(`/niche-filters/${id}/run-now`, { method: "POST" }),
  cancelNicheFilterRun: (filterId: string, runId: string) =>
    request(`/niche-filters/${filterId}/runs/${runId}/cancel`, { method: "POST" }),
  getPendingApprovals: () => request("/sequences/pending-approvals"),
  resendAllFailedSequenceEmails: () => request("/sequences/resend-all-failed", { method: "POST" }),
  getSendQueue: () => request("/sequences/send-queue"),
  getEmailAccounts: () => request("/settings/email-accounts"),
  getEmailAccountsHealth: () => request("/settings/email-accounts/health"),
  createEmailAccount: (body: Record<string, unknown>) =>
    request("/settings/email-accounts", { method: "POST", body: JSON.stringify(body) }),
  updateEmailAccount: (id: string, body: Record<string, unknown>) =>
    request(`/settings/email-accounts/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  testEmailAccount: (id: string) => request(`/settings/email-accounts/${id}/test`, { method: "POST" }),
  resendAllFailedEmails: () => request("/settings/email-accounts/resend-all-failed", { method: "POST" }),
  getSendingMailboxes: () => request("/settings/email-accounts/sending-options"),
  getAgentPrompts: () => request("/settings/organization/agent-prompts"),
  updateAgentPrompt: (name: string, prompt: string) =>
    request(`/settings/organization/agent-prompts/${name}`, {
      method: "PATCH",
      body: JSON.stringify({ prompt }),
    }),
  restoreAgentPrompt: (name: string) =>
    request(`/settings/organization/agent-prompts/${name}`, { method: "DELETE" }),
  getWebsiteAnalyticsStatus: () => request("/dashboard-center/website-analytics/status"),
  setWebsiteAnalyticsProperty: (propertyId: string) =>
    request("/dashboard-center/website-analytics/property", { method: "POST", body: JSON.stringify({ propertyId }) }),
  getWebsiteAnalyticsOverview: (params: Record<string, string> = {}) =>
    request(`/dashboard-center/website-analytics/overview?${new URLSearchParams(params)}`),
  getWebsiteAnalyticsTimeseries: (params: Record<string, string> = {}) =>
    request(`/dashboard-center/website-analytics/timeseries?${new URLSearchParams(params)}`),
  getWebsiteAnalyticsTrafficSources: (params: Record<string, string> = {}) =>
    request(`/dashboard-center/website-analytics/traffic-sources?${new URLSearchParams(params)}`),
  getWebsiteAnalyticsTopPages: (params: Record<string, string> = {}) =>
    request(`/dashboard-center/website-analytics/top-pages?${new URLSearchParams(params)}`),
  getWebsiteAnalyticsAudience: (params: Record<string, string> = {}) =>
    request(`/dashboard-center/website-analytics/audience?${new URLSearchParams(params)}`),
  getOrgAccentColor: () => request("/settings/organization/accent-color"),
  updateOrgAccentColor: (hex: string) =>
    request("/settings/organization/accent-color", { method: "PATCH", body: JSON.stringify({ hex }) }),
  resetOrgAccentColor: () => request("/settings/organization/accent-color", { method: "DELETE" }),
  deleteEmailAccount: (id: string) => request(`/settings/email-accounts/${id}`, { method: "DELETE" }),
  getEmailFunnel: () => request("/analytics/email-funnel"),
  getEmailList: (event: "OPENED" | "REPLIED" | "FAILED" | "SENT") => request(`/analytics/emails?event=${event}`),
  getSuppressionList: () => request("/analytics/suppression-list"),
  getAgentOptimizationCycles: () => request("/agent-optimization/cycles"),
  runAgentOptimizationNow: () => request("/agent-optimization/run-now", { method: "POST" }),
  revertAgentOptimizationCycle: (id: string) => request(`/agent-optimization/cycles/${id}/revert`, { method: "POST" }),
  getLinkedinFunnel: () => request("/analytics/linkedin-funnel"),
  getRevenuePipeline: () => request("/analytics/revenue-pipeline"),
  getCohortTrends: (days = 30) => request(`/analytics/cohort-trends?days=${days}`),
  getAiInsights: () => request("/analytics/ai-insights", { method: "POST" }),
  getLatestAiInsights: () => request("/analytics/ai-insights/latest"),
  // Part: Lead Upload Analytics / Email Performance / Ignore Groups, 2026-09-01.
  getLeadUploadStats: (params: Record<string, string>) =>
    request(`/analytics/lead-uploads?${new URLSearchParams(params).toString()}`),
  getEmailPerformance: (params: Record<string, string>) =>
    request(`/analytics/email-performance?${new URLSearchParams(params).toString()}`),
  getFailureBreakdown: (params: Record<string, string>) =>
    request(`/analytics/failure-breakdown?${new URLSearchParams(params).toString()}`),
  getAnalyticsTrends: (params: Record<string, string>) =>
    request(`/analytics/trends?${new URLSearchParams(params).toString()}`),
  getUserBreakdown: (params: Record<string, string>) =>
    request(`/analytics/user-breakdown?${new URLSearchParams(params).toString()}`),
  getAgentHealth: (hours = 24) => request(`/agent-runs/health?hours=${hours}`),
  getRecentAgentRuns: (limit = 50) => request(`/agent-runs/recent?limit=${limit}`),
  getAgentFleet: () => request("/agents/fleet"),
  getCampaigns: () => request("/campaigns"),
  getCampaignPerformance: () => request("/campaigns/performance"),
  createCampaign: (body: Record<string, unknown>) =>
    request("/campaigns", { method: "POST", body: JSON.stringify(body) }),
  updateCampaign: (id: string, body: Record<string, unknown>) =>
    request(`/campaigns/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  getNotifications: (params: Record<string, string> = {}) =>
    request(`/notifications?${new URLSearchParams(params).toString()}`),
  getUnreadNotificationCount: () => request("/notifications/unread-count"),
  markNotificationRead: (id: string) => request(`/notifications/${id}/read`, { method: "PATCH" }),
  markAllNotificationsRead: (category?: string) =>
    request(`/notifications/read-all${category ? `?category=${category}` : ""}`, { method: "PATCH" }),
  dismissNotification: (id: string) => request(`/notifications/${id}`, { method: "DELETE" }),
  clearAllNotifications: (category?: string) =>
    request(`/notifications${category ? `?category=${category}` : ""}`, { method: "DELETE" }),
  getNotificationPreferences: () => request("/notifications/preferences"),
  updateNotificationPreferences: (body: Record<string, unknown>) =>
    request("/notifications/preferences", { method: "PATCH", body: JSON.stringify(body) }),
  sendTestDesktopNotification: () => request("/notifications/test-desktop", { method: "POST" }),
  getAutomationSettings: () => request("/settings/organization/automation"),
  updateAutomationSettings: (body: Record<string, unknown>) =>
    request("/settings/organization/automation", { method: "PATCH", body: JSON.stringify(body) }),
  // Part: Preparation Pipeline / Sending Queue, 2026-09-01.
  getSendingSchedule: () => request("/sending-schedule"),
  updateSendingSchedule: (body: Record<string, unknown>) =>
    request("/sending-schedule", { method: "PUT", body: JSON.stringify(body) }),
  getSendingQueueDashboard: () => request("/sending-schedule/dashboard"),
  getOrgBranding: () => request("/settings/organization/branding"),
  updateOrgBranding: (body: Record<string, unknown>) =>
    request("/settings/organization/branding", { method: "PATCH", body: JSON.stringify(body) }),
  // Part: Upwork Proposals, 2026-09-29.
  getUpworkProposals: (params: Record<string, string> = {}) =>
    request(`/upwork/proposals?${new URLSearchParams(params).toString()}`),
  getUpworkStats: () => request("/upwork/proposals/stats"),
  getUpworkPicklists: () => request("/upwork/proposals/picklists"),
  updateUpworkPicklists: (body: Record<string, string[]>) =>
    request("/upwork/proposals/picklists", { method: "PATCH", body: JSON.stringify(body) }),
  createUpworkProposal: (body: Record<string, unknown>) =>
    request("/upwork/proposals", { method: "POST", body: JSON.stringify(body) }),
  updateUpworkProposal: (id: string, body: Record<string, unknown>) =>
    request(`/upwork/proposals/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  deleteUpworkProposal: (id: string) => request(`/upwork/proposals/${id}`, { method: "DELETE" }),
  setUpworkNotifyRecipients: (id: string, body: { userIds: string[]; notifyNow?: boolean }) =>
    request(`/upwork/proposals/${id}/notify-recipients`, { method: "PATCH", body: JSON.stringify(body) }),
  // Part: Upwork Requests, 2026-10-01.
  getUpworkRequestProfiles: () => request("/upwork/requests/profiles"),
  getUpworkRequests: (params: Record<string, string> = {}) =>
    request(`/upwork/requests?${new URLSearchParams(params).toString()}`),
  getUpworkRequest: (id: string) => request(`/upwork/requests/${id}`),
  createUpworkRequest: (body: Record<string, unknown>) =>
    request("/upwork/requests", { method: "POST", body: JSON.stringify(body) }),
  updateUpworkRequest: (id: string, body: Record<string, unknown>) =>
    request(`/upwork/requests/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  submitUpworkRequest: (id: string) => request(`/upwork/requests/${id}/submit`, { method: "PATCH" }),
  reviewUpworkRequest: (id: string, body: { status: string; reviewNotes?: string }) =>
    request(`/upwork/requests/${id}/review`, { method: "PATCH", body: JSON.stringify(body) }),
  deleteUpworkRequest: (id: string) => request(`/upwork/requests/${id}`, { method: "DELETE" }),
  getUpworkWeeklyTarget: (params: Record<string, string> = {}) =>
    request(`/upwork/requests/weekly-target?${new URLSearchParams(params).toString()}`),
  getUpworkAchievement: (params: Record<string, string> = {}) =>
    request(`/upwork/requests/achievement?${new URLSearchParams(params).toString()}`),
  getUpworkRequestsDashboardSummary: (params: Record<string, string> = {}) =>
    request(`/upwork/requests/dashboard-summary?${new URLSearchParams(params).toString()}`),
  getCaseStudies: () => request("/settings/case-studies"),
  createCaseStudy: (body: { title?: string; rawStory: string; submittedIndustry: string }) =>
    request("/settings/case-studies", { method: "POST", body: JSON.stringify(body) }),
  retryCaseStudy: (id: string) => request(`/settings/case-studies/${id}/retry`, { method: "POST" }),
  deleteCaseStudy: (id: string) => request(`/settings/case-studies/${id}`, { method: "DELETE" }),
  getUsers: () => request("/users"),
  createUser: (body: Record<string, unknown>) =>
    request("/users", { method: "POST", body: JSON.stringify(body) }),
  activateUser: (id: string) => request(`/users/${id}/activate`, { method: "PATCH" }),
  deactivateUser: (id: string) => request(`/users/${id}/deactivate`, { method: "PATCH" }),
  deleteUser: (id: string) => request(`/users/${id}`, { method: "DELETE" }),
  changeUserRole: (id: string, role: string) => request(`/users/${id}/role/${role}`, { method: "PATCH" }),
  transferPrimaryAdmin: (id: string) => request(`/users/${id}/primary-admin`, { method: "PATCH" }),
  getMe: () => request("/users/me"),
  getUserAccess: (id: string) => request(`/users/${id}/access`),
  updateUserAccess: (id: string, body: Record<string, unknown>) =>
    request(`/users/${id}/access`, { method: "PATCH", body: JSON.stringify(body) }),
  getAuditLogs: (params: Record<string, string> = {}) =>
    request(`/admin/audit-logs?${new URLSearchParams(params).toString()}`),
  updateProfile: (body: {
    displayName?: string;
    jobTitle?: string;
    phone?: string;
    upworkChatReminderEnabled?: boolean;
    upworkChatReminderThresholdMinutes?: number;
  }) => request("/users/me/profile", { method: "PATCH", body: JSON.stringify(body) }),
  changePassword: (body: { currentPassword: string; newPassword: string; confirmPassword: string }) =>
    request("/users/me/password", { method: "POST", body: JSON.stringify(body) }),
  removeAvatar: () => request("/users/me/avatar", { method: "DELETE" }),
  uploadAvatar: async (file: File) => {
    const token = getAccessToken();
    const form = new FormData();
    form.append("file", file);
    const res = await fetch(`${API_BASE_URL}/users/me/avatar`, {
      method: "POST",
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: form,
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.message ?? `Upload failed with ${res.status}`);
    }
    return res.json();
  },

  // ---- Global search (Part: EBOS-inspired shell redesign round 2,
  // 2026-10-21) ----
  globalSearch: (q: string) =>
    request<{
      leads: { id: string; title: string; subtitle?: string; href: string }[];
      emails: { id: string; title: string; subtitle?: string; href: string }[];
      social: { id: string; title: string; subtitle?: string; href: string }[];
      upwork: { id: string; title: string; subtitle?: string; href: string }[];
    }>(`/search?${new URLSearchParams({ q }).toString()}`),

  // ---- AI chat assistant (Part: EBOS-inspired shell redesign round 2,
  // 2026-10-21) — stateless server-side, see AssistantService's own
  // docblock; `history` is the frontend's own in-memory conversation so far. ----
  sendAssistantMessage: (message: string, history?: { role: "user" | "assistant"; content: string }[]) =>
    request<{ reply: string }>("/assistant/message", {
      method: "POST",
      body: JSON.stringify({ message, history }),
    }),

  // ---- Email Hub ----
  getEmailHubAccounts: () => request("/email-hub/accounts"),
  getEmailHubStats: () => request("/email-hub/stats"),
  getEmailTags: () => request("/email-hub/tags"),
  getTrackedEmails: () => request("/email-hub/tracked-emails"),
  getIgnoredSenders: () =>
    request<
      {
        id: string;
        ruleType: "SENDER" | "DOMAIN";
        fromEmail: string | null;
        senderDomain: string | null;
        createdAt: string;
        createdByUserId: string | null;
        createdByName: string | null;
        count: number;
      }[]
    >("/email-hub/ignored-senders"),
  unignoreRule: (ruleId: string) => request(`/email-hub/ignored-senders/${ruleId}`, { method: "DELETE" }),
  createEmailTag: (body: { name: string; color?: string }) =>
    request("/email-hub/tags", { method: "POST", body: JSON.stringify(body) }),
  updateEmailTag: (id: string, body: { name?: string; color?: string }) =>
    request(`/email-hub/tags/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  deleteEmailTag: (id: string) => request(`/email-hub/tags/${id}`, { method: "DELETE" }),
  getEmailMessages: (params: Record<string, string> = {}) =>
    request(`/email-hub/messages?${new URLSearchParams(params).toString()}`),
  bulkEmailAction: (body: { messageIds: string[]; action: string; tagId?: string; ignoreScope?: "SENDER" | "DOMAIN" }) =>
    request("/email-hub/messages/bulk", { method: "POST", body: JSON.stringify(body) }),
  replyToEmail: (
    messageId: string,
    body: {
      bodyHtml: string;
      replyAll?: boolean;
      cc?: string[];
      bcc?: string[];
      attachments?: OutboundAttachmentInput[];
      trackOpen?: boolean;
      /** Send-from override — omit to send from the account that received
       *  the original message (the previous, only behavior). */
      accountId?: string;
    },
  ) => request(`/email-hub/messages/${messageId}/reply`, { method: "POST", body: JSON.stringify(body) }),
  composeEmail: (body: {
    accountId: string;
    to: string[];
    cc?: string[];
    bcc?: string[];
    subject: string;
    bodyHtml: string;
    attachments?: OutboundAttachmentInput[];
    trackOpen?: boolean;
  }) => request("/email-hub/compose", { method: "POST", body: JSON.stringify(body) }),
  getEmailThread: (id: string) => request(`/email-hub/threads/${id}`),
  addEmailThreadToLead: (id: string) => request(`/email-hub/threads/${id}/add-to-lead`, { method: "POST" }),
  getEmailAccountAccess: (accountId: string) => request(`/settings/email-accounts/${accountId}/access`),
  grantEmailAccountAccess: (accountId: string, body: { userId: string; canReply?: boolean }) =>
    request(`/settings/email-accounts/${accountId}/access`, { method: "POST", body: JSON.stringify(body) }),
  revokeEmailAccountAccess: (accountId: string, userId: string) =>
    request(`/settings/email-accounts/${accountId}/access/${userId}`, { method: "DELETE" }),

  // ---- Social Media ----
  getSocialCapabilities: () => request("/social-media/capabilities"),
  getSocialAccounts: () => request("/social-media/accounts"),
  getSocialStats: () => request("/social-media/stats"),
  getSocialAnalytics: (params: Record<string, string> = {}) =>
    request(`/social-media/analytics?${new URLSearchParams(params).toString()}`),
  getSocialAnalyticsHistory: (accountId: string) => request(`/social-media/analytics/accounts/${accountId}/history`),
  getAccountFeed: (accountId: string) => request(`/social-media/accounts/${accountId}/feed`),
  likeSocialFeedPost: (accountId: string, externalPostId: string) =>
    request(`/social-media/accounts/${accountId}/feed/${encodeURIComponent(externalPostId)}/like`, { method: "POST" }),
  getSocialPosts: (params: Record<string, string> = {}) =>
    request(`/social-media/posts?${new URLSearchParams(params).toString()}`),
  getSocialPost: (id: string) => request(`/social-media/posts/${id}`),
  createSocialPost: (body: Record<string, unknown>) =>
    request("/social-media/posts", { method: "POST", body: JSON.stringify(body) }),
  updateSocialPost: (id: string, body: Record<string, unknown>) =>
    request(`/social-media/posts/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  submitSocialPost: (id: string) => request(`/social-media/posts/${id}/submit`, { method: "POST" }),
  approveSocialPost: (id: string) => request(`/social-media/posts/${id}/approve`, { method: "POST" }),
  rejectSocialPost: (id: string, reason: string) =>
    request(`/social-media/posts/${id}/reject`, { method: "POST", body: JSON.stringify({ reason }) }),
  scheduleSocialPost: (id: string, scheduledAt?: string) =>
    request(`/social-media/posts/${id}/schedule`, { method: "POST", body: JSON.stringify({ scheduledAt }) }),
  unscheduleSocialPost: (id: string) => request(`/social-media/posts/${id}/unschedule`, { method: "POST" }),
  retrySocialPost: (id: string) => request(`/social-media/posts/${id}/retry`, { method: "POST" }),
  deleteSocialPost: (id: string) => request(`/social-media/posts/${id}`, { method: "DELETE" }),
  generateSocialContent: (body: Record<string, unknown>) =>
    request("/social-media/generate", { method: "POST", body: JSON.stringify(body) }),

  getSocialMedia: (folderId?: string) => request(`/social-media/media${folderId ? `?folderId=${folderId}` : ""}`),
  uploadSocialMedia: async (file: File, folderId?: string) => {
    const token = getAccessToken();
    const form = new FormData();
    form.append("file", file);
    if (folderId) form.append("folderId", folderId);
    const res = await fetch(`${API_BASE_URL}/social-media/media`, {
      method: "POST",
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: form,
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.message ?? `Upload failed with ${res.status}`);
    }
    return res.json();
  },
  deleteSocialMedia: (id: string) => request(`/social-media/media/${id}`, { method: "DELETE" }),
  getSocialMediaFolders: () => request("/social-media/media-folders"),
  createSocialMediaFolder: (body: { name: string; parentId?: string }) =>
    request("/social-media/media-folders", { method: "POST", body: JSON.stringify(body) }),

  getSocialHashtagGroups: () => request("/social-media/hashtag-groups"),
  createSocialHashtagGroup: (body: { name: string; hashtags: string[] }) =>
    request("/social-media/hashtag-groups", { method: "POST", body: JSON.stringify(body) }),
  updateSocialHashtagGroup: (id: string, body: { name?: string; hashtags?: string[] }) =>
    request(`/social-media/hashtag-groups/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  deleteSocialHashtagGroup: (id: string) => request(`/social-media/hashtag-groups/${id}`, { method: "DELETE" }),

  getSocialTemplates: () => request("/social-media/templates"),
  createSocialTemplate: (body: { name: string; category: string; bodyTemplate: string }) =>
    request("/social-media/templates", { method: "POST", body: JSON.stringify(body) }),
  updateSocialTemplate: (id: string, body: { name?: string; category?: string; bodyTemplate?: string }) =>
    request(`/social-media/templates/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  deleteSocialTemplate: (id: string) => request(`/social-media/templates/${id}`, { method: "DELETE" }),

  getSocialAutomations: () => request("/social-media/automations"),
  createSocialAutomation: (body: Record<string, unknown>) =>
    request("/social-media/automations", { method: "POST", body: JSON.stringify(body) }),
  updateSocialAutomation: (id: string, body: Record<string, unknown>) =>
    request(`/social-media/automations/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  deleteSocialAutomation: (id: string) => request(`/social-media/automations/${id}`, { method: "DELETE" }),
  getSocialAutomationRuns: (id: string) => request(`/social-media/automations/${id}/runs`),

  // ---- Social Media Settings ----
  getSocialSettingsAccounts: () => request("/settings/social-media/accounts"),
  createSocialAccount: (body: { platform: string; username: string; displayName?: string }) =>
    request("/settings/social-media/accounts", { method: "POST", body: JSON.stringify(body) }),
  updateSocialAccountSettings: (id: string, body: Record<string, unknown>) =>
    request(`/settings/social-media/accounts/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  disconnectSocialAccount: (id: string) => request(`/settings/social-media/accounts/${id}/disconnect`, { method: "POST" }),
  deleteSocialAccount: (id: string) => request(`/settings/social-media/accounts/${id}`, { method: "DELETE" }),
  subscribeSocialAccountWebhook: (id: string) => request(`/settings/social-media/accounts/${id}/subscribe-webhook`, { method: "POST" }),
  syncSocialInboxAccountNow: (id: string) => request(`/social-inbox/accounts/${id}/sync`, { method: "POST" }),
  connectSocialAccount: (platform: string, oauthAppId?: string) =>
    request<{ url: string }>(`/settings/social-media/accounts/${platform}/connect`, {
      method: "POST",
      body: JSON.stringify({ oauthAppId }),
    }),
  getSocialOAuthApps: (platform?: string) =>
    request(`/settings/social-media/oauth-apps${platform ? `?platform=${platform}` : ""}`),
  createSocialOAuthApp: (body: { platform: string; name: string; clientId: string; clientSecret: string }) =>
    request("/settings/social-media/oauth-apps", { method: "POST", body: JSON.stringify(body) }),
  deleteSocialOAuthApp: (id: string) => request(`/settings/social-media/oauth-apps/${id}`, { method: "DELETE" }),
  getPendingSocialSelection: (pendingId: string) => request(`/settings/social-media/accounts/pending/${pendingId}`),
  selectPendingSocialAccount: (pendingId: string, externalAccountId: string) =>
    request(`/settings/social-media/accounts/pending/${pendingId}/select`, {
      method: "POST",
      body: JSON.stringify({ externalAccountId }),
    }),
  getSocialAccountAccess: (accountId: string) => request(`/settings/social-media/accounts/${accountId}/access`),
  grantSocialAccountAccess: (accountId: string, body: { userId: string; canView?: boolean; canPublish?: boolean; canApprove?: boolean }) =>
    request(`/settings/social-media/accounts/${accountId}/access`, { method: "POST", body: JSON.stringify(body) }),
  revokeSocialAccountAccess: (accountId: string, userId: string) =>
    request(`/settings/social-media/accounts/${accountId}/access/${userId}`, { method: "DELETE" }),

  // ---- Social Inbox (Unified DM Monitoring) ----
  getSocialInboxStats: () => request("/social-inbox/stats"),
  getSocialInboxConversations: (params: Record<string, string> = {}) =>
    request(`/social-inbox/conversations?${new URLSearchParams(params).toString()}`),
  getSocialInboxConversation: (id: string) => request(`/social-inbox/conversations/${id}`),
  updateSocialInboxConversation: (id: string, body: { status?: string; assignedToUserId?: string }) =>
    request(`/social-inbox/conversations/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  replySocialInboxConversation: (id: string, text: string) =>
    request(`/social-inbox/conversations/${id}/reply`, { method: "POST", body: JSON.stringify({ text }) }),
  startSocialConversation: (accountId: string, to: string, text: string) =>
    request(`/social-inbox/accounts/${accountId}/start`, { method: "POST", body: JSON.stringify({ to, text }) }),
  createSocialInboxNote: (id: string, note: string) =>
    request(`/social-inbox/conversations/${id}/notes`, { method: "POST", body: JSON.stringify({ note }) }),
  updateSocialInboxNote: (id: string, noteId: string, note: string) =>
    request(`/social-inbox/conversations/${id}/notes/${noteId}`, { method: "PATCH", body: JSON.stringify({ note }) }),
  deleteSocialInboxNote: (id: string, noteId: string) =>
    request(`/social-inbox/conversations/${id}/notes/${noteId}`, { method: "DELETE" }),

  // ---- Social Engagement Center (comments on our own posts) ----
  getSocialEngagementStats: () => request("/social-engagement/stats"),
  syncSocialEngagementAccountNow: (accountId: string) => request(`/social-engagement/accounts/${accountId}/sync`, { method: "POST" }),
  // Post-centric (Part: Social Hub Engagement post-centric redesign,
  // 2026-09-07) -- one row per post with comments, real post content
  // fetched only when a specific post is opened. Preferred over the flat
  // comments/comment-detail pair below, which stay for other uses
  // (assignment queries, stats) rather than as the primary browsing UI.
  getSocialEngagementPosts: (params: Record<string, string> = {}) =>
    request(`/social-engagement/posts?${new URLSearchParams(params).toString()}`),
  getSocialEngagementPost: (accountId: string, postId: string) =>
    request(`/social-engagement/accounts/${accountId}/posts/${encodeURIComponent(postId)}`),
  getSocialEngagementComments: (params: Record<string, string> = {}) =>
    request(`/social-engagement/comments?${new URLSearchParams(params).toString()}`),
  getSocialEngagementComment: (id: string) => request(`/social-engagement/comments/${id}`),
  updateSocialEngagementComment: (id: string, body: { status?: string; assignedToUserId?: string }) =>
    request(`/social-engagement/comments/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  replySocialEngagementComment: (id: string, text: string) =>
    request(`/social-engagement/comments/${id}/reply`, { method: "POST", body: JSON.stringify({ text }) }),
  likeSocialEngagementComment: (id: string) => request(`/social-engagement/comments/${id}/like`, { method: "POST" }),

  // ---- Meta Ads ----
  getMetaAdsOAuthUrl: () => request("/meta-ads/oauth/url") as Promise<{ url: string }>,
  getMetaAdsPendingSelection: (pendingId: string) => request(`/meta-ads/pending/${pendingId}`),
  selectMetaAdAccounts: (pendingId: string, externalAccountIds: string[]) =>
    request("/meta-ads/accounts/select", { method: "POST", body: JSON.stringify({ pendingId, externalAccountIds }) }),
  getMetaAdsAccounts: () => request("/meta-ads/accounts"),
  disconnectMetaAdAccount: (id: string) => request(`/meta-ads/accounts/${id}`, { method: "DELETE" }),
  syncMetaAdAccount: (id: string) => request(`/meta-ads/accounts/${id}/sync`, { method: "POST" }),
  getMetaAdsOverview: (accountId: string, params: Record<string, string> = {}) =>
    request(`/meta-ads/accounts/${accountId}/overview?${new URLSearchParams(params).toString()}`),
  getMetaAdsTimeseries: (accountId: string, params: Record<string, string> = {}) =>
    request(`/meta-ads/accounts/${accountId}/timeseries?${new URLSearchParams(params).toString()}`),
  getMetaAdsCampaigns: (accountId: string, params: Record<string, string> = {}) =>
    request(`/meta-ads/accounts/${accountId}/campaigns?${new URLSearchParams(params).toString()}`),
  getMetaAdsAdSets: (accountId: string, params: Record<string, string> = {}) =>
    request(`/meta-ads/accounts/${accountId}/adsets?${new URLSearchParams(params).toString()}`),
  getMetaAdsAds: (accountId: string, params: Record<string, string> = {}) =>
    request(`/meta-ads/accounts/${accountId}/ads?${new URLSearchParams(params).toString()}`),

  // ---- Upwork API integration (gated by upworkApiAccess module flag) ----
  getUpworkApiCallbackUrl: () => request("/upwork-api/callback-url") as Promise<{ callbackUrl: string }>,
  getUpworkApiOAuthUrl: () => request("/upwork-api/connect") as Promise<{ url: string }>,
  getUpworkApiStatus: () => request("/upwork-api/status"),
  disconnectUpworkApi: () => request("/upwork-api/connection", { method: "DELETE" }),
  // Manual organization-ID override (Part: Upwork API integration,
  // 2026-10-22) — Upwork's automatic org-detection is blocked by a scope
  // this app doesn't have, so every call defaults to the authenticating
  // user's personal account unless this is set explicitly. Validates the
  // ID live against Upwork and returns its real name, or throws with
  // Upwork's own error if it's wrong.
  setUpworkApiOrganizationId: (organizationId: string) =>
    request<{ organizationId: string; organizationName: string }>("/upwork-api/organization-id", {
      method: "PUT",
      body: JSON.stringify({ organizationId }),
    }),
  // Organization & Agency (Part: Upwork API integration — Organization
  // domain, 2026-10-23). company/staffs are null + companyDetailsAvailable
  // false when blocked by a missing Upwork scope -- never fabricated.
  getUpworkApiAgencyProfile: () =>
    request<{
      profile: {
        id: string;
        rid: string | null;
        legacyId: string | null;
        name: string | null;
        type: "BUSINESS" | "SOLE_PROPRIETOR" | null;
        legacyType: "CLIENT" | "VENDOR" | null;
        active: boolean | null;
        hidden: boolean | null;
        photoUrl: string | null;
        creationDate: string | null;
        flag: { client: boolean; vendor: boolean; agency: boolean; individual: boolean } | null;
        parentOrganization: { id: string; name: string | null } | null;
      };
      companyDetails: {
        id: string;
        name: string | null;
        description: string | null;
        displayName: string | null;
        logoURL: string | null;
        companyName: string | null;
        country: { name: string | null } | null;
        state: string | null;
        city: string | null;
        zip: string | null;
        timezone: string | null;
        billingType: string | null;
        summary: string | null;
        staffsTotalCount: number | null;
      } | null;
      companyDetailsAvailable: boolean;
      companyDetailsLimitation: string | null;
    }>("/upwork-api/agency-profile"),
  updateUpworkApiOrganization: (input: { organizationName: string; hidden?: boolean; vatId?: string; phoneNumber?: string; timezone?: string }) =>
    request<{ id: string | null; success: boolean }>("/upwork-api/organization", {
      method: "PUT",
      body: JSON.stringify(input),
    }),
  // Common Entities (Part: Upwork API integration — Common Entities domain,
  // 2026-10-23) -- static Upwork reference data, 24h server-side cache.
  getUpworkApiCommonEntities: () =>
    request<{
      countries: { id: string; name: string; twoLetterAbbreviation: string | null; threeLetterAbbreviation: string | null; region: string; phoneCode: string | null; active: boolean | null }[];
      languages: { iso639Code: string; englishName: string; active: boolean }[];
      regions: { id: string; name: string; parentRegion: { id: string; name: string } | null }[];
      cachedAt: string;
    }>("/upwork-api/common-entities"),
  // Transactions & Financial History (Part: Upwork API integration —
  // Transactions domain, 2026-10-23).
  getUpworkApiTransactions: () =>
    request<{
      totalCount: number;
      countBySubtype: { subtype: string | null; currency: string | null; count: number }[];
      recent: {
        id: string;
        occurredAt: string | null;
        type: string | null;
        accountingSubtype: string | null;
        description: string | null;
        amountDisplay: string | null;
        amountCurrency: string | null;
        paymentStatus: string | null;
      }[];
    }>("/upwork-api/transactions"),
  // Work History (Part: Upwork API integration — Work History domain,
  // 2026-10-23) -- scoped to freelancers with a verified agency
  // relationship (proposal/invite history), never a blanket personal pull.
  getUpworkApiWorkHistory: () =>
    request<{
      totalCount: number;
      freelancerCount: number;
      recent: {
        id: string;
        freelancerName: string | null;
        title: string | null;
        status: string | null;
        startDate: string | null;
        endDate: string | null;
        totalCharge: string | null;
        totalHours: string | null;
        feedbackToFreelancerScore: number | null;
        feedbackToClientScore: number | null;
      }[];
    }>("/upwork-api/work-history"),
  // Agency Tools (Part: Upwork API integration — companySelector/Talent
  // Search/Work Diary/Team Invite, 2026-10-23) — primary-admin only.
  getUpworkApiOrganizations: () =>
    request<{ title: string; organizationId: string; organizationRid: string | null; organizationType: string | null; organizationLegacyType: string | null }[]>(
      "/upwork-api/agency-tools/organizations",
    ),
  searchUpworkTalent: (keyword: string, after?: string | null) => {
    const params = new URLSearchParams({ keyword });
    if (after) params.set("after", after);
    return request<{
      totalCount: number;
      endCursor: string | null;
      hasNextPage: boolean;
      results: { shortName: string | null; ciphertext: string | null }[];
    }>(`/upwork-api/agency-tools/talent-search?${params.toString()}`);
  },
  listUpworkWorkDiaryContracts: () =>
    request<{ upworkContractId: string; title: string | null; freelancerName: string | null; status: string | null }[]>(
      "/upwork-api/agency-tools/work-diary/contracts",
    ),
  getUpworkWorkDiary: (contractId: string, date: string) =>
    request<{
      workDiaryMetadata: { timezoneOffset: string } | null;
      workDiaryTimeCells: {
        cellDateTime: { displayValue: string } | null;
        activityLevel: number | null;
        memo: string | null;
        hasScreenshot: boolean | null;
        screenshotImageUrlMedium: string | null;
        task: { description: string | null } | null;
      }[];
    }>(`/upwork-api/agency-tools/work-diary?contractId=${encodeURIComponent(contractId)}&date=${encodeURIComponent(date)}`),
  inviteUpworkTeamMember: (body: { email: string; targetOrganizationId: string; landingUrl: string }) =>
    request<{
      succeeded: { id: string; token: string | null }[];
      failed: { code: string | null; message: string | null; invitation: { username: string | null } | null }[];
    }>("/upwork-api/agency-tools/invite-to-team", { method: "POST", body: JSON.stringify(body) }),
  // Freelancer Profiles (spec Module H).
  getUpworkApiFreelancerProfiles: () =>
    request<{
      totalCount: number;
      profiles: {
        id: string;
        freelancerUserId: string;
        freelancerName: string | null;
        topRatedStatus: string | null;
        totalEarnings: number | null;
        totalJobs: number | null;
        totalFeedback: number | null;
        lastWorkedOn: string | null;
        skills: string[];
      }[];
    }>("/upwork-api/freelancer-profiles"),
  // Marketplace Job Postings + Job Details (spec Modules G + S).
  getUpworkApiMarketplaceJobs: (q?: string, after?: string, first?: number) => {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (after) params.set("after", after);
    if (first) params.set("first", String(first));
    const qs = params.toString();
    return request<{
      totalCount: number | null;
      dataScope: string;
      pageInfo: { endCursor: string | null; hasNextPage: boolean };
      jobs: {
        id: string;
        title: string;
        description: string;
        category: string | null;
        subcategory: string | null;
        experienceLevel: string | null;
        duration: string | null;
        durationLabel: string | null;
        engagement: string | null;
        engagementWeeks: number | null;
        recordNumber: string;
        ciphertext: string;
        freelancersToHire: number;
        enterprise: boolean;
        premium: boolean;
        applied: boolean;
        createdDateTime: string;
        publishedDateTime: string;
        renewedDateTime: string | null;
        totalApplicants: number;
        preferredFreelancerLocation: string[];
        preferredFreelancerLocationMandatory: boolean;
        jobType: "FIXED" | "HOURLY";
        budgetDisplay: string | null;
        fixedAmount: string | null;
        fixedAmountRaw: number | null;
        hourlyBudgetType: string | null;
        hourlyBudgetMin: string | null;
        hourlyBudgetMinRaw: number | null;
        hourlyBudgetMax: string | null;
        hourlyBudgetMaxRaw: number | null;
        weeklyBudget: string | null;
        skills: { name: string; prettyName: string; highlighted: boolean }[];
        client: {
          totalHires: number;
          totalPostedJobs: number;
          totalReviews: number;
          totalFeedback: number;
          verificationStatus: string | null;
          hasFinancialPrivacy: boolean;
          totalSpentDisplay: string | null;
          country: string | null;
        };
        activity: {
          invitesSent: number;
          totalInvitedToInterview: number;
          totalHired: number;
          totalUnansweredInvites: number;
          totalOffered: number;
          lastClientActivity: string | null;
          avgBidRate: string | null;
          minBidRate: string | null;
          maxBidRate: string | null;
        } | null;
      }[];
    }>(`/upwork-api/marketplace-jobs${qs ? `?${qs}` : ""}`);
  },
  getUpworkApiMarketplaceJobClientInsights: (jobId: string) =>
    request<
      | { available: false }
      | {
          available: true;
          avgHourlyRate: string | null;
          totalAssignments: number | null;
          activeAssignments: number | null;
          totalJobsWithHires: number | null;
          hiredInPast: boolean | null;
          feedbackCount: number | null;
          score: number | null;
          jobsFilled: number | null;
          jobsOpen: number | null;
          jobsPosted: number | null;
          projectType: string | null;
          talentType: string | null;
          preferredCountries: string[];
          minHoursPerWeek: number | null;
          minJobSuccessScore: number | null;
          shouldHavePortfolio: boolean;
          risingTalent: boolean;
          workHistoryCounts: { ongoingHourly: number; ongoingFixed: number; completedHourly: number; completedFixed: number; other: number };
          workHistorySampleSize: number;
        }
    >(`/upwork-api/marketplace-jobs/${jobId}/client-insights`),
  // Ontology & Reference Data (spec Module F).
  getUpworkApiOntology: () =>
    request<{
      categories: { id: string; preferredLabel: string }[];
      skills: { id: string; ontologyId: string; preferredLabel: string; definition: string | null }[];
      cachedAt: string;
    }>("/upwork-api/ontology"),
  // Contract Proposals (spec Module L), read-only.
  getUpworkApiContractProposals: (page = 1) =>
    request<{
      totalCount: number;
      page: number;
      contracts: { id: string; referenceContractRid: string | null; createdDate: string | null; jobTitle: string | null; clientName: string | null }[];
    }>(`/upwork-api/contract-proposals?page=${page}`),
  // Submit Proposals to Jobs (spec Module Q) -- real mutation, real
  // Connects spend. Requires confirmed: true after explicit user review.
  submitUpworkApiProposal: (input: {
    confirmed: boolean;
    selectedContractorId: string;
    oDeskUserID: string;
    jobReference: string;
    chargedAmount: number;
    coverLetter: string;
    occupationId?: string;
    estimatedDuration?: number;
    questions?: { question: string; answer: string }[];
    attachments?: string[];
  }) =>
    request<{ newProposalId: string | null; status: string | null; error: string | null }>("/upwork-api/submit-proposal", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  // Agency Overview (Part: Upwork API integration — Agency Overview
  // domain, 2026-10-23) -- pure composition of already-verified domain
  // services, adds no new Upwork API calls of its own.
  getUpworkApiAgencyOverview: () =>
    request<{
      connected: boolean;
      status: string;
      organizationName?: string | null;
      lastSyncAt?: string | null;
      lastSyncError?: string | null;
      agencyFlag?: { client: boolean; vendor: boolean; agency: boolean; individual: boolean } | null;
      connects?: { balance?: number; unavailable?: boolean; reason?: string };
      proposals?: { totalCount?: number; unavailable?: boolean; reason?: string };
      invites?: { totalCount?: number; unavailable?: boolean; reason?: string };
      transactions?: { totalCount?: number; unavailable?: boolean; reason?: string };
      workHistory?: { totalCount?: number; freelancerCount?: number; unavailable?: boolean; reason?: string };
      freelancerProfiles?: { totalCount?: number; unavailable?: boolean; reason?: string };
      rooms?: { totalCount?: number; totalUnread?: number; unavailable?: boolean; reason?: string };
      contracts?: { unavailable: boolean; reason: string };
      offers?: { unavailable: boolean; reason: string };
      timesheets?: { unavailable: boolean; reason: string };
      snapshots?: { unavailable: boolean; reason: string };
      activity?: { unavailable: boolean; reason: string };
      clientProposals?: { unavailable: boolean; reason: string };
    }>("/upwork-api/agency-overview"),
  // Rooms & Messages (Part: Upwork API integration — Rooms & Messages
  // domain, 2026-10-23) -- read-only, no send-message capability.
  getUpworkApiRooms: () =>
    request<{
      totalCount: number;
      totalUnread: number;
      rooms: {
        id: string;
        roomName: string | null;
        roomType: string | null;
        numUsers: number | null;
        numUnread: number | null;
        latestMessage: string | null;
        latestMessageAt: string | null;
        latestMessageFrom: string | null;
      }[];
    }>("/upwork-api/rooms"),
  resyncUpworkApiRooms: () => request<{ resynced: boolean }>("/upwork-api/rooms/resync", { method: "POST" }),
  getUpworkApiRoomMessages: (roomId: string) =>
    request<{
      roomId: string;
      roomName: string | null;
      messages: { id: string; message: string | null; senderName: string | null; senderIsAgency: boolean; createdAt: string }[];
    }>(`/upwork-api/rooms/${roomId}/messages`),
  markUpworkApiRoomRead: (roomId: string) => request<{ read: boolean }>(`/upwork-api/rooms/${roomId}/mark-read`, { method: "POST" }),
  getUpworkApiDelayedResponses: () =>
    request<{
      totalCount: number;
      rooms: {
        id: string;
        roomName: string | null;
        roomType: string | null;
        numUsers: number | null;
        numUnread: number | null;
        latestMessage: string | null;
        latestMessageAt: string | null;
        latestMessageFrom: string | null;
        minutesPending: number | null;
      }[];
    }>("/upwork-api/rooms-delayed"),
  // Connects usage (Part: Upwork API integration — Connects usage domain,
  // 2026-10-22) — the first of the 7 data domains backed by real synced
  // data instead of a "not live yet" error.
  getUpworkApiConnectsUsage: () =>
    request<{
      current: { connectsBalance: number; rolloverBalance: number; connectsBalanceFree: number; connectsBalancePaid: number; capturedAt: string } | null;
      history: { capturedAt: string; connectsBalance: number }[];
      recentTransactions: {
        id: string;
        occurredAt: string;
        transactionType: "CREDIT" | "DEBIT" | "REFUND_CREDIT";
        reason: string | null;
        amountDisplay: string;
        jobId: string | null;
        jobTitle: string | null;
      }[];
    }>("/upwork-api/connects-usage"),
  // Bidding/proposals (Part: Upwork API integration — Bidding/proposals
  // domain, 2026-10-22) — second of the 7 data domains backed by real
  // synced data.
  getUpworkApiProposals: () =>
    request<{
      countByStatus: Record<string, number>;
      totalCount: number;
      recent: {
        id: string;
        jobTitle: string | null;
        freelancerName: string | null;
        status: string;
        statusReason: string | null;
        chargeRateDisplay: string | null;
        viewedByClient: boolean | null;
        upworkCreatedAt: string | null;
        upworkModifiedAt: string | null;
      }[];
    }>("/upwork-api/proposals"),
  // Invites (Part: Upwork API integration — Invites domain, 2026-10-22) —
  // deliberately a SEPARATE endpoint/dataset from proposals above, per
  // explicit user requirement ("I want them separate, bids and invites
  // separately").
  getUpworkApiInvites: () =>
    request<{
      countByStatus: Record<string, number>;
      totalCount: number;
      recent: {
        id: string;
        context: "Freelancer" | "Agency" | null;
        jobTitle: string | null;
        clientName: string | null;
        freelancerName: string | null;
        status: string | null;
        invitationLetter: string | null;
        acceptanceDuration: string | null;
        upfrontPaymentPct: number | null;
        upworkCreatedAt: string | null;
        upworkModifiedAt: string | null;
      }[];
    }>("/upwork-api/invites"),

  // ---- Upwork Proposal Writing (gated by upworkProposalWritingAccess module flag) ----
  generateUpworkCoverLetter: (
    jobUrl: string,
    manual?: {
      manualTitle?: string;
      manualDescription?: string;
      manualBudget?: string;
      manualClientCountry?: string;
      manualClientTotalSpent?: string;
      manualPostedMinutesAgo?: number;
      knownClientName?: string;
    },
    extractedJob?: {
      title?: string;
      description?: string;
      postedAt?: string;
      facts?: Record<string, string>;
      client?: Record<string, string>;
      skills?: string[];
    },
  ) =>
    request("/upwork-proposal-writing/generate", {
      method: "POST",
      body: JSON.stringify({ jobUrl, ...manual, ...(extractedJob ? { extractedJob } : {}) }),
    }),
  getUpworkProposalWritingDrafts: () => request("/upwork-proposal-writing/drafts"),
  getUpworkProposalWritingSettings: () => request("/upwork-proposal-writing/settings"),
  updateUpworkProposalWritingSettings: (body: {
    agencyBackground?: string;
    instructions?: string;
    technicalWordLimit?: number;
    nonTechnicalWordLimit?: number;
    excludedCountries?: string[];
    newClientWindowMonths?: number;
    minHiresPerYear?: number;
  }) => request("/upwork-proposal-writing/settings", { method: "PUT", body: JSON.stringify(body) }),
  getUpworkFreelancerProfiles: () => request("/upwork-proposal-writing/freelancer-profiles"),
  createUpworkFreelancerProfile: (body: { name: string; niche: string }) =>
    request("/upwork-proposal-writing/freelancer-profiles", { method: "POST", body: JSON.stringify(body) }),
  updateUpworkFreelancerProfile: (id: string, body: { name?: string; niche?: string; active?: boolean }) =>
    request(`/upwork-proposal-writing/freelancer-profiles/${id}`, { method: "PUT", body: JSON.stringify(body) }),
  deleteUpworkFreelancerProfile: (id: string) =>
    request(`/upwork-proposal-writing/freelancer-profiles/${id}`, { method: "DELETE" }),
  getUpworkDiscoveredJobs: () => request("/upwork-proposal-writing/discovered-jobs"),
  ingestUpworkDiscoveredJobs: (jobs: unknown[]) =>
    request("/upwork-proposal-writing/discovered-jobs/ingest", { method: "POST", body: JSON.stringify({ jobs }) }),

  // ---- Invite Proposal Writing (same upworkProposalWritingAccess flag) ----
  generateUpworkInviteCoverLetter: (inviteText: string, knownClientName?: string) =>
    request("/upwork-proposal-writing/generate-invite", {
      method: "POST",
      body: JSON.stringify({ inviteText, knownClientName: knownClientName || undefined }),
    }),
  getUpworkInviteProposalDrafts: () => request("/upwork-proposal-writing/invite-drafts"),

  // ---- Dashboard Center (Part: Dashboard Center, 2026-09-30) ----
  getDashboardOverview: (params: Record<string, string> = {}) =>
    request(`/dashboard-center/overview?${new URLSearchParams(params).toString()}`),
  getDashboardLeadsKpis: (params: Record<string, string> = {}) =>
    request(`/dashboard-center/leads/kpis?${new URLSearchParams(params).toString()}`),
  getDashboardLeadsSources: (params: Record<string, string> = {}) =>
    request(`/dashboard-center/leads/source-breakdown?${new URLSearchParams(params).toString()}`),
  getDashboardLeadsNiches: (params: Record<string, string> = {}) =>
    request(`/dashboard-center/leads/niche-breakdown?${new URLSearchParams(params).toString()}`),
  getDashboardLeadsAudit: (params: Record<string, string> = {}) =>
    request(`/dashboard-center/leads/audit?${new URLSearchParams(params).toString()}`),

  getDashboardEmailKpis: (params: Record<string, string> = {}) =>
    request(`/dashboard-center/email/kpis?${new URLSearchParams(params).toString()}`),
  getDashboardEmailQueue: () => request("/dashboard-center/email/queue"),
  getDashboardEmailSessions: () => request("/dashboard-center/email/sessions"),
  getDashboardEmailStageFunnel: () => request("/dashboard-center/email/stage-funnel"),
  getDashboardEmailTimeseries: (params: Record<string, string> = {}) =>
    request(`/dashboard-center/email/timeseries?${new URLSearchParams(params).toString()}`),

  getDashboardInboxAccounts: (params: Record<string, string> = {}) =>
    request(`/dashboard-center/inbox/accounts?${new URLSearchParams(params).toString()}`),
  getDashboardInboxVolume: (params: Record<string, string> = {}) =>
    request(`/dashboard-center/inbox/volume?${new URLSearchParams(params).toString()}`),
  getDashboardInboxLeadsFromEmail: (params: Record<string, string> = {}) =>
    request(`/dashboard-center/inbox/leads-from-email?${new URLSearchParams(params).toString()}`),

  getDashboardSocialKpis: (params: Record<string, string> = {}) =>
    request(`/dashboard-center/social/kpis?${new URLSearchParams(params).toString()}`),
  getDashboardSocialPlatforms: (params: Record<string, string> = {}) =>
    request(`/dashboard-center/social/platforms?${new URLSearchParams(params).toString()}`),
  getDashboardSocialTeam: (params: Record<string, string> = {}) =>
    request(`/dashboard-center/social/team?${new URLSearchParams(params).toString()}`),

  getDashboardUpworkKpis: (params: Record<string, string> = {}) =>
    request(`/dashboard-center/upwork/kpis?${new URLSearchParams(params).toString()}`),
  getDashboardUpworkMonthly: () => request("/dashboard-center/upwork/monthly"),
  getDashboardUpworkSubmitters: (params: Record<string, string> = {}) =>
    request(`/dashboard-center/upwork/submitters?${new URLSearchParams(params).toString()}`),
  getDashboardUpworkConnectPurchases: () => request("/dashboard-center/upwork/connect-purchases"),
  createDashboardUpworkConnectPurchase: (body: { purchasedAt: string; connectsAmount: number; totalCost: number; currency?: string; notes?: string }) =>
    request("/dashboard-center/upwork/connect-purchases", { method: "POST", body: JSON.stringify(body) }),
  deleteDashboardUpworkConnectPurchase: (id: string) =>
    request(`/dashboard-center/upwork/connect-purchases/${id}`, { method: "DELETE" }),
  importDashboardUpworkConnectPurchases: (csv: string) =>
    request("/dashboard-center/upwork/connect-purchases/import", { method: "POST", body: JSON.stringify({ csv }) }) as Promise<{
      rowsInFile: number;
      connectRowsFound: number;
      imported: number;
      alreadyImported: number;
      skipped: { row: number; reason: string }[];
    }>,

  getDashboardPipelineFunnel: () => request("/dashboard-center/pipeline/funnel"),
  getDashboardPipelineStageTiming: () => request("/dashboard-center/pipeline/stage-timing"),
  getDashboardPipelineAging: () => request("/dashboard-center/pipeline/aging"),

  getDashboardTeamPerformance: (params: Record<string, string> = {}) =>
    request(`/dashboard-center/team/performance?${new URLSearchParams(params).toString()}`),

  getDashboardActivity: (params: Record<string, string> = {}) =>
    request(`/dashboard-center/activity?${new URLSearchParams(params).toString()}`),

  getDashboardBenchmarks: () => request("/dashboard-center/benchmarks"),
  setDashboardBenchmark: (metricKey: string, targetValue: number) =>
    request("/dashboard-center/benchmarks", { method: "POST", body: JSON.stringify({ metricKey, targetValue }) }),
  deleteDashboardBenchmark: (metricKey: string) =>
    request(`/dashboard-center/benchmarks/${encodeURIComponent(metricKey)}`, { method: "DELETE" }),
};
