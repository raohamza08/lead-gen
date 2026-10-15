// Runs in the real, logged-in browser on upwork.com job pages -- same
// extraction logic as the backend's (now largely unused for job pages)
// Playwright fetcher, ported to plain content-script JS. This exists
// because Upwork's Cloudflare WAF hard-blocks the app's server IP
// outright (confirmed directly, not assumed) -- there is no challenge to
// solve, so the only reliable path left is the user's own real browser.
(function () {
  function extractJobPosting() {
    const ldBlocks = Array.from(document.querySelectorAll('script[type="application/ld+json"]'))
      .map((s) => {
        try {
          return JSON.parse(s.textContent || "null");
        } catch {
          return null;
        }
      })
      .filter(Boolean);
    const jobPosting = ldBlocks.find((b) => b && b["@type"] === "JobPosting");
    if (!jobPosting) return null;

    const facts = {};
    document.querySelectorAll("li").forEach((li) => {
      const desc = li.querySelector(".description");
      const strong = li.querySelector("strong");
      const label = desc && desc.textContent ? desc.textContent.trim() : "";
      const value = strong && strong.textContent ? strong.textContent.trim() : "";
      if (label && value && label.length < 60 && value.length < 120) facts[label] = value;
    });

    const skills = Array.from(document.querySelectorAll(".air3-badge"))
      .filter((el) => !el.closest('[data-test="job-tile"]'))
      .map((el) => (el.textContent ? el.textContent.trim() : ""))
      .filter((t) => t && !t.startsWith("+"));

    const client = {};
    const clientFieldMap = {
      "client-contract-date": "Member since",
      "client-spend": "Total spent",
      "client-hires": "Hires",
      "client-hours": "Hours",
      "client-company-profile-industry": "Industry",
      "client-company-profile-size": "Company size",
    };
    Object.keys(clientFieldMap).forEach((attr) => {
      const el = document.querySelector('[data-qa="' + attr + '"]');
      const text = el && el.textContent ? el.textContent.trim() : "";
      if (text) client[clientFieldMap[attr]] = text;
    });
    const locationEl = document.querySelector('[data-qa="client-location"]');
    const countryEl = locationEl ? locationEl.querySelector("strong") : null;
    const country = countryEl && countryEl.textContent ? countryEl.textContent.trim() : "";
    if (country) client["Country"] = country;
    const cityTimeParts = Array.from(locationEl ? locationEl.querySelectorAll(".nowrap") : [])
      .map((el) => (el.textContent ? el.textContent.trim() : ""))
      .filter(Boolean);
    if (cityTimeParts.length) client["Location"] = cityTimeParts.join(", ");
    const paymentVerified = /payment method verified/i.test(document.body.innerText);
    if (paymentVerified) client["Payment method"] = "Verified";

    const description = (jobPosting.description || "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    return {
      title: jobPosting.title || (document.querySelector("h1") ? document.querySelector("h1").textContent.trim() : undefined),
      description,
      postedAt: jobPosting.datePosted,
      facts,
      skills: Array.from(new Set(skills)),
      client,
    };
  }

  function attempt(retriesLeft) {
    const result = extractJobPosting();
    if (result) {
      chrome.runtime.sendMessage({ type: "OUTLY_JOB_SCRAPED", url: location.href, job: result });
      return;
    }
    if (retriesLeft > 0) {
      setTimeout(() => attempt(retriesLeft - 1), 700);
    } else {
      chrome.runtime.sendMessage({
        type: "OUTLY_JOB_SCRAPE_FAILED",
        url: location.href,
        error: "This job posting isn't available anymore (closed, expired, or removed).",
      });
    }
  }

  // "Posted 20 hours ago" / "Posted 5 minutes ago" / "Posted just now" ->
  // an approximate ISO timestamp. Listing cards only ever show relative
  // text (verified live, no exact datetime attribute anywhere on them),
  // unlike a full job page's real JSON-LD datePosted.
  function parseRelativePostedAt(text) {
    if (/just now/i.test(text)) return new Date().toISOString();
    const match = text.match(/(\d+)\s+(minute|hour|day|week|month)s?\s+ago/i);
    if (!match) return null;
    const amount = parseInt(match[1], 10);
    const unitMs = {
      minute: 60_000,
      hour: 3_600_000,
      day: 86_400_000,
      week: 604_800_000,
      month: 2_629_800_000,
    }[match[2].toLowerCase()];
    if (!unitMs) return null;
    return new Date(Date.now() - amount * unitMs).toISOString();
  }

  // Listing/search-results pages (Part: Upwork Bidding SOP, explicit user
  // request — "the jobs must be listed in the system"). Verified live:
  // each card is `section[data-qa="job-tile"]`, title+href live on
  // `[data-qa="job-title"]`, and two `small.text-muted-on-inverse` spans
  // carry "Hourly"/"Fixed-price" and "Posted X ago" respectively. These
  // cards never show client country/spend — that still needs opening the
  // full job page, which background.js does next for each one found here.
  function extractJobList() {
    return Array.from(document.querySelectorAll('section[data-qa="job-tile"]'))
      .map((card) => {
        const titleEl = card.querySelector('[data-qa="job-title"]');
        if (!titleEl || !titleEl.href) return null;
        const smalls = Array.from(card.querySelectorAll("small.text-muted-on-inverse")).map((s) => s.textContent.trim());
        const rateText = smalls.find((t) => /hourly|fixed/i.test(t)) || "";
        const postedText = smalls.find((t) => /posted/i.test(t)) || "";
        return {
          url: titleEl.href,
          title: titleEl.textContent.trim(),
          isHourly: /hourly/i.test(rateText) ? true : /fixed/i.test(rateText) ? false : null,
          postedAt: parseRelativePostedAt(postedText),
        };
      })
      .filter(Boolean);
  }

  function attemptListing(retriesLeft) {
    const jobs = extractJobList();
    if (jobs.length > 0) {
      chrome.runtime.sendMessage({ type: "OUTLY_JOB_LIST_SCRAPED", url: location.href, jobs });
      return;
    }
    if (retriesLeft > 0) {
      setTimeout(() => attemptListing(retriesLeft - 1), 700);
    } else {
      chrome.runtime.sendMessage({
        type: "OUTLY_JOB_LIST_SCRAPE_FAILED",
        url: location.href,
        error: "No jobs found on that page.",
      });
    }
  }

  // Only run extraction (and hold up the tab doing so) when this page was
  // actually opened by the extension for that purpose -- avoids doing
  // unnecessary work, or sending messages nobody asked for, on normal
  // everyday Upwork browsing. The background worker's response tells us
  // which kind of page it's expecting (a single job, or a listing).
  chrome.runtime.sendMessage({ type: "OUTLY_PING_IS_REQUESTED", url: location.href }, (mode) => {
    if (mode === "JOB") attempt(8);
    else if (mode === "LISTING") attemptListing(8);
  });
})();
