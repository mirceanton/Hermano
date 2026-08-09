import type { DelegationLogEntry, DelegationStatus } from "@hermano/shared"
import { useState } from "react"
import { Link } from "react-router"
import { StatusBadge } from "@/components/status-badge"
import { SummaryMarkdown } from "@/components/summary-markdown"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { formatDuration, formatExactTime, formatRelativeTime, formatTokenUsage } from "@/lib/format"
import { useDelegations } from "@/lib/queries"

const STATUS_FILTERS: Array<{ label: string; value: DelegationStatus | "all" }> = [
  { label: "All", value: "all" },
  { label: "Pending", value: "pending" },
  { label: "Dispatched", value: "dispatched" },
  { label: "Completed", value: "completed" },
  { label: "Failed", value: "failed" },
  { label: "Timed out", value: "timed_out" },
]

function DelegationLogDialog({ entry, onClose }: { entry: DelegationLogEntry; onClose: () => void }) {
  const duration = formatDuration(entry.delegatedAt, entry.dispatchedAt, entry.completedAt)
  const matchers = Object.entries(entry.rule.matchers ?? {})

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{entry.alertName}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge status={entry.status} />
          <Link to={`/alerts/${entry.alertId}`} className="text-sm text-muted-foreground underline-offset-2 hover:underline">
            View alert {entry.alertActive ? "(active)" : "(resolved)"}
          </Link>
        </div>

        <div>
          <div className="mb-1 text-xs text-muted-foreground uppercase">Rule</div>
          <div className="text-sm font-medium">
            {entry.rule.name === "manual" ? "Manual delegation" : entry.rule.name}
          </div>
          {matchers.length > 0 && (
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {matchers.map(([k, v]) => (
                <span key={k} className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                  {k}={v}
                </span>
              ))}
            </div>
          )}
          {entry.rule.name !== "manual" && (
            <p className="mt-1 text-xs text-muted-foreground">
              Snapshotted at the time this delegation was created — the rule may have since been renamed, edited, or deleted.
            </p>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <div className="text-xs text-muted-foreground">Delegated</div>
            <div title={formatExactTime(entry.delegatedAt)}>{formatRelativeTime(entry.delegatedAt)}</div>
          </div>
          {duration && (
            <div>
              <div className="text-xs text-muted-foreground">Duration</div>
              <div>{duration}</div>
            </div>
          )}
          {entry.totalTokens != null && (
            <div>
              <div className="text-xs text-muted-foreground">Tokens</div>
              <div>{formatTokenUsage(entry.totalTokens)}</div>
            </div>
          )}
          {entry.runId && (
            <div>
              <div className="text-xs text-muted-foreground">Run ID</div>
              <code className="text-xs">{entry.runId}</code>
            </div>
          )}
        </div>

        <div>
          <div className="mb-1.5 text-xs font-medium text-muted-foreground uppercase">Report</div>
          {entry.summary ? <SummaryMarkdown text={entry.summary} /> : <p className="text-sm text-muted-foreground">No report yet.</p>}
        </div>
      </DialogContent>
    </Dialog>
  )
}

export function DelegationsPage() {
  const [page, setPage] = useState(1)
  const [status, setStatus] = useState<DelegationStatus | "all">("all")
  const [search, setSearch] = useState("")
  const [openEntry, setOpenEntry] = useState<DelegationLogEntry | null>(null)

  const { data, isPending } = useDelegations({ page })
  const rows = data?.data ?? []

  const filtered = rows.filter((entry) => {
    if (status !== "all" && entry.status !== status) return false
    const q = search.trim().toLowerCase()
    if (!q) return true
    return `${entry.alertName} ${entry.rule.name}`.toLowerCase().includes(q)
  })

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1

  return (
    <div>
      <h1 className="mb-6 text-xl font-semibold">Delegations</h1>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Input
          type="search"
          placeholder="Search by alert or rule…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-xs"
        />
        <div className="flex flex-wrap items-center gap-1 rounded-lg bg-muted p-[3px]">
          {STATUS_FILTERS.map((f) => (
            <button
              key={f.value}
              type="button"
              onClick={() => setStatus(f.value)}
              className={`rounded-md px-3 py-1 text-sm font-medium transition-colors ${
                status === f.value ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {f.label}
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

      {!isPending && filtered.length === 0 && <p className="text-sm text-muted-foreground">No delegations yet.</p>}

      {filtered.length > 0 && (
        <div className="overflow-x-auto rounded-xl border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50 text-left text-xs text-muted-foreground uppercase">
                <th className="px-3 py-2 font-medium">Alert</th>
                <th className="px-3 py-2 font-medium">Rule</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 font-medium">Delegated</th>
                <th className="px-3 py-2 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((entry) => (
                <tr key={entry.id} className="border-b last:border-b-0">
                  <td className="px-3 py-2">
                    <div className="font-medium">{entry.alertName}</div>
                    <div className="text-xs text-muted-foreground">{entry.alertActive ? "active" : "resolved"}</div>
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {entry.rule.name === "manual" ? "Manual" : entry.rule.name}
                  </td>
                  <td className="px-3 py-2">
                    <StatusBadge status={entry.status} />
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap text-muted-foreground" title={formatExactTime(entry.delegatedAt)}>
                    {formatRelativeTime(entry.delegatedAt)}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <Button variant="ghost" size="sm" onClick={() => setOpenEntry(entry)}>
                      View
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

      {openEntry && <DelegationLogDialog entry={openEntry} onClose={() => setOpenEntry(null)} />}
    </div>
  )
}
