// Bridges the app tab <-> freshly-opened Upwork tabs. Keyed by the Upwork
// tab's own id so results/pings from content-upwork.js resolve back to
// whichever request opened that specific tab. Handles two request shapes:
// a single job fetch (OUTLY_FETCH_JOB, unchanged from before), and a job
// *listing* scan (OUTLY_FETCH_JOB_LIST) which opens a search/category page,
// scrapes the list of job cards there, then sequentially re-uses the same
// single-job mechanism against each one to get full client/country/spend
// detail -- the listing cards alone don't show that (verified live).
const pending = new Map(); // tabId -> { mode: "JOB" | "LISTING", timeoutId, onDone(payload) }

const TIMEOUT_MS = 25000;
const MAX_JOBS_PER_SCAN = 10;
// Pause between opening each job tab during a scan -- keeps it paced like
// someone actually clicking through results, not a rapid-fire loop.
const PACE_MS = 1500;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function finish(tabId, payload) {
  const entry = pending.get(tabId);
  if (!entry) return;
  pending.delete(tabId);
  clearTimeout(entry.timeoutId);
  entry.onDone(payload);
  chrome.tabs.remove(tabId).catch(() => {});
}

function openTab(url, mode, onDone) {
  return new Promise((resolve) => {
    chrome.tabs.create({ url, active: true }, (tab) => {
      const timeoutId = setTimeout(() => {
        finish(tab.id, { ok: false, error: "Timed out waiting for the page to load." });
      }, TIMEOUT_MS);
      pending.set(tab.id, {
        mode,
        timeoutId,
        onDone: (payload) => {
          onDone(payload);
          resolve(payload);
        },
      });
    });
  });
}

function fetchSingleJob(url) {
  return openTab(url, "JOB", () => {});
}

async function processJobList(appTabId, requestId, searchUrl) {
  const listResult = await openTab(searchUrl, "LISTING", () => {});
  if (!listResult.ok || !listResult.jobs || listResult.jobs.length === 0) {
    chrome.tabs.sendMessage(appTabId, {
      type: "OUTLY_JOB_LIST_RESULT",
      requestId,
      ok: false,
      error: listResult.error || "No jobs found on that page.",
    });
    return;
  }

  const summaries = listResult.jobs.slice(0, MAX_JOBS_PER_SCAN);
  const results = [];
  for (const summary of summaries) {
    const detail = await fetchSingleJob(summary.url);
    results.push({ summary, detail });
    await sleep(PACE_MS);
  }

  chrome.tabs.sendMessage(appTabId, { type: "OUTLY_JOB_LIST_RESULT", requestId, ok: true, results });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "OUTLY_FETCH_JOB") {
    const appTabId = sender.tab.id;
    openTab(message.url, "JOB", (payload) => {
      chrome.tabs.sendMessage(appTabId, { type: "OUTLY_JOB_RESULT", requestId: message.requestId, ...payload });
    });
    return;
  }

  if (message.type === "OUTLY_FETCH_JOB_LIST") {
    processJobList(sender.tab.id, message.requestId, message.searchUrl);
    return;
  }

  if (message.type === "OUTLY_PING_IS_REQUESTED") {
    const entry = pending.get(sender.tab.id);
    sendResponse(entry ? entry.mode : null);
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

  if (message.type === "OUTLY_JOB_LIST_SCRAPED") {
    finish(sender.tab.id, { ok: true, jobs: message.jobs });
    return;
  }

  if (message.type === "OUTLY_JOB_LIST_SCRAPE_FAILED") {
    finish(sender.tab.id, { ok: false, error: message.error });
    return;
  }
});

// If the user closes a job/listing tab themselves before scraping
// finishes, don't leave anything waiting forever.
chrome.tabs.onRemoved.addListener((tabId) => {
  finish(tabId, { ok: false, error: "The tab was closed before details could be read." });
});
