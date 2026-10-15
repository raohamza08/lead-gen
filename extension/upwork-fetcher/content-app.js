// Injected into the Outly app itself. Bridges page JS (which has no
// chrome.* API access) to the extension's background worker.
(function () {
  // Lets the React page detect the extension is installed without any
  // message round-trip.
  document.documentElement.setAttribute("data-outly-upwork-fetcher", "installed");

  window.addEventListener("message", (event) => {
    if (event.source !== window || event.origin !== location.origin) return;
    if (!event.data || event.data.source !== "outly-app" || event.data.type !== "OUTLY_FETCH_JOB") return;
    chrome.runtime.sendMessage({ type: "OUTLY_FETCH_JOB", url: event.data.url, requestId: event.data.requestId });
  });

  chrome.runtime.onMessage.addListener((message) => {
    if (message.type !== "OUTLY_JOB_RESULT") return;
    window.postMessage({ source: "outly-upwork-extension", ...message }, location.origin);
  });
})();
