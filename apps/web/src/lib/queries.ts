import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import type { HermesProfileCreateInput, HermesProfileUpdateInput, LabelMap, SettingsUpdateInput } from "@hermano/shared"
import {
  cancelDelegation,
  createProfile,
  createRule,
  delegateAlert,
  deleteProfile,
  deleteRule,
  fetchAlert,
  fetchAlerts,
  fetchAuthMe,
  fetchDelegations,
  fetchOverview,
  fetchProfiles,
  fetchRules,
  fetchSettings,
  logout,
  updateProfile,
  updateRule,
  updateSettings,
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

export function useCancelDelegation(id: number) {
  const invalidate = useInvalidateAlert(id)
  return useMutation({
    mutationFn: () => cancelDelegation(id),
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
    mutationFn: (input: { name: string; matchers: LabelMap; enabled: boolean; profileId: number | null }) => createRule(input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["rules"] })
    },
  })
}

export function useUpdateRule() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({
      id,
      patch,
    }: {
      id: number
      patch: Partial<{ name: string; matchers: LabelMap; enabled: boolean; profileId: number | null }>
    }) => updateRule(id, patch),
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

export function useProfiles() {
  return useQuery({
    queryKey: ["profiles"],
    queryFn: fetchProfiles,
  })
}

export function useCreateProfile() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: HermesProfileCreateInput) => createProfile(input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["profiles"] })
    },
  })
}

export function useUpdateProfile() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, patch }: { id: number; patch: HermesProfileUpdateInput }) => updateProfile(id, patch),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["profiles"] })
    },
  })
}

export function useDeleteProfile() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => deleteProfile(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["profiles"] })
    },
  })
}

export function useSettings() {
  return useQuery({
    queryKey: ["settings"],
    queryFn: fetchSettings,
  })
}

export function useUpdateSettings() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (patch: SettingsUpdateInput) => updateSettings(patch),
    onSuccess: (data) => {
      queryClient.setQueryData(["settings"], data)
    },
  })
}
