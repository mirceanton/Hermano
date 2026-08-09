import type { Delegation } from "@hermano/shared"
import { ArrowLeft } from "lucide-react"
import { useState } from "react"
import { Link, useParams } from "react-router"
import { StatusBadge } from "@/components/status-badge"
import { SummaryMarkdown } from "@/components/summary-markdown"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Skeleton } from "@/components/ui/skeleton"
import { formatDuration, formatExactTime, formatRelativeTime, formatTokenUsage } from "@/lib/format"
import { useAlert, useDelegateAlert } from "@/lib/queries"
import { severityTextClass } from "@/lib/severity"

function DelegationDialog({ delegation, alertName, onClose }: { delegation: Delegation; alertName: string; onClose: () => void }) {
  const duration = formatDuration(delegation.delegatedAt, delegation.dispatchedAt, delegation.completedAt)

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{alertName}</DialogTitle>
        </DialogHeader>
        <div className="flex items-center gap-2">
          <StatusBadge status={delegation.status} />
          <span className="text-sm text-muted-foreground">via {delegation.rule.name}</span>
        </div>

        <div className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <div className="text-xs text-muted-foreground">Delegated</div>
            <div title={formatExactTime(delegation.delegatedAt)}>{formatRelativeTime(delegation.delegatedAt)}</div>
          </div>
          {delegation.dispatchedAt && (
            <div>
              <div className="text-xs text-muted-foreground">Dispatched</div>
              <div title={formatExactTime(delegation.dispatchedAt)}>{formatRelativeTime(delegation.dispatchedAt)}</div>
            </div>
          )}
          {delegation.completedAt && (
            <div>
              <div className="text-xs text-muted-foreground">Completed</div>
              <div title={formatExactTime(delegation.completedAt)}>{formatRelativeTime(delegation.completedAt)}</div>
            </div>
          )}
          {duration && (
            <div>
              <div className="text-xs text-muted-foreground">Duration</div>
              <div>{duration}</div>
            </div>
          )}
        </div>

        {(delegation.totalTokens != null || delegation.runId) && (
          <div className="grid grid-cols-2 gap-3 text-sm">
            {delegation.totalTokens != null && (
              <div>
                <div className="text-xs text-muted-foreground">Total tokens</div>
                <div>{formatTokenUsage(delegation.totalTokens)}</div>
              </div>
            )}
            {delegation.runId && (
              <div>
                <div className="text-xs text-muted-foreground">Run ID</div>
                <code className="text-xs">{delegation.runId}</code>
              </div>
            )}
          </div>
        )}

        <div>
          <div className="mb-1.5 text-xs font-medium text-muted-foreground uppercase">Report</div>
          {delegation.summary ? <SummaryMarkdown text={delegation.summary} /> : <p className="text-sm text-muted-foreground">No report yet.</p>}
        </div>
      </DialogContent>
    </Dialog>
  )
}

export function AlertDetailPage() {
  const { id } = useParams<{ id: string }>()
  const alertId = Number(id)
  const { data: alert, isPending } = useAlert(alertId)
  const delegateNow = useDelegateAlert(alertId)
  const [openDelegation, setOpenDelegation] = useState<Delegation | null>(null)

  if (isPending) {
    return (
      <div className="flex flex-col gap-3">
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-24" />
        <Skeleton className="h-48" />
      </div>
    )
  }

  if (!alert) {
    return <p className="text-sm text-muted-foreground">Alert not found.</p>
  }

  const canDelegate = alert.resolvedAt == null
  const status = alert.latestDelegation?.status

  return (
    <div>
      <Link to="/alerts" className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-3.5" />
        Back to history
      </Link>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className={`text-xl font-semibold ${severityTextClass(alert.severity)}`}>{alert.alertName}</h1>
          <div className="mt-1 flex items-center gap-2 text-sm text-muted-foreground">
            <span className="capitalize">{alert.severity || "unknown"}</span>
            <span>·</span>
            <span>{alert.resolvedAt ? "resolved" : "active"}</span>
            <span>·</span>
            <code className="text-xs">{alert.fingerprint}</code>
          </div>
        </div>

        {canDelegate && (
          <Button disabled={delegateNow.isPending} onClick={() => delegateNow.mutate()}>
            {status === "failed" || status === "timed_out" ? "Retry" : status ? "Delegate again" : "Delegate now"}
          </Button>
        )}
      </div>

      {Object.keys(alert.labels).length > 0 && (
        <div className="mb-4 flex flex-wrap gap-1.5">
          {Object.entries(alert.labels)
            .filter(([k]) => k !== "alertname")
            .map(([k, v]) => (
              <span key={k} className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                {k}={v}
              </span>
            ))}
        </div>
      )}

      {alert.annotations.summary && <p className="mb-6 text-sm">{alert.annotations.summary}</p>}

      <div className="mb-6 grid grid-cols-2 gap-3 rounded-xl border p-4 text-sm sm:grid-cols-4">
        <div>
          <div className="text-xs text-muted-foreground">Times fired</div>
          <div className="font-medium">{alert.timesFired}</div>
        </div>
        <div>
          <div className="text-xs text-muted-foreground">First fired</div>
          <div className="font-medium" title={formatExactTime(alert.firstFiredAt)}>
            {formatRelativeTime(alert.firstFiredAt)}
          </div>
        </div>
        <div>
          <div className="text-xs text-muted-foreground">Last fired</div>
          <div className="font-medium" title={formatExactTime(alert.lastFiredAt)}>
            {formatRelativeTime(alert.lastFiredAt)}
          </div>
        </div>
        {alert.resolvedAt && (
          <div>
            <div className="text-xs text-muted-foreground">Resolved</div>
            <div className="font-medium" title={formatExactTime(alert.resolvedAt)}>
              {formatRelativeTime(alert.resolvedAt)}
            </div>
          </div>
        )}
      </div>

      <h2 className="mb-2 text-sm font-semibold text-muted-foreground uppercase">Timeline</h2>
      <div className="mb-6 rounded-xl border">
        {alert.timeline.map((event, i) => (
          <div key={i} className="flex items-center justify-between gap-3 border-b px-3 py-2 text-sm last:border-b-0">
            <span>{event.label}</span>
            <span className="text-muted-foreground" title={formatExactTime(event.at)}>
              {formatRelativeTime(event.at)}
            </span>
          </div>
        ))}
      </div>

      <h2 className="mb-2 text-sm font-semibold text-muted-foreground uppercase">Delegations ({alert.delegations.length})</h2>
      {alert.delegations.length === 0 ? (
        <p className="text-sm text-muted-foreground">This alert hasn't been delegated yet.</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50 text-left text-xs text-muted-foreground uppercase">
                <th className="px-3 py-2 font-medium">Rule</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 font-medium">Duration</th>
                <th className="px-3 py-2 font-medium">Tokens</th>
                <th className="px-3 py-2 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {alert.delegations
                .slice()
                .reverse()
                .map((d) => (
                  <tr key={d.id} className="border-b last:border-b-0">
                    <td className="px-3 py-2">{d.rule.name}</td>
                    <td className="px-3 py-2">
                      <StatusBadge status={d.status} />
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {formatDuration(d.delegatedAt, d.dispatchedAt, d.completedAt) || "—"}
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">{formatTokenUsage(d.totalTokens) || "—"}</td>
                    <td className="px-3 py-2 text-right">
                      <Button variant="ghost" size="sm" onClick={() => setOpenDelegation(d)}>
                        View
                      </Button>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      )}

      {openDelegation && (
        <DelegationDialog delegation={openDelegation} alertName={alert.alertName} onClose={() => setOpenDelegation(null)} />
      )}
    </div>
  )
}
