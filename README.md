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

## Running it

### Docker Compose

```bash
docker compose up -d
```

This runs the published image with a SQLite database on a named volume, exposed on `http://localhost:8080`. See `docker-compose.yml` for the full list of optional environment variables (Hermes dispatch, webhook auth, OIDC).

### Locally

```bash
pnpm install
pnpm dev:server   # Fastify API on :8080
pnpm dev:web      # Vite dev server on :5173, proxying /api, /auth, /healthz to :8080
```

Requires at minimum `HERMANO_DATABASE_PATH` set (see `apps/server/.env.example`).

### Building the container image yourself

```bash
docker build -t hermano .
```

## Configuration

All configuration is via environment variables — see `apps/server/.env.example` for the full annotated list.

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
| `LOG_LEVEL` | `info` | `fatal` / `error` / `warn` / `info` / `debug` / `trace` |

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

`send_resolved: true` is important — without it, resolved alerts never get removed from the active list.

## Using the dashboard

- **Overview** (`/`) — a "needs attention" panel (undelegated or failed active alerts), stat tiles (open/resolved alerts, sessions dispatched, completed/failed counts, active rules, tokens used), and a live-updating grid of currently-firing alerts with a "Delegate now"/"Retry" action.
- **Alerts** (`/alerts`) — resolved-alert history, searchable and filterable by severity, paginated.
- **Alert detail** (`/alerts/:id`) — an alert's full identity, label set, firing/delegation timeline merged chronologically, and its complete delegation attempt history.
- **Delegations** (`/delegations`) — a log of every delegation attempt ever made, active or resolved alert, most recent first, searchable and filterable by status, with the agent's full postmortem report always one click away.
- **Rules** (`/rules`) — create/enable/disable/delete delegation rules. Each rule is a set of `label=value` matchers (AND'd together) with a live "would match N currently active alerts" preview as you type; an alert is delegated the moment it matches an enabled rule, including alerts that were already firing before the rule was created. "Forward this kind →" on any undelegated alert card opens the rule dialog pre-filled from that alert. Duplicate rules (same matcher set) are rejected.

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
