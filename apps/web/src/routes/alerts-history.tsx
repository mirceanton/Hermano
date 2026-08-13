import type { AlertListItem } from "@hermano/shared"
import { useState } from "react"
import { useNavigate } from "react-router"
import { RuleDialog } from "@/components/rule-dialog"
import { StatusBadge } from "@/components/status-badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { formatExactTime, formatRelativeTime, truncate } from "@/lib/format"
import { useAlerts } from "@/lib/queries"
import { severityTextClass } from "@/lib/severity"

type SeverityFilter = "all" | "critical" | "warning"

export function AlertsHistoryPage() {
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState("")
  const [severity, setSeverity] = useState<SeverityFilter>("all")
  const [forwardAlert, setForwardAlert] = useState<AlertListItem | null>(null)

  const { data, isPending } = useAlerts({ status: "resolved", page })
  const rows = data?.data ?? []

  // Filtering a single already-fetched page (capped at pageSize) is cheap
  // enough to redo on every render — no need for useMemo here.
  const q = search.trim().toLowerCase()
  const filtered = rows.filter((alert) => {
    if (severity !== "all" && alert.severity.toLowerCase() !== severity) return false
    if (!q) return true
    const haystack = [alert.alertName, ...Object.entries(alert.labels).map(([k, v]) => `${k}=${v}`)]
      .join(" ")
      .toLowerCase()
    return haystack.includes(q)
  })

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1
  const navigate = useNavigate()

  return (
    <div>
      <h1 className="mb-6 text-xl font-semibold">Alert History</h1>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Input
          type="search"
          placeholder="Search by name or label…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-xs"
        />
        <div className="flex items-center gap-1 rounded-lg bg-muted p-[3px]">
          {(["all", "critical", "warning"] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setSeverity(s)}
              className={`rounded-md px-3 py-1 text-sm font-medium capitalize transition-colors ${
                severity === s ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      {isPending && (
        <div className="flex flex-col gap-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-10" />
          ))}
        </div>
      )}

      {!isPending && filtered.length === 0 && (
        <p className="text-sm text-muted-foreground">No resolved alerts{search ? " matching your search" : ""}.</p>
      )}

      {filtered.length > 0 && (
        <div className="overflow-x-auto rounded-xl border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50 text-left text-xs text-muted-foreground uppercase">
                <th className="px-3 py-2 font-medium">Alert</th>
                <th className="px-3 py-2 font-medium">Summary</th>
                <th className="px-3 py-2 font-medium">Fired</th>
                <th className="px-3 py-2 font-medium">Resolved</th>
                <th className="px-3 py-2 font-medium">Delegation</th>
                <th className="px-3 py-2 font-medium">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((alert) => (
                <tr
                  key={alert.id}
                  className="cursor-pointer border-b last:border-b-0 hover:bg-muted/40"
                  onClick={() => navigate(`/alerts/${alert.id}`)}
                >
                  <td className="px-3 py-2">
                    <div className={`font-medium ${severityTextClass(alert.severity)}`}>{alert.alertName}</div>
                    <div className="text-xs text-muted-foreground">{alert.timesFired}× fired</div>
                  </td>
                  <td className="max-w-xs px-3 py-2 text-muted-foreground">
                    {truncate(alert.annotations.summary ?? "", 80)}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap text-muted-foreground" title={formatExactTime(alert.startsAt)}>
                    {formatRelativeTime(alert.startsAt)}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap text-muted-foreground" title={formatExactTime(alert.resolvedAt)}>
                    {formatRelativeTime(alert.resolvedAt)}
                  </td>
                  <td className="px-3 py-2">
                    {alert.latestDelegation ? <StatusBadge status={alert.latestDelegation.status} /> : "—"}
                  </td>
                  <td className="px-3 py-2 text-right whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                    <Button type="button" variant="ghost" size="sm" onClick={() => setForwardAlert(alert)}>
                      Forward this kind →
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {data && data.total > data.pageSize && (
        <div className="mt-4 flex items-center justify-between text-sm text-muted-foreground">
          <span>
            Page {page} of {totalPages}
          </span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
              Previous
            </Button>
            <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
              Next
            </Button>
          </div>
        </div>
      )}

      {forwardAlert && (
        <RuleDialog
          key={forwardAlert.id}
          open
          onOpenChange={(open) => !open && setForwardAlert(null)}
          initial={{ name: `forward ${forwardAlert.alertName}`, matchers: { alertname: forwardAlert.alertName } }}
        />
      )}
    </div>
  )
}
