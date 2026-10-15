// Injected into the Outly app itself. Bridges page JS (which has no
// chrome.* API access) to the extension's background worker.
(function () {
  // Lets the React page detect the extension is installed without any
  // message round-trip.
  document.documentElement.setAttribute("data-outly-upwork-fetcher", "installed");

  window.addEventListener("message", (event) => {
    if (event.source !== window || event.origin !== location.origin) return;
    if (!event.data || event.data.source !== "outly-app") return;

    if (event.data.type === "OUTLY_FETCH_JOB") {
      chrome.runtime.sendMessage({ type: "OUTLY_FETCH_JOB", url: event.data.url, requestId: event.data.requestId });
    } else if (event.data.type === "OUTLY_FETCH_JOB_LIST") {
      chrome.runtime.sendMessage({ type: "OUTLY_FETCH_JOB_LIST", searchUrl: event.data.searchUrl, requestId: event.data.requestId });
    }
  });

  chrome.runtime.onMessage.addListener((message) => {
    if (message.type !== "OUTLY_JOB_RESULT" && message.type !== "OUTLY_JOB_LIST_RESULT") return;
    window.postMessage({ source: "outly-upwork-extension", ...message }, location.origin);
  });
})();
