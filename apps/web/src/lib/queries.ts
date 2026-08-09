import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import type { LabelMap } from "@hermano/shared"
import {
  createRule,
  delegateAlert,
  deleteRule,
  fetchAlert,
  fetchAlerts,
  fetchAuthMe,
  fetchDelegations,
  fetchOverview,
  fetchRules,
  logout,
  updateRule,
  type AlertFilters,
  type DelegationFilters,
} from "./api"

const REFETCH_INTERVAL_MS = 10_000

export function useAuthMe() {
  return useQuery({
    queryKey: ["auth", "me"],
    queryFn: fetchAuthMe,
    retry: false,
  })
}

export function useLogout() {
  return useMutation({
    mutationFn: logout,
    onSuccess: () => {
      window.location.href = "/auth/login"
    },
  })
}

export function useOverview() {
  return useQuery({
    queryKey: ["overview"],
    queryFn: fetchOverview,
    refetchInterval: REFETCH_INTERVAL_MS,
  })
}

export function useAlerts(filters: AlertFilters = {}) {
  return useQuery({
    queryKey: ["alerts", filters],
    queryFn: () => fetchAlerts(filters),
    refetchInterval: REFETCH_INTERVAL_MS,
  })
}

export function useAlert(id: number) {
  return useQuery({
    queryKey: ["alerts", id],
    queryFn: () => fetchAlert(id),
    enabled: Number.isFinite(id),
    refetchInterval: REFETCH_INTERVAL_MS,
  })
}

function useInvalidateAlert(id: number) {
  const queryClient = useQueryClient()
  return () => {
    void queryClient.invalidateQueries({ queryKey: ["alerts", id] })
    void queryClient.invalidateQueries({ queryKey: ["alerts"] })
    void queryClient.invalidateQueries({ queryKey: ["overview"] })
    void queryClient.invalidateQueries({ queryKey: ["delegations"] })
  }
}

export function useDelegateAlert(id: number) {
  const invalidate = useInvalidateAlert(id)
  return useMutation({
    mutationFn: () => delegateAlert(id),
    onSuccess: invalidate,
  })
}

export function useDelegations(filters: DelegationFilters = {}) {
  return useQuery({
    queryKey: ["delegations", filters],
    queryFn: () => fetchDelegations(filters),
    refetchInterval: REFETCH_INTERVAL_MS,
  })
}

export function useRules() {
  return useQuery({
    queryKey: ["rules"],
    queryFn: fetchRules,
    refetchInterval: REFETCH_INTERVAL_MS,
  })
}

export function useCreateRule() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: { name: string; matchers: LabelMap; enabled: boolean }) => createRule(input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["rules"] })
    },
  })
}

export function useUpdateRule() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, patch }: { id: number; patch: Partial<{ name: string; matchers: LabelMap; enabled: boolean }> }) =>
      updateRule(id, patch),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["rules"] })
    },
  })
}

export function useDeleteRule() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => deleteRule(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["rules"] })
    },
  })
}
