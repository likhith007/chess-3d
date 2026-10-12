const BASE_MS = 500;
const MAX_MS = 10_000;

/** Exponential backoff with full jitter, so a server restart isn't hit by every client at once. */
export function reconnectDelay(attempt: number, random: () => number = Math.random): number {
  return Math.round(random() * Math.min(MAX_MS, BASE_MS * 2 ** attempt));
}
