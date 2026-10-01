import type { LabelMap } from "@hermano/shared"
import { useState, type FormEvent } from "react"
import { MatcherBuilder } from "@/components/matcher-builder"
import { Button } from "@/components/ui/button"
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { useCreateRule, useProfiles, useUpdateRule } from "@/lib/queries"

interface RuleDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Present when editing an existing rule; absent for create (optionally pre-filled via initial). */
  rule?: { id: number; name: string; matchers: LabelMap; enabled: boolean; profileId: number | null }
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
  // null = the default Hermes endpoint (Settings → Hermes Agent).
  const [profileId, setProfileId] = useState<number | null>(rule?.profileId ?? null)
  const [error, setError] = useState<string | null>(null)

  const { data: profiles } = useProfiles()
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
      ? updateRule.mutateAsync({ id: rule.id, patch: { name: trimmedName, matchers, enabled, profileId } })
      : createRule.mutateAsync({ name: trimmedName, matchers, enabled, profileId })

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
            of that kind get delegated the next time Alertmanager re-notifies about them. If several rules match an alert,
            the one with the most matchers wins.
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
          <div className="flex flex-col gap-1.5">
            <label htmlFor="rule-profile" className="text-sm font-medium">
              Hermes profile
            </label>
            <select
              id="rule-profile"
              value={profileId ?? ""}
              onChange={(e) => setProfileId(e.target.value === "" ? null : Number(e.target.value))}
              className="h-8 w-full rounded-lg border border-input bg-transparent px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
            >
              <option value="">Default (Settings → Hermes Agent)</option>
              {(profiles ?? []).map((profile) => (
                <option key={profile.id} value={profile.id}>
                  {profile.name}
                </option>
              ))}
            </select>
            <p className="text-xs text-muted-foreground">
              Which Hermes handles alerts matching this rule. Profiles are managed under Settings.
            </p>
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
