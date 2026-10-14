// Time + 15-minute grid engine — spec §4.
// All scheduling goes through here. Never silently round invalid times
// outside an explicit user-approved import correction (§4.4).

export const SLOT = 15;
export const MINUTES_PER_DAY = 1440;
export const MIN_DURATION = 15;

export function isAligned(minutes: number): boolean {
  return Number.isInteger(minutes) && minutes % SLOT === 0;
}

export function isValidDuration(start: number, end: number): boolean {
  return end - start >= MIN_DURATION && isAligned(start) && isAligned(end);
}

export function snapToSlot(minutes: number): number {
  return Math.round(minutes / SLOT) * SLOT;
}

export function clampDay(minutes: number): number {
  return Math.max(0, Math.min(MINUTES_PER_DAY, minutes));
}

/** Minutes-from-midnight → display string. Locale en-AU, §3.5. */
export function formatTime(minutes: number, clock: "12h" | "24h" = "12h"): string {
  const h24 = Math.floor(minutes / 60) % 24;
  const m = minutes % 60;
  const mm = String(m).padStart(2, "0");
  if (clock === "24h") return `${String(h24).padStart(2, "0")}:${mm}`;
  const suffix = h24 < 12 ? "am" : "pm";
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${mm} ${suffix}`;
}

/** "16:00" / "4:00 pm" / "4pm" → minutes, or null if unparseable. */
export function parseTimeInput(input: string): number | null {
  const s = input.trim().toLowerCase().replace(/\s+/g, " ");
  let m = s.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/);
  if (!m) {
    m = s.match(/^(\d{1,2})(\d{2})\s*(am|pm)?$/);
    if (!m) return null;
  }
  let h = parseInt(m[1], 10);
  const min = m[2] ? parseInt(m[2], 10) : 0;
  const ap = m[3];
  if (min < 0 || min > 59) return null;
  if (ap) {
    if (h < 1 || h > 12) return null;
    if (ap === "am") h = h % 12;
    else h = (h % 12) + 12;
  } else {
    if (h < 0 || h > 24) return null;
    if (h === 24 && min !== 0) return null;
  }
  const total = h * 60 + min;
  return total >= 0 && total <= MINUTES_PER_DAY ? total : null;
}

export function durationMinutes(start: number, end: number): number {
  return end - start;
}

export function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

/** All 15-min slot labels inside [from, to). */
export function slotLabels(from: number, to: number): number[] {
  const out: number[] = [];
  for (let t = from; t < to; t += SLOT) out.push(t);
  return out;
}

/** Pixel geometry helper: minutes → % offset inside visible window. */
export function toPercent(minutes: number, visStart: number, visEnd: number): number {
  return ((minutes - visStart) / (visEnd - visStart)) * 100;
}
