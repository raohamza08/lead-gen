/**
 * Where an unsubscribe link (apps/api/src/webhooks/tracking.controller.ts's
 * `unsubscribe` handler) redirects to after it's already recorded the
 * suppression entry and cancelled that lead's pending follow-up. This page
 * has nothing to do — the unsubscribe already happened server-side before
 * the redirect — it exists purely so the recipient's browser lands
 * somewhere real instead of a 404. Public, no auth: whoever clicks this
 * link is a prospect, not a signed-in user.
 */
export default function UnsubscribedPage() {
  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-sm text-center">
        <div className="mb-5 flex items-center justify-center gap-3">
          <span
            aria-hidden
            className="flex h-11 w-11 items-center justify-center rounded-xl bg-accent text-sm font-bold text-white shadow-sm"
          >
            AI
          </span>
        </div>
        <div className="card p-7">
          <h1 className="text-base font-semibold tracking-tight">You&apos;re unsubscribed</h1>
          <p className="mt-2 text-sm text-ink/60">
            You won&apos;t receive any further emails from us. This takes effect immediately.
          </p>
        </div>
      </div>
    </main>
  );
}
