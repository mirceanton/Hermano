import type { LabelMap } from "./label-map.js";

export type DelegationStatus = "pending" | "dispatched" | "completed" | "failed" | "timed_out";

export interface RuleSnapshot {
  name: string;
  /** Absent for "manual" delegations (operator-triggered, not caused by any rule). */
  matchers?: LabelMap;
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
}

export interface TimelineEvent {
  at: number;
  label: string;
}

export interface AlertDetail extends AlertListItem {
  triggers: AlertTrigger[];
  delegations: Delegation[];
  timeline: TimelineEvent[];
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
