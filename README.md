# Hermano

A small self-hosted service that receives [Alertmanager](https://prometheus.io/docs/alerting/latest/configuration/#webhook_config) webhook notifications and delegates them to Hermes to investigate and fix based on custom rules.

## Core Principles

### Alert Deduplication

Hermano deduplicates firing alerts by their Alertmanager fingerprint. A repeated notification for the same alert increments a counter instead of creating a new entry. This avoids having your AI agent start concurrent or repeated runs for the same alert.

### Alert Archival on Resolution

Once Alertmanager reports an alert as resolved, it's removed from the active list and a snapshot is kept in history for later reference.

### Delegation rules

By default nothing is forwarded anywhere. The app just surfaces all of your currently firing alerts and gives you the option to manually delegate any of them. However, the better way to handle this is to create `delegation rules` based on alert labels to auto-delegate as soon as they come in.

From the dashboard you can look through active alerts or history and decide that a given *kind* of alert (matched by labels, e.g. `alertname=KubePodCrashLooping`) should start being delegated to your [Hermes agent](https://github.com/NousResearch/hermes-agent) from then on. A matching alert is dispatched via Hermes' OpenAI-compatible Runs API and its outcome is tracked end-to-end (`pending` → `dispatched` → `completed`/`failed`/`timed_out`) by directly polling Hermes for the run's status.
