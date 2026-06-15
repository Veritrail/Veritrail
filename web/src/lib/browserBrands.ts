import type { BrowserId } from "./browserDetect";

/** Vendored browser favicons under /public/browsers/. */
export const BROWSER_FAVICON: Record<BrowserId, string> = {
  chrome: "/browsers/chrome.png",
  firefox: "/browsers/firefox.svg",
  safari: "/browsers/safari.svg",
  edge: "/browsers/edge.svg",
  opera: "/browsers/opera.svg",
  brave: "/browsers/brave.png",
  unknown: "/browsers/browser.svg",
};
