/** Accent color for an alert's severity label — used sparingly against an otherwise near-monochrome UI. */
export function severityTextClass(severity: string): string {
  switch (severity.toLowerCase()) {
    case "critical":
      return "text-red-600 dark:text-red-400"
    case "warning":
      return "text-amber-600 dark:text-amber-400"
    default:
      return ""
  }
}
