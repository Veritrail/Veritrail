export type BrowserId = "chrome" | "firefox" | "safari" | "edge" | "opera" | "brave" | "unknown";

export function detectBrowser(ua: string): BrowserId {
  if (/Edg\//.test(ua)) return "edge";
  if (/OPR\//.test(ua) || /Opera/.test(ua)) return "opera";
  if (/Brave/.test(ua)) return "brave";
  if (/Firefox\//.test(ua)) return "firefox";
  if (/Chrome\//.test(ua) || /CriOS/.test(ua)) return "chrome";
  if (/Safari\//.test(ua)) return "safari";
  return "unknown";
}

export function browserLabel(id: BrowserId): string {
  switch (id) {
    case "chrome":
      return "Chrome";
    case "firefox":
      return "Firefox";
    case "safari":
      return "Safari";
    case "edge":
      return "Edge";
    case "opera":
      return "Opera";
    case "brave":
      return "Brave";
    default:
      return "Browser";
  }
}

export function osLabel(ua: string): string {
  if (/Macintosh|Mac OS X/.test(ua)) return "macOS";
  if (/Windows/.test(ua)) return "Windows";
  if (/iPhone|iPad/.test(ua)) return "iOS";
  if (/Android/.test(ua)) return "Android";
  if (/Linux/.test(ua)) return "Linux";
  return "this device";
}

export function deviceLabel(ua: string): string {
  return `${browserLabel(detectBrowser(ua))} on ${osLabel(ua)}`;
}
