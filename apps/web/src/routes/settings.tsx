import type { SettingsResponse } from "@hermano/shared"
import { RotateCcw } from "lucide-react"
import { useEffect, useId, useState, type FormEvent, type ReactNode } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { Textarea } from "@/components/ui/textarea"
import { useSettings, useUpdateSettings } from "@/lib/queries"

function EnvCaption({ envVar }: { envVar: string }) {
  return (
    <p className="text-xs text-muted-foreground">
      Set via <code className="rounded bg-muted px-1 py-0.5">{envVar}</code>
    </p>
  )
}

function Field({ label, htmlFor, children, caption }: { label: string; htmlFor: string; children: ReactNode; caption?: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={htmlFor} className="text-sm font-medium">
        {label}
      </label>
      {children}
      {caption}
    </div>
  )
}

interface SecretFieldProps {
  id: string
  label: string
  isSet: boolean
  locked: boolean
  envVar?: string
  value: string
  clearing: boolean
  onChange: (value: string) => void
  onClear: () => void
}

function SecretField({ id, label, isSet, locked, envVar, value, clearing, onChange, onClear }: SecretFieldProps) {
  return (
    <Field
      label={label}
      htmlFor={id}
      caption={
        locked && envVar ? (
          <EnvCaption envVar={envVar} />
        ) : clearing ? (
          <p className="text-xs text-destructive">Will be cleared on save.</p>
        ) : undefined
      }
    >
      <div className="flex gap-2">
        <Input
          id={id}
          type="password"
          autoComplete="off"
          disabled={locked}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={isSet ? "•••••••• (configured — leave blank to keep)" : "Not set"}
        />
        {isSet && !locked && (
          <Button type="button" variant="ghost" size="sm" onClick={onClear}>
            Clear
          </Button>
        )}
      </div>
    </Field>
  )
}

function SavedNote({ show }: { show: boolean }) {
  if (!show) return null
  return <span className="text-sm text-muted-foreground">Saved</span>
}

function GeneralSection({ general }: { general: SettingsResponse["general"] }) {
  const idPrefix = useId()
  const updateSettings = useUpdateSettings()

  const [publicUrl, setPublicUrl] = useState(general.publicUrl.value)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    setPublicUrl(general.publicUrl.value)
  }, [general.publicUrl.value])

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    updateSettings.mutate({ publicUrl: publicUrl.trim() === "" ? null : publicUrl }, { onSuccess: () => setSaved(true) })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>General</CardTitle>
        <CardDescription>Where Hermano itself is reachable — used to build links back into the dashboard.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <Field
            label="Public URL"
            htmlFor={`${idPrefix}-public-url`}
            caption={
              general.publicUrl.locked ? (
                <EnvCaption envVar="HERMANO_PUBLIC_URL" />
              ) : (
                <p className="text-xs text-muted-foreground">
                  Used to build the "View in Hermano" link in Pushover notifications, and as the OIDC redirect default. Defaults to
                  this server's own <code className="rounded bg-muted px-1 py-0.5">http://127.0.0.1:&lt;port&gt;</code> origin when
                  left empty, which is only reachable from the server itself.
                </p>
              )
            }
          >
            <Input
              id={`${idPrefix}-public-url`}
              type="url"
              disabled={general.publicUrl.locked}
              value={publicUrl}
              onChange={(e) => {
                setPublicUrl(e.target.value)
                setSaved(false)
              }}
              placeholder="https://hermano.example.com"
            />
          </Field>

          {updateSettings.isError && <p className="text-sm text-destructive">{updateSettings.error.message}</p>}

          <div className="flex items-center gap-3">
            <Button type="submit" disabled={updateSettings.isPending || general.publicUrl.locked}>
              Save
            </Button>
            <SavedNote show={saved} />
          </div>
        </form>
      </CardContent>
    </Card>
  )
}

function HermesSection({ hermes }: { hermes: SettingsResponse["hermes"] }) {
  const idPrefix = useId()
  const updateSettings = useUpdateSettings()

  const [agentUrl, setAgentUrl] = useState(hermes.agentUrl.value)
  const [dispatchTimeoutMs, setDispatchTimeoutMs] = useState(String(hermes.dispatchTimeoutMs.value))
  const [pollIntervalMs, setPollIntervalMs] = useState(String(hermes.pollIntervalMs.value))
  const [apiKeyInput, setApiKeyInput] = useState("")
  const [clearApiKey, setClearApiKey] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    setAgentUrl(hermes.agentUrl.value)
    setDispatchTimeoutMs(String(hermes.dispatchTimeoutMs.value))
    setPollIntervalMs(String(hermes.pollIntervalMs.value))
    setApiKeyInput("")
    setClearApiKey(false)
  }, [hermes.agentUrl.value, hermes.dispatchTimeoutMs.value, hermes.pollIntervalMs.value])

  function markDirty() {
    setSaved(false)
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    updateSettings.mutate(
      {
        ...(!hermes.agentUrl.locked && { hermesAgentUrl: agentUrl }),
        ...(!hermes.agentApiKeyLocked && clearApiKey && { hermesAgentApiKey: null }),
        ...(!hermes.agentApiKeyLocked && !clearApiKey && apiKeyInput && { hermesAgentApiKey: apiKeyInput }),
        ...(!hermes.dispatchTimeoutMs.locked && { hermesDispatchTimeoutMs: Number(dispatchTimeoutMs) }),
        ...(!hermes.pollIntervalMs.locked && { hermesPollIntervalMs: Number(pollIntervalMs) }),
      },
      { onSuccess: () => setSaved(true) },
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Hermes Agent</CardTitle>
        <CardDescription>Where and how alerts get dispatched to Hermes for investigation.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <Field label="Agent URL" htmlFor={`${idPrefix}-url`} caption={hermes.agentUrl.locked ? <EnvCaption envVar="HERMANO_HERMES_AGENT_URL" /> : undefined}>
            <Input
              id={`${idPrefix}-url`}
              type="url"
              disabled={hermes.agentUrl.locked}
              value={agentUrl}
              onChange={(e) => {
                setAgentUrl(e.target.value)
                markDirty()
              }}
              placeholder="http://hermes-api.ai.svc.cluster.local:8642"
            />
          </Field>

          <SecretField
            id={`${idPrefix}-key`}
            label="API Key"
            isSet={hermes.agentApiKeySet}
            locked={hermes.agentApiKeyLocked}
            envVar="HERMANO_HERMES_AGENT_API_KEY"
            value={apiKeyInput}
            clearing={clearApiKey}
            onChange={(v) => {
              setApiKeyInput(v)
              setClearApiKey(false)
              markDirty()
            }}
            onClear={() => {
              setClearApiKey(true)
              setApiKeyInput("")
              markDirty()
            }}
          />

          <div className="grid grid-cols-2 gap-4">
            <Field
              label="Dispatch timeout (ms)"
              htmlFor={`${idPrefix}-timeout`}
              caption={hermes.dispatchTimeoutMs.locked ? <EnvCaption envVar="HERMANO_HERMES_AGENT_DISPATCH_TIMEOUT_MS" /> : undefined}
            >
              <Input
                id={`${idPrefix}-timeout`}
                type="number"
                min={1}
                disabled={hermes.dispatchTimeoutMs.locked}
                value={dispatchTimeoutMs}
                onChange={(e) => {
                  setDispatchTimeoutMs(e.target.value)
                  markDirty()
                }}
              />
            </Field>
            <Field
              label="Poll interval (ms)"
              htmlFor={`${idPrefix}-poll`}
              caption={hermes.pollIntervalMs.locked ? <EnvCaption envVar="HERMANO_HERMES_POLL_INTERVAL_MS" /> : undefined}
            >
              <Input
                id={`${idPrefix}-poll`}
                type="number"
                min={1}
                disabled={hermes.pollIntervalMs.locked}
                value={pollIntervalMs}
                onChange={(e) => {
                  setPollIntervalMs(e.target.value)
                  markDirty()
                }}
              />
            </Field>
          </div>

          {updateSettings.isError && <p className="text-sm text-destructive">{updateSettings.error.message}</p>}

          <div className="flex items-center gap-3">
            <Button type="submit" disabled={updateSettings.isPending}>
              Save
            </Button>
            <SavedNote show={saved} />
          </div>
        </form>
      </CardContent>
    </Card>
  )
}

function PromptSection({ systemPrompt }: { systemPrompt: SettingsResponse["systemPrompt"] }) {
  const idPrefix = useId()
  const updateSettings = useUpdateSettings()
  const [value, setValue] = useState(systemPrompt.value)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    setValue(systemPrompt.value)
  }, [systemPrompt.value])

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    updateSettings.mutate(
      { customSystemPrompt: value.trim() === "" ? null : value },
      { onSuccess: () => setSaved(true) },
    )
  }

  function handleReset() {
    setValue("")
    updateSettings.mutate({ customSystemPrompt: null }, { onSuccess: () => setSaved(true) })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>System Prompt</CardTitle>
        <CardDescription>
          The instructions sent to Hermes on every dispatch, including the <code className="rounded bg-muted px-1 py-0.5">STATUS:</code>{" "}
          marker contract it must follow. Leave empty to use the built-in default shown as placeholder text below.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <Textarea
            id={`${idPrefix}-prompt`}
            className="min-h-64 font-mono text-sm"
            value={value}
            onChange={(e) => {
              setValue(e.target.value)
              setSaved(false)
            }}
            placeholder={systemPrompt.default}
          />

          {updateSettings.isError && <p className="text-sm text-destructive">{updateSettings.error.message}</p>}

          <div className="flex items-center gap-3">
            <Button type="submit" disabled={updateSettings.isPending}>
              Save
            </Button>
            <Button type="button" variant="outline" disabled={updateSettings.isPending || !systemPrompt.isCustom} onClick={handleReset}>
              <RotateCcw className="size-3.5" />
              Reset to default
            </Button>
            <SavedNote show={saved} />
          </div>
        </form>
      </CardContent>
    </Card>
  )
}

function OidcSection({ oidc }: { oidc: SettingsResponse["oidc"] }) {
  const idPrefix = useId()
  const updateSettings = useUpdateSettings()

  const [issuerUrl, setIssuerUrl] = useState(oidc.issuerUrl)
  const [clientId, setClientId] = useState(oidc.clientId)
  const [redirectUrl, setRedirectUrl] = useState(oidc.redirectUrl)
  const [clientSecretInput, setClientSecretInput] = useState("")
  const [clearClientSecret, setClearClientSecret] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    setIssuerUrl(oidc.issuerUrl)
    setClientId(oidc.clientId)
    setRedirectUrl(oidc.redirectUrl)
    setClientSecretInput("")
    setClearClientSecret(false)
  }, [oidc.issuerUrl, oidc.clientId, oidc.redirectUrl])

  function markDirty() {
    setSaved(false)
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    updateSettings.mutate(
      {
        oidcIssuerUrl: issuerUrl,
        oidcClientId: clientId,
        oidcRedirectUrl: redirectUrl,
        ...(clearClientSecret && { oidcClientSecret: null }),
        ...(!clearClientSecret && clientSecretInput && { oidcClientSecret: clientSecretInput }),
      },
      { onSuccess: () => setSaved(true) },
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Single Sign-On (OIDC)</CardTitle>
        <CardDescription>
          Gate the dashboard behind your identity provider. <strong>Saving here requires restarting Hermano to take effect</strong> —
          this mirrors setting the equivalent environment variables. A misconfiguration can lock you out of the dashboard until it's
          fixed (edit the database directly, or set the <code className="rounded bg-muted px-1 py-0.5">OIDC_*</code> env vars, which
          always take priority over these fields).
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <Field label="Issuer URL" htmlFor={`${idPrefix}-issuer`} caption={oidc.locked ? <EnvCaption envVar="OIDC_ISSUER_URL" /> : undefined}>
            <Input
              id={`${idPrefix}-issuer`}
              type="url"
              disabled={oidc.locked}
              value={issuerUrl}
              onChange={(e) => {
                setIssuerUrl(e.target.value)
                markDirty()
              }}
              placeholder="https://auth.example.com"
            />
          </Field>

          <Field label="Client ID" htmlFor={`${idPrefix}-client`} caption={oidc.locked ? <EnvCaption envVar="OIDC_CLIENT_ID" /> : undefined}>
            <Input
              id={`${idPrefix}-client`}
              disabled={oidc.locked}
              value={clientId}
              onChange={(e) => {
                setClientId(e.target.value)
                markDirty()
              }}
              placeholder="hermano"
            />
          </Field>

          <SecretField
            id={`${idPrefix}-secret`}
            label="Client Secret"
            isSet={oidc.clientSecretSet}
            locked={oidc.locked}
            envVar="OIDC_CLIENT_SECRET"
            value={clientSecretInput}
            clearing={clearClientSecret}
            onChange={(v) => {
              setClientSecretInput(v)
              setClearClientSecret(false)
              markDirty()
            }}
            onClear={() => {
              setClearClientSecret(true)
              setClientSecretInput("")
              markDirty()
            }}
          />

          <Field
            label="Redirect URL"
            htmlFor={`${idPrefix}-redirect`}
            caption={
              oidc.locked ? (
                <EnvCaption envVar="OIDC_REDIRECT_URL" />
              ) : (
                <p className="text-xs text-muted-foreground">Defaults to this server's own origin + /auth/callback when left empty.</p>
              )
            }
          >
            <Input
              id={`${idPrefix}-redirect`}
              type="url"
              disabled={oidc.locked}
              value={redirectUrl}
              onChange={(e) => {
                setRedirectUrl(e.target.value)
                markDirty()
              }}
              placeholder="https://hermano.example.com/auth/callback"
            />
          </Field>

          {updateSettings.isError && <p className="text-sm text-destructive">{updateSettings.error.message}</p>}

          <div className="flex items-center gap-3">
            <Button type="submit" disabled={updateSettings.isPending || oidc.locked}>
              Save
            </Button>
            <SavedNote show={saved} />
          </div>
        </form>
      </CardContent>
    </Card>
  )
}

function PushoverSection({ pushover }: { pushover: SettingsResponse["pushover"] }) {
  const idPrefix = useId()
  const updateSettings = useUpdateSettings()

  const [apiTokenInput, setApiTokenInput] = useState("")
  const [clearApiToken, setClearApiToken] = useState(false)
  const [userKeyInput, setUserKeyInput] = useState("")
  const [clearUserKey, setClearUserKey] = useState(false)
  const [notifyOnCompleted, setNotifyOnCompleted] = useState(pushover.notifyOnCompleted.value)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    setApiTokenInput("")
    setClearApiToken(false)
    setUserKeyInput("")
    setClearUserKey(false)
    setNotifyOnCompleted(pushover.notifyOnCompleted.value)
  }, [pushover.notifyOnCompleted.value])

  function markDirty() {
    setSaved(false)
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    updateSettings.mutate(
      {
        ...(!pushover.apiTokenLocked && clearApiToken && { pushoverApiToken: null }),
        ...(!pushover.apiTokenLocked && !clearApiToken && apiTokenInput && { pushoverApiToken: apiTokenInput }),
        ...(!pushover.userKeyLocked && clearUserKey && { pushoverUserKey: null }),
        ...(!pushover.userKeyLocked && !clearUserKey && userKeyInput && { pushoverUserKey: userKeyInput }),
        ...(!pushover.notifyOnCompleted.locked && { pushoverNotifyOnCompleted: notifyOnCompleted }),
      },
      { onSuccess: () => setSaved(true) },
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Pushover</CardTitle>
        <CardDescription>
          Notify you when an alert matches no delegation rule (nobody's watching it), when Hermes fails or times out trying to fix
          one, or when an alert fires again after previously being marked fixed. Leave both fields empty to disable Pushover entirely.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <SecretField
            id={`${idPrefix}-token`}
            label="API Token"
            isSet={pushover.apiTokenSet}
            locked={pushover.apiTokenLocked}
            envVar="HERMANO_PUSHOVER_API_TOKEN"
            value={apiTokenInput}
            clearing={clearApiToken}
            onChange={(v) => {
              setApiTokenInput(v)
              setClearApiToken(false)
              markDirty()
            }}
            onClear={() => {
              setClearApiToken(true)
              setApiTokenInput("")
              markDirty()
            }}
          />

          <SecretField
            id={`${idPrefix}-user`}
            label="User Key"
            isSet={pushover.userKeySet}
            locked={pushover.userKeyLocked}
            envVar="HERMANO_PUSHOVER_USER_KEY"
            value={userKeyInput}
            clearing={clearUserKey}
            onChange={(v) => {
              setUserKeyInput(v)
              setClearUserKey(false)
              markDirty()
            }}
            onClear={() => {
              setClearUserKey(true)
              setUserKeyInput("")
              markDirty()
            }}
          />

          <div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={notifyOnCompleted}
                disabled={pushover.notifyOnCompleted.locked}
                onChange={(e) => {
                  setNotifyOnCompleted(e.target.checked)
                  markDirty()
                }}
                className="size-4 rounded border-input"
              />
              Notify me when Hermes successfully fixes an alert
            </label>
            {pushover.notifyOnCompleted.locked && <EnvCaption envVar="HERMANO_PUSHOVER_NOTIFY_ON_COMPLETED" />}
          </div>

          {updateSettings.isError && <p className="text-sm text-destructive">{updateSettings.error.message}</p>}

          <div className="flex items-center gap-3">
            <Button type="submit" disabled={updateSettings.isPending}>
              Save
            </Button>
            <SavedNote show={saved} />
          </div>
        </form>
      </CardContent>
    </Card>
  )
}

export function SettingsPage() {
  const { data: settings, isPending } = useSettings()

  return (
    <div>
      <h1 className="mb-6 text-xl font-semibold">Settings</h1>

      {isPending && (
        <div className="flex flex-col gap-4">
          <Skeleton className="h-64 rounded-xl" />
          <Skeleton className="h-48 rounded-xl" />
          <Skeleton className="h-96 rounded-xl" />
        </div>
      )}

      {settings && (
        <div className="flex flex-col gap-6">
          <GeneralSection general={settings.general} />
          <HermesSection hermes={settings.hermes} />
          <PromptSection systemPrompt={settings.systemPrompt} />
          <PushoverSection pushover={settings.pushover} />
          <OidcSection oidc={settings.oidc} />
        </div>
      )}
    </div>
  )
}
