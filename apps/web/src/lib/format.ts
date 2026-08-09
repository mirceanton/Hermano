const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/** Bucketed relative time ("just now" / "3h ago" / "yesterday" / "last week" / a calendar-date fallback). */
export function formatRelativeTime(ms: number | null): string {
  if (ms == null) return "-"
  const now = Date.now()
  const diff = now - ms
  if (diff < MINUTE) return "just now"
  if (diff < HOUR) return `${Math.floor(diff / MINUTE)}m ago`
  if (diff < DAY) return `${Math.floor(diff / HOUR)}h ago`

  const dayStart = (t: number) => {
    const d = new Date(t)
    d.setHours(0, 0, 0, 0)
    return d.getTime()
  }
  const days = Math.round((dayStart(now) - dayStart(ms)) / DAY)

  if (days === 1) return "yesterday"
  if (days < 7) return `${days} days ago`
  if (days < 14) return "last week"
  if (days < 30) return `${Math.floor(days / 7)} weeks ago`
  return new Date(ms).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })
}

/** Full local date/time, meant for a title="" tooltip alongside formatRelativeTime's bucketed label. */
export function formatExactTime(ms: number | null): string {
  if (ms == null) return ""
  return new Date(ms).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    timeZoneName: "short",
  })
}

/** Compact human-readable token count (e.g. "2.2M", "3.4K", "512"). */
export function formatTokenCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}

/** A nullable per-delegation token count as "2.2M tokens", or "" when Hermes never reported usage. */
export function formatTokenUsage(n: number | null): string {
  if (n == null) return ""
  return `${formatTokenCount(n)} tokens`
}

/** How long a delegation took from dispatch (or creation, if never dispatched) to completion. "" if not yet complete. */
export function formatDuration(delegatedAt: number | null, dispatchedAt: number | null, completedAt: number | null): string {
  if (completedAt == null) return ""
  const start = dispatchedAt ?? delegatedAt
  if (start == null) return ""

  let totalSeconds = Math.round(Math.max(0, completedAt - start) / 1000)
  const hours = Math.floor(totalSeconds / 3600)
  totalSeconds -= hours * 3600
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds - minutes * 60

  const parts: string[] = []
  if (hours > 0) parts.push(`${hours}h`)
  if (hours > 0 || minutes > 0) parts.push(`${minutes}m`)
  parts.push(`${seconds}s`)
  return parts.join(" ")
}

/** Caps s at max characters (appending an ellipsis if cut), so preview text stays a predictable length. */
export function truncate(s: string, max: number): string {
  const chars = Array.from(s.trim())
  if (chars.length <= max) return chars.join("")
  return chars.slice(0, max).join("") + "…"
}
