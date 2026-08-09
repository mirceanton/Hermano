import type { DelegationRule } from "@hermano/shared"
import { Pencil, Plus, Trash2 } from "lucide-react"
import { useMemo, useState } from "react"
import { RuleDialog } from "@/components/rule-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { formatRelativeTime } from "@/lib/format"
import { useDeleteRule, useRules, useUpdateRule } from "@/lib/queries"

type StatusFilter = "all" | "enabled" | "disabled"

export function RulesPage() {
  const { data: rules, isPending } = useRules()
  const updateRule = useUpdateRule()
  const deleteRule = useDeleteRule()

  const [search, setSearch] = useState("")
  const [status, setStatus] = useState<StatusFilter>("all")
  const [editing, setEditing] = useState<DelegationRule | "new" | null>(null)

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return (rules ?? []).filter((rule) => {
      if (status === "enabled" && !rule.enabled) return false
      if (status === "disabled" && rule.enabled) return false
      if (!q) return true
      const haystack = [rule.name, ...Object.entries(rule.matchers).map(([k, v]) => `${k}=${v}`)].join(" ").toLowerCase()
      return haystack.includes(q)
    })
  }, [rules, search, status])

  return (
    <div>
      <div className="mb-6 flex items-center gap-4">
        <div>
          <h1 className="text-xl font-semibold">Delegation Rules</h1>
          <p className="mt-1 max-w-lg text-sm text-muted-foreground">
            By default, no alerts are forwarded to Hermes. Add a rule to forward alerts matching a set of labels —
            matching is <strong>AND</strong> across all key=value pairs. Rules apply going forward.
          </p>
        </div>
        <Button className="ml-auto" onClick={() => setEditing("new")}>
          <Plus className="size-4" /> Add rule
        </Button>
      </div>

      {isPending && (
        <div className="flex flex-col gap-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-10" />
          ))}
        </div>
      )}

      {!isPending && (rules?.length ?? 0) === 0 && (
        <p className="text-sm text-muted-foreground">No delegation rules yet — nothing is being forwarded to Hermes.</p>
      )}

      {rules && rules.length > 0 && (
        <>
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <Input
              type="search"
              placeholder="Search rules by name or matcher…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="max-w-xs"
            />
            <div className="flex items-center gap-1 rounded-lg bg-muted p-[3px]">
              {(["all", "enabled", "disabled"] as const).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setStatus(s)}
                  className={`rounded-md px-3 py-1 text-sm font-medium capitalize transition-colors ${
                    status === s ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>

          <div className="overflow-x-auto rounded-xl border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50 text-left text-xs text-muted-foreground uppercase">
                  <th className="px-3 py-2 font-medium">Name</th>
                  <th className="px-3 py-2 font-medium">Matchers</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                  <th className="px-3 py-2 font-medium">Created</th>
                  <th className="px-3 py-2 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((rule) => (
                  <tr key={rule.id} className="border-b last:border-b-0">
                    <td className="px-3 py-2 font-medium">{rule.name}</td>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap gap-1.5">
                        {Object.entries(rule.matchers).map(([k, v]) => (
                          <span key={k} className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                            {k}={v}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <Badge variant={rule.enabled ? "default" : "outline"}>{rule.enabled ? "enabled" : "disabled"}</Badge>
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">{formatRelativeTime(rule.createdAt)}</td>
                    <td className="px-3 py-2">
                      <div className="flex justify-end gap-1">
                        <Button variant="secondary" size="icon-sm" aria-label="Edit rule" onClick={() => setEditing(rule)}>
                          <Pencil className="size-3.5" />
                        </Button>
                        <Button
                          variant="secondary"
                          size="icon-sm"
                          aria-label={rule.enabled ? "Disable rule" : "Enable rule"}
                          className={rule.enabled ? "" : "opacity-45"}
                          onClick={() => updateRule.mutate({ id: rule.id, patch: { enabled: !rule.enabled } })}
                        >
                          <span className="text-xs">⏻</span>
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label="Delete rule"
                          className="text-destructive hover:bg-destructive/10"
                          onClick={() => {
                            if (window.confirm("Delete this rule?")) deleteRule.mutate(rule.id)
                          }}
                        >
                          <Trash2 className="size-3.5" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {editing && (
        <RuleDialog
          key={editing === "new" ? "new" : editing.id}
          open
          onOpenChange={(open) => !open && setEditing(null)}
          rule={editing === "new" ? undefined : editing}
        />
      )}
    </div>
  )
}
