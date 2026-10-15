import { Injectable, Logger } from "@nestjs/common";
import { chromium } from "playwright";

export interface FetchedJobFacts {
  [label: string]: string;
}

export interface FetchedJobClient {
  [label: string]: string;
}

export interface FetchedJob {
  status: "SUCCESS" | "FAILED";
  finalUrl: string;
  title?: string;
  description?: string;
  postedAt?: string;
  facts?: FetchedJobFacts;
  skills?: string[];
  client?: FetchedJobClient;
  /** Set only when status is FAILED — distinguishes a Cloudflare block from
   *  a closed/expired job link from an outright navigation error, so the
   *  caller can show something more useful than "something went wrong". */
  error?: string;
}

const REAL_CHROME_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
const NAV_TIMEOUT_MS = 30_000;
const HYDRATION_WAIT_MS = 3_000;

/**
 * Fetches a single Upwork job posting with a real headless Chromium browser
 * (Part: Upwork Proposal Writing, explicit user request — "the user pastes
 * the link... the system fetches the rest of the job's details and client
 * data", chosen after confirming a plain server-side HTTP request gets a
 * Cloudflare challenge page, not job content — see this service's own
 * verification notes below).
 *
 * Confirmed live against real Upwork job pages before writing this (not
 * guessed, per this app's standing "no unverified logic against Upwork"
 * rule — see UpworkIntegrationModule's own docblock for why that rule
 * exists for the *official* GraphQL API; this scraper is a separate
 * mechanism the user explicitly chose instead, with the risk/tradeoffs
 * flagged up front):
 *   - A real open job page embeds a schema.org `JobPosting` JSON-LD block
 *     (title/description/datePosted/employmentType) — Upwork's own SEO
 *     structured data for Google for Jobs, so it's a stable, intentional
 *     data surface, not a brittle CSS scrape.
 *   - Budget/duration/experience-level facts render as `<li>` elements each
 *     containing one `strong` (the value) and one `.description` div (the
 *     label) — walking all such `li`s generically into a label→value map
 *     survives most markup/class-name churn, unlike hardcoding one CSS path
 *     per field.
 *   - Client info (spend/hires/hours/location/industry/company size) uses
 *     stable `data-qa="client-*"` attributes.
 *   - A closed/expired job's URL still returns HTTP 200 but redirects to a
 *     generic category listing page with no JobPosting JSON-LD (only a
 *     BreadcrumbList) — that absence is the actual-vs-expired signal, not
 *     the HTTP status.
 *   - A real Cloudflare bot-detection block is a distinct, reproducible
 *     outcome (HTTP 403, title "Attention Required! | Cloudflare") seen
 *     live during verification — this is NOT hypothetical, and will recur
 *     in production at some real (currently unknown) rate. There is no
 *     fallback here beyond surfacing it clearly to the user to retry.
 */
@Injectable()
export class UpworkJobFetcherService {
  private readonly logger = new Logger(UpworkJobFetcherService.name);
  /** Serializes fetches to one browser at a time — this VPS has 2GB RAM and
   *  a headless Chromium instance is not something to run several of
   *  concurrently (see hetzner-vps-deployment memory's build-OOM trap for
   *  just how little headroom this box has). A launch-per-request (not a
   *  resident browser) keeps idle memory at zero between requests, trading
   *  a ~1-2s browser-startup cost each call. */
  private queue: Promise<unknown> = Promise.resolve();

  async fetchJob(jobUrl: string): Promise<FetchedJob> {
    const run = this.queue.then(() => this.fetchJobInternal(jobUrl));
    // Swallow so one failed fetch doesn't poison the queue for the next
    // caller — the rejection itself still propagates to THIS call's caller
    // via the returned (unchained) promise below.
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async fetchJobInternal(jobUrl: string): Promise<FetchedJob> {
    let host: string;
    try {
      host = new URL(jobUrl).hostname.toLowerCase();
    } catch {
      return { status: "FAILED", finalUrl: jobUrl, error: "That doesn't look like a valid URL." };
    }
    // Only ever navigate to upwork.com — this endpoint takes a user-supplied
    // URL and drives a real browser against it; without this check it would
    // be an open-ended SSRF-style fetcher, not an Upwork job fetcher.
    if (host !== "upwork.com" && !host.endsWith(".upwork.com")) {
      return { status: "FAILED", finalUrl: jobUrl, error: "Please paste a link on upwork.com." };
    }

    const browser = await chromium.launch({ headless: true });
    try {
      const context = await browser.newContext({
        userAgent: REAL_CHROME_UA,
        viewport: { width: 1366, height: 900 },
        locale: "en-US",
      });
      const page = await context.newPage();
      let response;
      try {
        response = await page.goto(jobUrl, { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT_MS });
      } catch (err) {
        return { status: "FAILED", finalUrl: jobUrl, error: `Couldn't reach that page: ${(err as Error).message}` };
      }
      await page.waitForTimeout(HYDRATION_WAIT_MS);

      const finalUrl = page.url();
      const title = await page.title();
      if (response && response.status() === 403 || /attention required|just a moment/i.test(title)) {
        this.logger.warn(`Upwork blocked automatic fetch for ${jobUrl} (status ${response?.status()}, title "${title}")`);
        return {
          status: "FAILED",
          finalUrl,
          error: "Upwork blocked the automatic fetch (bot detection). Try again in a bit.",
        };
      }

      const extracted = await page.evaluate(() => {
        const ldBlocks = Array.from(document.querySelectorAll('script[type="application/ld+json"]'))
          .map((s) => {
            try {
              return JSON.parse(s.textContent ?? "null");
            } catch {
              return null;
            }
          })
          .filter(Boolean);
        const jobPosting = ldBlocks.find((b: Record<string, unknown>) => b?.["@type"] === "JobPosting");

        const facts: Record<string, string> = {};
        document.querySelectorAll("li").forEach((li) => {
          const desc = li.querySelector(".description");
          const strong = li.querySelector("strong");
          const label = desc?.textContent?.trim();
          const value = strong?.textContent?.trim();
          if (label && value && label.length < 60 && value.length < 120) facts[label] = value;
        });

        const skills = Array.from(document.querySelectorAll(".air3-badge"))
          .filter((el) => !el.closest('[data-test="job-tile"]'))
          .map((el) => el.textContent?.trim() ?? "")
          .filter((t) => t && !t.startsWith("+"));

        const client: Record<string, string> = {};
        const clientFieldMap: Record<string, string> = {
          "client-contract-date": "Member since",
          "client-spend": "Total spent",
          "client-hires": "Hires",
          "client-hours": "Hours",
          "client-company-profile-industry": "Industry",
          "client-company-profile-size": "Company size",
        };
        Object.entries(clientFieldMap).forEach(([attr, label]) => {
          const el = document.querySelector(`[data-qa="${attr}"]`);
          const text = el?.textContent?.trim();
          if (text) client[label] = text;
        });
        // Split out separately from the fields above — verified live that
        // `[data-qa="client-location"]` has the country in its own `strong`
        // child, distinct from a city/local-time `div` — needed as its own
        // clean field for the excluded-country check (Part: Upwork Bidding
        // SOP), not a mashed "CountryCityTime" string.
        const locationEl = document.querySelector('[data-qa="client-location"]');
        const country = locationEl?.querySelector("strong")?.textContent?.trim();
        if (country) client["Country"] = country;
        const cityTime = Array.from(locationEl?.querySelectorAll(".nowrap") ?? [])
          .map((el) => el.textContent?.trim())
          .filter(Boolean)
          .join(", ");
        if (cityTime) client["Location"] = cityTime;
        const paymentVerified = /payment method verified/i.test(document.body.innerText);

        return {
          hasJobPosting: Boolean(jobPosting),
          title: (jobPosting?.title as string) ?? document.querySelector("h1")?.textContent?.trim(),
          description: jobPosting?.description as string | undefined,
          postedAt: jobPosting?.datePosted as string | undefined,
          facts,
          skills: [...new Set(skills)],
          client,
          paymentVerified,
        };
      });

      if (!extracted.hasJobPosting) {
        this.logger.warn(`No JobPosting found at ${jobUrl} (final URL ${finalUrl}) — likely closed/expired.`);
        return {
          status: "FAILED",
          finalUrl,
          error: "This job posting isn't available anymore (closed, expired, or removed).",
        };
      }

      const description = extracted.description
        ? extracted.description.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()
        : undefined;

      return {
        status: "SUCCESS",
        finalUrl,
        title: extracted.title,
        description,
        postedAt: extracted.postedAt,
        facts: extracted.facts,
        skills: extracted.skills,
        client: {
          ...extracted.client,
          ...(extracted.paymentVerified ? { "Payment method": "Verified" } : {}),
        },
      };
    } finally {
      await browser.close();
    }
  }
}
