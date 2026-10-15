# Outly Upwork Fetcher

Fetches Upwork job details for Outly's Proposal Writing tool using your own real, logged-in browser session.

**Why this exists:** Upwork's Cloudflare firewall hard-blocks our server's IP outright (confirmed directly, no fix on the server side). This extension runs the fetch in your own browser instead, which is never flagged.

## Install (Chrome / Edge / Brave — one time)

1. Download the zip and extract it into its own folder somewhere permanent (don't delete it afterward — Chrome loads the extension from these files each time).
2. Go to `chrome://extensions` (or `edge://extensions`).
3. Turn on **Developer mode** (top-right toggle).
4. Click **Load unpacked**.
5. Select the folder you extracted (it should contain `manifest.json`).

Done. You'll see "Outly Upwork Fetcher" in your extensions list.

## How it works

1. On the Proposal Writing page, paste a job link and click **Generate**, same as always.
2. The extension opens the job in a background tab — your current tab stays active, you won't be switched away.
3. It reads the job details right there, sends them back, and closes the tab automatically.
4. Your cover letter generates normally.

If a job has closed/expired, the tab will say so and close the same way — you'll see that reflected in the result.

## Job Feed (scanning a search page)

On the **Job Feed** page, paste an Upwork search or category URL and click **Scan**. The extension opens that page, reads the list of jobs on it, then opens each one (up to 10, one at a time) the same way as a single Generate — reading details, closing automatically — and reports a BID/MAYBE/SKIP recommendation next to each title once done. This takes longer than a single job (several tabs in sequence), by design — it's paced like someone actually clicking through results.

## Updating

If Outly ships a new version of this extension, repeat the download + unzip + "Load unpacked" steps (or use "Reload" on the extension card at `chrome://extensions` if you just replaced the files in place).
