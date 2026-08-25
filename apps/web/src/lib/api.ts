import type {
  AlertDetail,
  AlertListItem,
  AuthMe,
  DelegationLogEntry,
  DelegationRule,
  LabelMap,
  OverviewStats,
  Paginated,
  SettingsResponse,
  SettingsUpdateInput,
} from "@hermano/shared"

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init)
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null
    throw new Error(body?.error ?? `Request to ${path} failed with status ${res.status}`)
  }
  if (res.status === 204) return undefined as T
  return res.json() as Promise<T>
}

export function fetchOverview(): Promise<OverviewStats> {
  return request<OverviewStats>("/api/overview")
}

export interface AlertFilters {
  status?: "firing" | "resolved"
  page?: number
}

export function fetchAlerts(filters: AlertFilters = {}): Promise<Paginated<AlertListItem>> {
  const params = new URLSearchParams()
  if (filters.status) params.set("status", filters.status)
  if (filters.page) params.set("page", String(filters.page))
  const query = params.toString()
  return request<Paginated<AlertListItem>>(`/api/alerts${query ? `?${query}` : ""}`)
}

export function fetchAlert(id: number): Promise<AlertDetail> {
  return request<AlertDetail>(`/api/alerts/${id}`)
}

export function delegateAlert(id: number): Promise<AlertDetail> {
  return request<AlertDetail>(`/api/alerts/${id}/delegate`, { method: "POST" })
}

export function cancelDelegation(id: number): Promise<AlertDetail> {
  return request<AlertDetail>(`/api/alerts/${id}/delegation/cancel`, { method: "POST" })
}

export interface DelegationFilters {
  page?: number
}

export function fetchDelegations(filters: DelegationFilters = {}): Promise<Paginated<DelegationLogEntry>> {
  const params = new URLSearchParams()
  if (filters.page) params.set("page", String(filters.page))
  const query = params.toString()
  return request<Paginated<DelegationLogEntry>>(`/api/delegations${query ? `?${query}` : ""}`)
}

export function fetchRules(): Promise<DelegationRule[]> {
  return request<DelegationRule[]>("/api/rules")
}

export function createRule(input: { name: string; matchers: LabelMap; enabled: boolean }): Promise<DelegationRule> {
  return request<DelegationRule>("/api/rules", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  })
}

export function updateRule(
  id: number,
  patch: Partial<{ name: string; matchers: LabelMap; enabled: boolean }>,
): Promise<DelegationRule> {
  return request<DelegationRule>(`/api/rules/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  })
}

export function deleteRule(id: number): Promise<void> {
  return request<void>(`/api/rules/${id}`, { method: "DELETE" })
}

export function fetchAuthMe(): Promise<AuthMe> {
  return request<AuthMe>("/api/auth/me")
}

export function logout(): Promise<void> {
  return request<void>("/auth/logout", { method: "POST" })
}

export function fetchSettings(): Promise<SettingsResponse> {
  return request<SettingsResponse>("/api/settings")
}

export function updateSettings(patch: SettingsUpdateInput): Promise<SettingsResponse> {
  return request<SettingsResponse>("/api/settings", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  })
}
