const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000/api/v1";

function getAccessToken(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem("accessToken");
}

export function setAccessToken(token: string) {
  window.localStorage.setItem("accessToken", token);
}

export function clearAccessToken() {
  window.localStorage.removeItem("accessToken");
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getAccessToken();
  const res = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init?.headers,
    },
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.message ?? `Request to ${path} failed with ${res.status}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export const api = {
  login: (email: string, password: string) =>
    request<{ accessToken: string; refreshToken: string }>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    }),
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
  getCohortTrends: () => request("/analytics/cohort-trends"),
};
