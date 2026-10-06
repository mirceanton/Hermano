import type { HermesProfile } from "@hermano/shared"
import { useState, type FormEvent } from "react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { useCreateProfile, useUpdateProfile } from "@/lib/queries"

interface ProfileDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Present when editing an existing profile; absent for create. */
  profile?: HermesProfile
}

/** Create/edit dialog for a named Hermes profile — an endpoint (URL + optional API key) delegation rules can route to. */
export function ProfileDialog({ open, onOpenChange, profile }: ProfileDialogProps) {
  const isEdit = profile != null
  const [name, setName] = useState(profile?.name ?? "")
  const [url, setUrl] = useState(profile?.url ?? "")
  const [apiKey, setApiKey] = useState("")
  const [clearApiKey, setClearApiKey] = useState(false)
  const [useSharedConnection, setUseSharedConnection] = useState(profile?.useSharedConnection ?? false)
  const [error, setError] = useState<string | null>(null)

  const createProfile = useCreateProfile()
  const updateProfile = useUpdateProfile()
  const pending = createProfile.isPending || updateProfile.isPending

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)

    const trimmedName = name.trim()
    const trimmedUrl = url.trim()
    if (!trimmedName) {
      setError("Name is required.")
      return
    }
    if (!useSharedConnection && !trimmedUrl) {
      setError("URL is required.")
      return
    }

    const promise = isEdit
      ? updateProfile.mutateAsync({
          id: profile.id,
          patch: {
            name: trimmedName,
            useSharedConnection,
            ...(useSharedConnection
              ? {}
              : {
                  url: trimmedUrl,
                  // Omitted = keep the stored key; null = clear it.
                  ...(clearApiKey && { apiKey: null }),
                  ...(!clearApiKey && apiKey && { apiKey }),
                }),
          },
        })
      : createProfile.mutateAsync({
          name: trimmedName,
          useSharedConnection,
          ...(!useSharedConnection && {
            url: trimmedUrl,
            ...(apiKey && { apiKey }),
          }),
        })

    promise
      .then(() => onOpenChange(false))
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "Something went wrong."))
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit profile" : "Add profile"}</DialogTitle>
          <DialogDescription>
            A named Hermes profile that delegation rules can route to. A profile can share the default Hermes instance or connect to its own endpoint.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="profile-name" className="text-sm font-medium">
              Name
            </label>
            <Input id="profile-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. sre-bot" autoFocus />
          </div>

          <div>
            <label className="flex items-center gap-2 text-sm font-medium">
              <input
                type="checkbox"
                checked={useSharedConnection}
                onChange={(e) => setUseSharedConnection(e.target.checked)}
                className="size-4 rounded border-input"
              />
              Use shared Hermes connection
            </label>
            <p className="mt-1 text-xs text-muted-foreground">
              Inherit the URL and API key from the default Hermes Agent setting above instead of configuring separate credentials.
            </p>
          </div>

          {!useSharedConnection && (
            <>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="profile-url" className="text-sm font-medium">
                  URL
                </label>
                <Input
                  id="profile-url"
                  type="url"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="http://hermes-sre.ai.svc.cluster.local:8643"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="profile-key" className="text-sm font-medium">
                  API Key
                </label>
                <div className="flex gap-2">
                  <Input
                    id="profile-key"
                    type="password"
                    autoComplete="off"
                    value={apiKey}
                    onChange={(e) => {
                      setApiKey(e.target.value)
                      setClearApiKey(false)
                    }}
                    placeholder={profile?.apiKeySet ? "•••••••• (configured — leave blank to keep)" : "Not set"}
                  />
                  {profile?.apiKeySet && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setClearApiKey(true)
                        setApiKey("")
                      }}
                    >
                      Clear
                    </Button>
                  )}
                </div>
                {clearApiKey ? (
                  <p className="text-xs text-destructive">Will be cleared on save.</p>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    This profile's own <code className="rounded bg-muted px-1 py-0.5">API_SERVER_KEY</code>. It is never borrowed from the
                    default Hermes endpoint.
                  </p>
                )}
              </div>
            </>
          )}
          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <DialogClose render={<Button type="button" variant="outline" />}>Cancel</DialogClose>
            <Button type="submit" disabled={pending}>
              {isEdit ? "Save changes" : "Add profile"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
