import type { LabelMap } from "@hermano/shared"
import { useState, type FormEvent } from "react"
import { MatcherBuilder } from "@/components/matcher-builder"
import { Button } from "@/components/ui/button"
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { useCreateRule, useUpdateRule } from "@/lib/queries"

interface RuleDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Present when editing an existing rule; absent for create (optionally pre-filled via initial). */
  rule?: { id: number; name: string; matchers: LabelMap; enabled: boolean }
  initial?: { name?: string; matchers?: LabelMap }
}

/**
 * Single reusable create/edit dialog, used by both the Rules page's
 * add/edit actions and the Overview page's "Forward this kind" quick
 * action (which pre-fills name/matchers from a specific alert).
 */
export function RuleDialog({ open, onOpenChange, rule, initial }: RuleDialogProps) {
  const isEdit = rule != null
  const [name, setName] = useState(rule?.name ?? initial?.name ?? "")
  const [matchers, setMatchers] = useState<LabelMap>(rule?.matchers ?? initial?.matchers ?? {})
  const [enabled, setEnabled] = useState(rule?.enabled ?? true)
  const [error, setError] = useState<string | null>(null)

  const createRule = useCreateRule()
  const updateRule = useUpdateRule()
  const pending = createRule.isPending || updateRule.isPending

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)

    const trimmedName = name.trim()
    if (!trimmedName) {
      setError("Name is required.")
      return
    }
    if (Object.keys(matchers).length === 0) {
      setError("At least one matcher is required.")
      return
    }

    const promise = isEdit
      ? updateRule.mutateAsync({ id: rule.id, patch: { name: trimmedName, matchers, enabled } })
      : createRule.mutateAsync({ name: trimmedName, matchers, enabled })

    promise
      .then(() => onOpenChange(false))
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "Something went wrong."))
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit rule" : "Add rule"}</DialogTitle>
          <DialogDescription>
            Alerts whose labels match every matcher below get forwarded to Hermes from now on — already-firing alerts
            of that kind get delegated the next time Alertmanager re-notifies about them.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="rule-name" className="text-sm font-medium">
              Name
            </label>
            <Input
              id="rule-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. forward KubePodCrashLooping"
              autoFocus
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">Matchers</span>
            <MatcherBuilder value={matchers} onChange={setMatchers} />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
              className="size-4 rounded border-input"
            />
            Enabled
          </label>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <DialogClose render={<Button type="button" variant="outline" />}>Cancel</DialogClose>
            <Button type="submit" disabled={pending}>
              {isEdit ? "Save changes" : "Add rule"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
