import type { AlertListItem } from "@hermano/shared"
import { useState } from "react"
import { useNavigate } from "react-router"
import { RuleDialog } from "@/components/rule-dialog"
import { StatusBadge } from "@/components/status-badge"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { formatRelativeTime, formatTokenCount, truncate } from "@/lib/format"
import { useAlerts, useDelegateAlert, useOverview } from "@/lib/queries"
import { severityTextClass } from "@/lib/severity"

function StatTile({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex-1 min-w-[130px] border-r border-border py-3 px-4 last:border-r-0">
      <div className="font-heading text-2xl font-extrabold">{value}</div>
      <div className="mt-0.5 text-[10.5px] tracking-wide text-muted-foreground uppercase">{label}</div>
    </div>
  )
}

function NeedsAttentionPanel({ undelegated, failed }: { undelegated: number; failed: number }) {
  if (!undelegated && !failed) {
    return (
      <div className="mb-6 rounded-xl border p-4 text-sm text-muted-foreground">
        All clear — nothing needs attention right now.
      </div>
    )
  }

  return (
    <div className="mb-6 flex flex-wrap rounded-xl border">
      {undelegated > 0 && (
        <div className="flex min-w-[240px] flex-1 flex-col items-center gap-1.5 p-4 text-center">
          <div className="text-[11px] font-bold tracking-wide text-red-600 uppercase dark:text-red-400">
            ▲ Needs attention
          </div>
          <div className="font-heading text-3xl font-extrabold">{undelegated}</div>
          <div className="text-sm text-muted-foreground">active alert(s) not yet delegated</div>
        </div>
      )}
      {failed > 0 && (
        <div className="flex min-w-[240px] flex-1 flex-col items-center gap-1.5 border-t p-4 text-center sm:border-t-0 sm:border-l">
          <div className="text-[11px] font-bold tracking-wide text-red-600 uppercase dark:text-red-400">
            ▲ Needs attention
          </div>
          <div className="font-heading text-3xl font-extrabold">{failed}</div>
          <div className="text-sm text-muted-foreground">failed or timed-out delegation(s)</div>
        </div>
      )}
    </div>
  )
}

function AlertCard({ alert, onForwardKind }: { alert: AlertListItem; onForwardKind: (alert: AlertListItem) => void }) {
  const navigate = useNavigate()
  const delegateNow = useDelegateAlert(alert.id)
  const status = alert.latestDelegation?.status

  return (
    <div
      className="flex cursor-pointer flex-col gap-2.5 rounded-xl border p-3 transition-colors hover:border-foreground/20"
      onClick={() => navigate(`/alerts/${alert.id}`)}
    >
      <div className="flex items-start justify-between gap-2">
        <div className={`truncate font-heading text-base font-extrabold ${severityTextClass(alert.severity)}`}>
          {alert.alertName}
        </div>
        {status && <StatusBadge status={status} />}
      </div>

      <div className="flex gap-3 text-[11px] text-muted-foreground">
        <span>{alert.timesFired}× fired</span>
        <span>
          first {formatRelativeTime(alert.firstFiredAt)} · last {formatRelativeTime(alert.lastFiredAt)}
        </span>
      </div>

      <p className="m-0 line-clamp-2 min-h-[36px] text-[13px] leading-[18px] text-foreground/85">
        {truncate(alert.annotations.summary ?? "", 140)}
      </p>

      <div
        className={`flex min-h-[34px] flex-wrap items-center gap-2 ${!status ? "justify-between" : "justify-end"}`}
        onClick={(e) => e.stopPropagation()}
      >
        {!status && (
          <>
            <Button type="button" variant="ghost" size="sm" onClick={() => onForwardKind(alert)}>
              Forward this kind →
            </Button>
            <Button type="button" size="sm" disabled={delegateNow.isPending} onClick={() => delegateNow.mutate()}>
              Delegate now
            </Button>
          </>
        )}
        {(status === "failed" || status === "timed_out") && (
          <Button type="button" size="sm" disabled={delegateNow.isPending} onClick={() => delegateNow.mutate()}>
            Retry
          </Button>
        )}
      </div>
    </div>
  )
}

export function OverviewPage() {
  const { data: stats } = useOverview()
  const { data: active, isPending } = useAlerts({ status: "firing" })
  const [forwardAlert, setForwardAlert] = useState<AlertListItem | null>(null)

  const alerts = active?.data ?? []

  return (
    <div>
      {stats && <NeedsAttentionPanel undelegated={stats.undelegatedActive} failed={stats.failedActive} />}

      {stats && (
        <div className="mb-6 flex flex-wrap rounded-xl border">
          <StatTile label="Open Alerts" value={stats.openAlerts} />
          <StatTile label="Resolved" value={stats.totalResolved} />
          <StatTile label="Sessions Dispatched" value={stats.dispatched} />
          <StatTile label="Completed by Agent" value={stats.completed} />
          <StatTile label="Failed / Timed Out" value={stats.failed} />
          <StatTile
            label="Active Rules"
            value={
              <>
                {stats.activeRules}
                <span className="text-base font-normal text-muted-foreground">/{stats.totalRules}</span>
              </>
            }
          />
          <StatTile label="Tokens Used" value={formatTokenCount(stats.totalTokens)} />
        </div>
      )}

      <div className="mt-8 mb-4 flex items-center gap-2.5">
        <h2 className="m-0 text-lg font-semibold">Active Alerts</h2>
        <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">{alerts.length}</span>
      </div>

      {isPending && (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-36 rounded-xl" />
          ))}
        </div>
      )}

      {!isPending && alerts.length === 0 && <p className="text-sm text-muted-foreground">No alerts currently firing.</p>}

      {alerts.length > 0 && (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-4">
          {alerts.map((alert) => (
            <AlertCard key={alert.id} alert={alert} onForwardKind={setForwardAlert} />
          ))}
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
