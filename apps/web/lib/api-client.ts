const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000/api/v1";

const ACCESS_KEY = "accessToken";
const REFRESH_KEY = "refreshToken";

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn?: number;
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
  role: "ADMIN" | "MANAGER" | "LEAD_REVIEWER" | "SALES_REP" | "VIEWER";
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
  resendEmail: (id: string, emailMessageId: string) =>
    request(`/leads/${id}/emails/${emailMessageId}/resend`, { method: "POST" }),
  approveEmail: (id: string, body: Record<string, unknown>) =>
    request(`/leads/${id}/approve-email`, { method: "POST", body: JSON.stringify(body) }),
  createManualLead: (body: Record<string, unknown>) =>
    request("/leads/manual", { method: "POST", body: JSON.stringify(body) }),
  previewLeadImport: (csv: string) =>
    request("/leads/import/preview", { method: "POST", body: JSON.stringify({ csv }) }),
  importLeads: (csv: string, mapping: Record<string, string | null>) =>
    request("/leads/import", { method: "POST", body: JSON.stringify({ csv, mapping }) }),
  deleteLead: (id: string) => request(`/leads/${id}`, { method: "DELETE" }),
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
  getUpcomingSends: () => request("/sequences/upcoming"),
  getSendQueue: () => request("/sequences/send-queue"),
  getEmailAccounts: () => request("/settings/email-accounts"),
  getEmailAccountsHealth: () => request("/settings/email-accounts/health"),
  createEmailAccount: (body: Record<string, unknown>) =>
    request("/settings/email-accounts", { method: "POST", body: JSON.stringify(body) }),
  updateEmailAccount: (id: string, body: Record<string, unknown>) =>
    request(`/settings/email-accounts/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  testEmailAccount: (id: string) => request(`/settings/email-accounts/${id}/test`, { method: "POST" }),
  reconcileStuckEmails: () => request("/settings/email-accounts/reconcile-stuck", { method: "POST" }),
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
  deleteEmailAccount: (id: string) => request(`/settings/email-accounts/${id}`, { method: "DELETE" }),
  getEmailFunnel: () => request("/analytics/email-funnel"),
  getEmailList: (event: "OPENED" | "REPLIED") => request(`/analytics/emails?event=${event}`),
  getLinkedinFunnel: () => request("/analytics/linkedin-funnel"),
  getRevenuePipeline: () => request("/analytics/revenue-pipeline"),
  getCohortTrends: (days = 30) => request(`/analytics/cohort-trends?days=${days}`),
  getAiInsights: () => request("/analytics/ai-insights", { method: "POST" }),
  getLatestAiInsights: () => request("/analytics/ai-insights/latest"),
  getAgentHealth: (hours = 24) => request(`/agent-runs/health?hours=${hours}`),
  getRecentAgentRuns: (limit = 50) => request(`/agent-runs/recent?limit=${limit}`),
  getAgentFleet: () => request("/agents/fleet"),
  getCampaigns: () => request("/campaigns"),
  getCampaignPerformance: () => request("/campaigns/performance"),
  createCampaign: (body: Record<string, unknown>) =>
    request("/campaigns", { method: "POST", body: JSON.stringify(body) }),
  updateCampaign: (id: string, body: Record<string, unknown>) =>
    request(`/campaigns/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  getNotifications: (limit = 50) => request(`/notifications?limit=${limit}`),
  markNotificationRead: (id: string) => request(`/notifications/${id}/read`, { method: "PATCH" }),
  markAllNotificationsRead: () => request("/notifications/read-all", { method: "PATCH" }),
  getAutomationSettings: () => request("/settings/organization/automation"),
  updateAutomationSettings: (body: Record<string, unknown>) =>
    request("/settings/organization/automation", { method: "PATCH", body: JSON.stringify(body) }),
  getOrgBranding: () => request("/settings/organization/branding"),
  updateOrgBranding: (body: Record<string, unknown>) =>
    request("/settings/organization/branding", { method: "PATCH", body: JSON.stringify(body) }),
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
  changeUserRole: (id: string, role: string) => request(`/users/${id}/role/${role}`, { method: "PATCH" }),
  getMe: () => request("/users/me"),
  getUserAccess: (id: string) => request(`/users/${id}/access`),
  updateUserAccess: (id: string, body: Record<string, unknown>) =>
    request(`/users/${id}/access`, { method: "PATCH", body: JSON.stringify(body) }),

  // ---- Email Hub ----
  getEmailHubAccounts: () => request("/email-hub/accounts"),
  getEmailHubStats: () => request("/email-hub/stats"),
  getEmailTags: () => request("/email-hub/tags"),
  createEmailTag: (body: { name: string; color?: string }) =>
    request("/email-hub/tags", { method: "POST", body: JSON.stringify(body) }),
  updateEmailTag: (id: string, body: { name?: string; color?: string }) =>
    request(`/email-hub/tags/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  deleteEmailTag: (id: string) => request(`/email-hub/tags/${id}`, { method: "DELETE" }),
  getEmailMessages: (params: Record<string, string> = {}) =>
    request(`/email-hub/messages?${new URLSearchParams(params).toString()}`),
  bulkEmailAction: (body: { messageIds: string[]; action: string; tagId?: string }) =>
    request("/email-hub/messages/bulk", { method: "POST", body: JSON.stringify(body) }),
  replyToEmail: (messageId: string, body: { bodyHtml: string; replyAll?: boolean }) =>
    request(`/email-hub/messages/${messageId}/reply`, { method: "POST", body: JSON.stringify(body) }),
  composeEmail: (body: { accountId: string; to: string[]; cc?: string[]; bcc?: string[]; subject: string; bodyHtml: string }) =>
    request("/email-hub/compose", { method: "POST", body: JSON.stringify(body) }),
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
  connectSocialAccount: (platform: string) =>
    request<{ url: string }>(`/settings/social-media/accounts/${platform}/connect`, { method: "POST" }),
  getPendingSocialSelection: (pendingId: string) => request(`/settings/social-media/accounts/pending/${pendingId}`),
  selectPendingSocialAccount: (pendingId: string, externalAccountId: string) =>
    request(`/settings/social-media/accounts/pending/${pendingId}/select`, {
      method: "POST",
      body: JSON.stringify({ externalAccountId }),
    }),
  getSocialAccountAccess: (accountId: string) => request(`/settings/social-media/accounts/${accountId}/access`),
  grantSocialAccountAccess: (accountId: string, body: { userId: string; canPublish?: boolean; canApprove?: boolean }) =>
    request(`/settings/social-media/accounts/${accountId}/access`, { method: "POST", body: JSON.stringify(body) }),
  revokeSocialAccountAccess: (accountId: string, userId: string) =>
    request(`/settings/social-media/accounts/${accountId}/access/${userId}`, { method: "DELETE" }),
};
