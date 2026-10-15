// Bridges the app tab <-> a freshly-opened Upwork job tab. Keyed by the
// Upwork tab's own id so results/pings from content-upwork.js resolve back
// to whichever app tab asked for that specific job.
const pending = new Map(); // upworkTabId -> { appTabId, requestId, timeoutId }

const TIMEOUT_MS = 25000;

function finish(upworkTabId, payload) {
  const entry = pending.get(upworkTabId);
  if (!entry) return;
  pending.delete(upworkTabId);
  clearTimeout(entry.timeoutId);
  chrome.tabs.sendMessage(entry.appTabId, { type: "OUTLY_JOB_RESULT", requestId: entry.requestId, ...payload });
  chrome.tabs.remove(upworkTabId).catch(() => {});
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "OUTLY_FETCH_JOB") {
    const appTabId = sender.tab.id;
    chrome.tabs.create({ url: message.url, active: true }, (tab) => {
      const timeoutId = setTimeout(() => {
        finish(tab.id, { ok: false, error: "Timed out waiting for the job page to load." });
      }, TIMEOUT_MS);
      pending.set(tab.id, { appTabId, requestId: message.requestId, timeoutId });
    });
    return;
  }

  if (message.type === "OUTLY_PING_IS_REQUESTED") {
    sendResponse(pending.has(sender.tab.id));
    return;
  }

  if (message.type === "OUTLY_JOB_SCRAPED") {
    finish(sender.tab.id, { ok: true, job: message.job });
    return;
  }

  if (message.type === "OUTLY_JOB_SCRAPE_FAILED") {
    finish(sender.tab.id, { ok: false, error: message.error });
    return;
  }
});

// If the user closes the Upwork tab themselves before scraping finishes,
// don't leave the app tab waiting forever.
chrome.tabs.onRemoved.addListener((tabId) => {
  const entry = pending.get(tabId);
  if (!entry) return;
  pending.delete(tabId);
  clearTimeout(entry.timeoutId);
  chrome.tabs.sendMessage(entry.appTabId, {
    type: "OUTLY_JOB_RESULT",
    requestId: entry.requestId,
    ok: false,
    error: "The job tab was closed before details could be read.",
  });
});
