"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api, setTokens } from "../../lib/api-client";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("admin@example.com");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      // Store BOTH tokens. Keeping only the access token was the bug behind the
      // dashboard filling with 401s 15 minutes after signing in — there was
      // nothing left to refresh with.
      const tokens = await api.login(email, password);
      setTokens(tokens);
      router.push("/overview");
    } catch (err) {
      const message = (err as Error).message;
      // A network failure and wrong credentials are different problems with
      // different fixes; "Request failed" sends the user to check their
      // password when the API is simply unreachable.
      setError(
        /fetch|network|Failed to fetch/i.test(message)
          ? "Cannot reach the API. Check that the backend and tunnel are running."
          : /401|unauthor/i.test(message)
            ? "Incorrect email or password."
            : message,
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <div className="mb-7 flex items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.png" alt="" aria-hidden className="h-11 w-11 object-contain" />
          <div>
            <h1 className="text-lg font-semibold leading-tight tracking-tight">Outly OS</h1>
            <p className="text-xs text-ink/50">Revenue intelligence platform</p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="card p-7">
          <h2 className="text-base font-semibold tracking-tight">Sign in</h2>
          <p className="mb-6 mt-1 text-xs text-ink/50">Access your pipeline and campaigns.</p>

          <label className="mb-4 block">
            <span className="mb-1.5 block text-xs font-medium text-ink/65">Email</span>
            <input
              className="w-full rounded-lg border border-[var(--line)] bg-transparent px-3 py-2.5 text-sm outline-none transition-colors focus:border-[rgb(var(--accent-rgb)/0.7)]"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              type="email"
              autoComplete="username"
              required
            />
          </label>

          <label className="mb-5 block">
            <span className="mb-1.5 block text-xs font-medium text-ink/65">Password</span>
            <input
              className="w-full rounded-lg border border-[var(--line)] bg-transparent px-3 py-2.5 text-sm outline-none transition-colors focus:border-[rgb(var(--accent-rgb)/0.7)]"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              type="password"
              autoComplete="current-password"
              required
            />
          </label>

          {error && (
            <div
              role="alert"
              className="mb-4 rounded-lg border border-[rgb(var(--bad-rgb)/0.4)] bg-[rgb(var(--bad-rgb)/0.06)] px-3 py-2 text-xs text-bad"
            >
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-lg bg-accent px-3 py-2.5 text-sm font-medium text-white shadow-sm transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {loading ? "Signing in…" : "Sign in"}
          </button>
        </form>
      </div>
    </main>
  );
}
