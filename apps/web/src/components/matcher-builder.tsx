import { matchesLabels, type LabelMap } from "@hermano/shared"
import { Plus, X } from "lucide-react"
import { useId, useMemo, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useAlerts } from "@/lib/queries"

interface MatcherRow {
  key: string
  value: string
}

function matchersToRows(matchers: LabelMap): MatcherRow[] {
  const entries = Object.entries(matchers)
  return entries.length > 0 ? entries.map(([key, value]) => ({ key, value })) : [{ key: "", value: "" }]
}

function rowsToMatchers(rows: MatcherRow[]): LabelMap {
  const matchers: LabelMap = {}
  for (const row of rows) {
    const key = row.key.trim()
    const value = row.value.trim()
    if (key && value) matchers[key] = value
  }
  return matchers
}

/**
 * Key/value matcher-row builder with a live "would match N alerts" preview,
 * a behavioral port of the old server-rendered dashboard's vanilla-JS
 * initRuleBuilder. Reuses whatever's already in the TanStack Query cache
 * for firing alerts (no dedicated endpoint needed) and the same
 * matchesLabels predicate the server's ingest transaction uses.
 */
export function MatcherBuilder({ value, onChange }: { value: LabelMap; onChange: (matchers: LabelMap) => void }) {
  const [rows, setRows] = useState<MatcherRow[]>(() => matchersToRows(value))
  const idPrefix = useId()

  const { data: active } = useAlerts({ status: "firing" })
  const activeAlerts = useMemo(() => active?.data ?? [], [active])

  const keyOptions = useMemo(() => {
    const keys = new Set<string>(["alertname"])
    for (const alert of activeAlerts) {
      for (const key of Object.keys(alert.labels)) keys.add(key)
    }
    return Array.from(keys).sort()
  }, [activeAlerts])

  function valuesFor(key: string): string[] {
    const values = new Set<string>()
    for (const alert of activeAlerts) {
      const v = key === "alertname" ? alert.alertName : alert.labels[key]
      if (v) values.add(v)
    }
    return Array.from(values).sort()
  }

  function updateRows(next: MatcherRow[]) {
    setRows(next)
    onChange(rowsToMatchers(next))
  }

  function updateRow(index: number, patch: Partial<MatcherRow>) {
    updateRows(rows.map((row, i) => (i === index ? { ...row, ...patch } : row)))
  }

  function addRow() {
    updateRows([...rows, { key: "", value: "" }])
  }

  function removeRow(index: number) {
    const next = rows.filter((_, i) => i !== index)
    updateRows(next.length > 0 ? next : [{ key: "", value: "" }])
  }

  const activeMatchers = rowsToMatchers(rows)
  const hasMatchers = Object.keys(activeMatchers).length > 0
  const matches = hasMatchers
    ? activeAlerts.filter((alert) => matchesLabels({ alertname: alert.alertName, ...alert.labels }, activeMatchers))
    : []

  return (
    <div className="flex flex-col gap-2">
      {rows.map((row, i) => (
        <div key={i} className="flex items-center gap-2">
          <Input
            placeholder="key"
            value={row.key}
            list={`${idPrefix}-keys`}
            onChange={(e) => updateRow(i, { key: e.target.value })}
          />
          <span className="text-muted-foreground">=</span>
          <Input
            placeholder="value"
            value={row.value}
            list={`${idPrefix}-values-${i}`}
            onChange={(e) => updateRow(i, { value: e.target.value })}
          />
          <Button type="button" variant="ghost" size="icon-sm" aria-label="Remove matcher" onClick={() => removeRow(i)}>
            <X className="size-3.5" />
          </Button>
          <datalist id={`${idPrefix}-values-${i}`}>
            {valuesFor(row.key.trim()).map((v) => (
              <option key={v} value={v} />
            ))}
          </datalist>
        </div>
      ))}
      <datalist id={`${idPrefix}-keys`}>
        {keyOptions.map((k) => (
          <option key={k} value={k} />
        ))}
      </datalist>
      <Button type="button" variant="secondary" size="sm" className="self-start" onClick={addRow}>
        <Plus className="size-3.5" /> Add matcher
      </Button>
      <p className="text-xs text-muted-foreground">
        {!hasMatchers ? (
          "Add at least one key/value matcher to preview which active alerts qualify."
        ) : (
          <>
            Would match <strong className="text-foreground">{matches.length}</strong> currently active alert(s)
            {matches.length > 0 ? `: ${matches.map((m) => m.alertName).join(", ")}` : "."}
          </>
        )}
      </p>
    </div>
  )
}
