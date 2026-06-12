/** Redact AWS access key IDs in user-facing copy. Full IDs remain in API evidence for remediation. */

const AWS_ACCESS_KEY_RE = /\b((?:AKIA|ASIA|AROA)[A-Z0-9]{16})\b/g;

export function maskAccessKeyId(keyId: string | null | undefined): string {
  const key = (keyId ?? "").trim();
  if (!key) return key;
  if (key.length <= 8) return "••••";
  return `${key.slice(0, 4)}••••${key.slice(-4)}`;
}

export function maskSensitiveText(text: string | null | undefined): string {
  if (!text) return text ?? "";
  return text.replace(AWS_ACCESS_KEY_RE, (_, key: string) => maskAccessKeyId(key));
}
