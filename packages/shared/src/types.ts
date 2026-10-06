import type { LabelMap } from "./label-map.js";

export type DelegationStatus = "pending" | "dispatched" | "completed" | "failed" | "timed_out" | "cancelled";

export interface RuleSnapshot {
  name: string;
  /** Absent for "manual" delegations (operator-triggered, not caused by any rule). */
  matchers?: LabelMap;
  /** Name of the Hermes profile this delegation was routed to, frozen at match time. Absent when it went to the default Hermes endpoint (Settings → Hermes Agent). */
  profile?: string;
}

/**
 * A named Hermes endpoint a delegation rule can route to — e.g. one Hermes
 * profile's own api_server (its own port and API_SERVER_KEY), or a profile
 * under a multiplexed gateway's /p/<profile> URL prefix. Rules with no
 * profile use the default endpoint configured under Settings → Hermes Agent.
 */
export interface HermesProfile {
  id: number;
  name: string;
  url: string;
  /** Never the actual key — just whether one is configured for this profile. */
  apiKeySet: boolean;
  /** Whether this profile inherits its url/apiKey from the global Hermes Agent setting rather than storing its own. */
  useSharedConnection: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface HermesProfileCreateInput {
  name: string;
  /** Required unless useSharedConnection is true, in which case the global Hermes Agent URL is used. */
  url?: string;
  apiKey?: string | null;
  /** When true, url and apiKey are inherited from the global Hermes Agent setting — no per-profile values are stored. Defaults to false. */
  useSharedConnection?: boolean;
}

export interface HermesProfileUpdateInput {
  name?: string;
  url?: string;
  /** A new key to store, or null to clear the stored one. Omit to keep it as is. */
  apiKey?: string | null;
  /** Set to true to inherit the global Hermes Agent connection; set to false to switch back to per-profile url/apiKey. Omit to keep as is. */
  useSharedConnection?: boolean;
}

export interface AlertTrigger {
  id: number;
  alertId: number;
  firedAt: number;
  createdAt: number;
}

export interface DelegationRule {
  id: number;
  name: string;
  matchers: LabelMap;
  enabled: boolean;
  /** The Hermes profile matching alerts are routed to; null = the default Hermes endpoint. */
  profileId: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface DelegationUsage {
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
}

export interface Delegation extends DelegationUsage {
  id: number;
  alertId: number;
  triggerId: number | null;
  ruleId: number | null;
  rule: RuleSnapshot;
  status: DelegationStatus;
  runId: string | null;
  delegatedAt: number;
  dispatchedAt: number | null;
  completedAt: number | null;
  summary: string | null;
  createdAt: number;
}

/** The Delegations-log-page projection: a Delegation joined against its parent alert. */
export interface DelegationLogEntry extends Delegation {
  alertName: string;
  fingerprint: string;
  alertActive: boolean;
}

export interface LatestDelegationSummary extends DelegationUsage {
  id: number;
  status: DelegationStatus;
  ruleName: string;
  summary: string | null;
  runId: string | null;
  delegatedAt: number;
  dispatchedAt: number | null;
  completedAt: number | null;
}

export interface AlertListItem {
  id: number;
  fingerprint: string;
  alertName: string;
  severity: string;
  labels: LabelMap;
  annotations: LabelMap;
  generatorUrl: string;
  startsAt: number;
  endsAt: number | null;
  resolvedAt: number | null;
  createdAt: number;
  updatedAt: number;
  timesFired: number;
  firstFiredAt: number | null;
  lastFiredAt: number | null;
  latestDelegation: LatestDelegationSummary | null;
  /** How many episodes (this row included) share this fingerprint, active or resolved — 1 for an alert that has never recurred. */
  episodeCount: number;
}

export interface TimelineEvent {
  at: number;
  label: string;
}

/** A different episode of the same fingerprint — used to link recurrences of the same underlying alert together on the detail page. */
export interface RelatedEpisode {
  id: number;
  startsAt: number;
  resolvedAt: number | null;
  timesFired: number;
  latestDelegationStatus: DelegationStatus | null;
}

export interface AlertDetail extends AlertListItem {
  triggers: AlertTrigger[];
  delegations: Delegation[];
  timeline: TimelineEvent[];
  /** Other episodes of this same fingerprint, most recent first. */
  relatedEpisodes: RelatedEpisode[];
}

export interface OverviewStats {
  openAlerts: number;
  totalResolved: number;
  dispatched: number;
  completed: number;
  failed: number;
  activeRules: number;
  totalRules: number;
  totalTokens: number;
  undelegatedActive: number;
  failedActive: number;
}

export interface Paginated<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface AuthUser {
  id: number;
  name: string | null;
  email: string | null;
}

export interface AuthMe {
  authenticated: boolean;
  user: AuthUser | null;
  oidcEnabled: boolean;
}

export interface WebhookIngestResult {
  created: number;
  updated: number;
  resolved: number;
}

/** A settings-page value alongside whether it's locked to an env var (read-only, env wins). */
export interface LockableField<T> {
  value: T;
  locked: boolean;
}

export interface SettingsResponse {
  general: {
    /** Falls back to this server's own http://127.0.0.1:<port> origin when unset — see the caption shown alongside it. */
    publicUrl: LockableField<string>;
  };
  hermes: {
    agentUrl: LockableField<string>;
    /** Never the actual key — just whether one is currently configured (env or DB). */
    agentApiKeySet: boolean;
    agentApiKeyLocked: boolean;
    dispatchTimeoutMs: LockableField<number>;
    pollIntervalMs: LockableField<number>;
  };
  systemPrompt: {
    /** The active custom override, or "" if none is set (in which case `default` is what's actually used). */
    value: string;
    isCustom: boolean;
    default: string;
  };
  oidc: {
    /** Whole-integration lock: the three OIDC env vars are validated all-or-nothing, so there's no useful per-field lock. */
    locked: boolean;
    issuerUrl: string;
    clientId: string;
    clientSecretSet: boolean;
    redirectUrl: string;
  };
  pushover: {
    apiTokenSet: boolean;
    apiTokenLocked: boolean;
    userKeySet: boolean;
    userKeyLocked: boolean;
    notifyOnCompleted: LockableField<boolean>;
  };
}

export interface SettingsUpdateInput {
  publicUrl?: string | null;
  hermesAgentUrl?: string | null;
  hermesAgentApiKey?: string | null;
  hermesDispatchTimeoutMs?: number | null;
  hermesPollIntervalMs?: number | null;
  customSystemPrompt?: string | null;
  oidcIssuerUrl?: string | null;
  oidcClientId?: string | null;
  oidcClientSecret?: string | null;
  oidcRedirectUrl?: string | null;
  pushoverApiToken?: string | null;
  pushoverUserKey?: string | null;
  pushoverNotifyOnCompleted?: boolean | null;
}
