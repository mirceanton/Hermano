# Hermano

A small self-hosted service that receives [Alertmanager](https://prometheus.io/docs/alerting/latest/configuration/#webhook_config) webhook notifications and delegates them to Hermes to investigate and fix based on custom rules.

## Core Principles

### Alert Deduplication

Hermano deduplicates firing alerts by their Alertmanager fingerprint. A repeated notification for the same alert increments a counter instead of creating a new entry. This avoids having your AI agent start concurrent or repeated runs for the same alert.

### Alert Archival on Resolution

Once Alertmanager reports an alert as resolved, it's removed from the active list and a snapshot is kept in history for later reference.

### Delegation rules

By default nothing is forwarded anywhere. The app just surfaces all of your currently firing alerts and gives you the option to manually delegate any of them. However, the better way to handle this is to create `delegation rules` based on alert labels to auto-delegate as soon as they come in.

From the dashboard you can look through active alerts or history and decide that a given *kind* of alert (matched by labels, e.g. `alertname=KubePodCrashLooping`) should start being delegated to your [Hermes agent](https://github.com/NousResearch/hermes-agent) from then on. A matching alert is dispatched via Hermes' OpenAI-compatible Runs API and its outcome is tracked end-to-end (`pending` → `dispatched` → `completed`/`failed`/`timed_out`) by directly polling Hermes for the run's status — see [Delegating to Hermes](#delegating-to-hermes) below.

### Selective Pushover notifications

Point Alertmanager at Hermano alone (not also at Pushover directly) and Hermano becomes the single hop in between, deciding what's actually worth interrupting you for — see [Notifying you via Pushover](#notifying-you-via-pushover) below.

## Configuration

All configuration options are exposed via environment variables — see `apps/server/.env.example` for the full annotated list.

| Variable | Default | Description |
| --- | --- | --- |
| `HERMANO_DATABASE_PATH` | *(required)* | SQLite database file path |
| `HERMANO_PORT` | `8080` | HTTP listen port |
| `HERMANO_WEBHOOK_SHARED_SECRET` | *(unset = open)* | Optional bearer-token check on `POST /api/webhook` — Alertmanager can't do OIDC, so this is the only auth available for that endpoint |
| `HERMANO_HERMES_AGENT_URL` | *(unset)* | Hermes' OpenAI-compatible API server root, e.g. `http://hermes-api.ai.svc.cluster.local:8642`. Unset = rules still match, but nothing is ever dispatched (every match ends up `failed`) |
| `HERMANO_HERMES_AGENT_API_KEY` | *(unset)* | Bearer token for that API (Hermes' configured `API_SERVER_KEY`), if it requires one |
| `HERMANO_HERMES_AGENT_DISPATCH_TIMEOUT_MS` | `1800000` (30m) | How long to poll a dispatched Hermes run before giving up and marking it `timed_out` (the run is also told to stop) |
| `HERMANO_HERMES_POLL_INTERVAL_MS` | `3000` | How often to poll a dispatched run's status |
| `STATIC_WEB_DIR` | *(unset)* | Absolute path to the built web SPA — set in production so this same process serves both the API and the frontend |
| `OIDC_ISSUER_URL` / `OIDC_CLIENT_ID` / `OIDC_CLIENT_SECRET` / `OIDC_REDIRECT_URL` / `SESSION_SECRET` | *(unset = single-user mode)* | Gate the dashboard behind OIDC login (Authelia, Authentik, Keycloak, ...). If any of the first three is set, all three plus `SESSION_SECRET` (32+ chars) are required |
| `HERMANO_PUSHOVER_API_TOKEN` / `HERMANO_PUSHOVER_USER_KEY` | *(unset = disabled)* | [Pushover](https://pushover.net) application token and user/group key. Leave both unset to disable notifications entirely |
| `HERMANO_PUSHOVER_NOTIFY_ON_COMPLETED` | `false` | Whether a successful fix also sends a (low-priority) Pushover notification — see [Notifying you via Pushover](#notifying-you-via-pushover) |
| `LOG_LEVEL` | `info` | `fatal` / `error` / `warn` / `info` / `debug` / `trace` |

All of the above except `HERMANO_DATABASE_PATH`/`HERMANO_PORT`/`STATIC_WEB_DIR`/`LOG_LEVEL` (and `OIDC_*`, which requires a restart) are also editable from the in-app Settings page — an environment variable, when set, always takes priority over whatever's saved there.

## Pointing Alertmanager at it

Add a webhook receiver to your Alertmanager config:

```yaml
receivers:
  - name: hermano
    webhook_configs:
      - url: http://hermano:8080/api/webhook
        send_resolved: true # required so resolved alerts get archived/cleared
        # If HERMANO_WEBHOOK_SHARED_SECRET is set:
        # http_config:
        #   authorization:
        #     credentials: <the shared secret>
```

`send_resolved: true` is important. Without it, resolved alerts never get removed from the active list.

## Delegating to Hermes

Hermes exposes an [OpenAI-compatible API server](https://hermes-agent.nousresearch.com/docs/user-guide/features/api-server) with an async Runs API (`POST /v1/runs` to start an agentic run with its full configured toolset, `GET /v1/runs/{id}` to poll it, `POST /v1/runs/{id}/stop` to cancel it) — Hermano talks to that directly rather than firing a webhook and waiting for a callback.

The flow, entirely inside one background worker per delegated alert:

1. A delegation rule matches an alert → its status becomes `pending`.
2. Hermano calls `POST /v1/runs` (Bearer-authed) with the alert's details as `input` and a fixed `instructions` contract → `dispatched`.
3. It then polls `GET /v1/runs/{id}` until Hermes reports the run `completed`/`failed`/`cancelled`.
4. Hermes' Runs API has no client-supplied tool-calling, so there's no structured way for the agent to signal success vs. failure — the `instructions` require the agent's response to end with a literal `STATUS: completed` or `STATUS: failed` marker as its last line, which Hermano parses out; everything before it becomes the postmortem shown on the [Delegations page](#using-the-dashboard). A response that omits the marker is conservatively reported as `failed`.
5. If the run hasn't reached a terminal state within `HERMANO_HERMES_AGENT_DISPATCH_TIMEOUT_MS`, Hermano stops it and marks the alert `timed_out`.

Hermes' own per-run `usage` accounting (real, server-side token counts — not the agent's self-report) is stored alongside the outcome and shown as the "Tokens Used" stat on the Overview page.

### Hermes-side configuration

Enable the API server in Hermes' `config.yaml` (this lives in the Hermes deployment, not in this repo):

```yaml
gateway:
  api_server:
    enabled: true
    host: "0.0.0.0" # binds 127.0.0.1-only otherwise - unreachable from another pod
    port: 8642
    key: "${API_SERVER_KEY}"
```

Then point Hermano at it:

```text
HERMANO_HERMES_AGENT_URL=http://hermes.<namespace>.svc.cluster.local:8642
HERMANO_HERMES_AGENT_API_KEY=<the same API_SERVER_KEY>
```

## Notifying you via Pushover

If you're already pushing Alertmanager notifications straight to [Pushover](https://pushover.net), point it at Hermano instead (`HERMANO_PUSHOVER_API_TOKEN`/`HERMANO_PUSHOVER_USER_KEY`, or the Settings page) and let Hermano decide what actually deserves a push:

- **An alert fires that matches no delegation rule** → pushed immediately (nobody, human or agent, is on it) — and pushed again when it **resolves**, the same as AlertManager's own direct notifications would.
- **A delegation finishes**: `failed` or `timed_out` → always pushed, since it needs you. `completed` → only pushed if `HERMANO_PUSHOVER_NOTIFY_ON_COMPLETED` (or the Settings-page toggle) is on — off by default, since the point of delegating is *not* getting paged for things Hermes already handled.
- **An alert fires again after previously being marked `completed`** → always pushed, whether that's the same episode that never actually stopped firing, or a brand-new episode sometime after the alert fully resolved. Either way, the fix didn't hold.

Nothing else pushes a notification — an alert currently being investigated stays quiet until one of the above happens.
