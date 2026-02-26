/**
 * Floor timestamp to the start of the 5-minute window (UTC).
 * e.g. 2026-02-23T21:03:47Z -> 2026-02-23T21:00:00Z
 */
export function getWindowTs(date: Date): Date {
  const ms = date.getTime()
  const fiveMinMs = 5 * 60 * 1000
  const windowMs = Math.floor(ms / fiveMinMs) * fiveMinMs
  return new Date(windowMs)
}

/**
 * Percent change from previous value: ((current - prev) / prev) * 100
 * Returns null if prev is 0 or invalid.
 */
export function pctChange(current: number, prev: number): number | null {
  if (prev === 0 || !Number.isFinite(prev) || !Number.isFinite(current)) return null
  return Number((((current - prev) / prev) * 100).toFixed(4))
}
