export function toIsoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function parseIso(iso: string): Date {
  return new Date(`${iso}T12:00:00`);
}

export function formatDisplayDate(iso: string): string {
  return parseIso(iso).toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function todayIso(): string {
  return toIsoDate(new Date());
}
