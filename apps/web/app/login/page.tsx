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
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center">
      <form onSubmit={handleSubmit} className="w-full max-w-sm rounded-lg border border-[var(--line)] p-8">
        <h1 className="mb-6 text-xl font-semibold">Sign in</h1>
        <label className="mb-1 block text-sm">Email</label>
        <input
          className="mb-4 w-full rounded border border-[var(--line)] bg-transparent px-3 py-2"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          type="email"
          required
        />
        <label className="mb-1 block text-sm">Password</label>
        <input
          className="mb-4 w-full rounded border border-[var(--line)] bg-transparent px-3 py-2"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          type="password"
          required
        />
        {error && <p className="mb-4 text-sm text-bad">{error}</p>}
        <button
          type="submit"
          disabled={loading}
          className="w-full rounded bg-accent px-3 py-2 text-white disabled:opacity-50"
        >
          {loading ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </main>
  );
}
