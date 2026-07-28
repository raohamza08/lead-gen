const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000/api/v1";

const ACCESS_KEY = "accessToken";
const REFRESH_KEY = "refreshToken";

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn?: number;
}

function getAccessToken(): string | null {
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
  getLead: (id: string) => request(`/leads/${id}`),
  updateReview: (id: string, body: Record<string, unknown>) =>
    request(`/leads/${id}/review`, { method: "PATCH", body: JSON.stringify(body) }),
  advanceStage: (id: string, stage: string) =>
    request(`/leads/${id}/advance-stage`, { method: "POST", body: JSON.stringify({ stage }) }),
  approveEmail: (id: string, body: Record<string, unknown>) =>
    request(`/leads/${id}/approve-email`, { method: "POST", body: JSON.stringify(body) }),
  getNicheFilters: () => request("/niche-filters"),
  createNicheFilter: (body: Record<string, unknown>) =>
    request("/niche-filters", { method: "POST", body: JSON.stringify(body) }),
  runNicheFilterNow: (id: string) => request(`/niche-filters/${id}/run-now`, { method: "POST" }),
  getPendingApprovals: () => request("/sequences/pending-approvals"),
  getUpcomingSends: () => request("/sequences/upcoming"),
  getEmailAccountsHealth: () => request("/settings/email-accounts/health"),
  createEmailAccount: (body: Record<string, unknown>) =>
    request("/settings/email-accounts", { method: "POST", body: JSON.stringify(body) }),
  updateEmailAccount: (id: string, body: Record<string, unknown>) =>
    request(`/settings/email-accounts/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  getEmailFunnel: () => request("/analytics/email-funnel"),
  getLinkedinFunnel: () => request("/analytics/linkedin-funnel"),
  getRevenuePipeline: () => request("/analytics/revenue-pipeline"),
  getCohortTrends: (days = 30) => request(`/analytics/cohort-trends?days=${days}`),
};
