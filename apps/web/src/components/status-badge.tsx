import type { DelegationStatus } from "@hermano/shared"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"

const VARIANT: Record<DelegationStatus, "outline" | "default" | "destructive"> = {
  pending: "outline",
  dispatched: "outline",
  completed: "default",
  failed: "destructive",
  timed_out: "destructive",
  cancelled: "outline",
}

const LABEL: Record<DelegationStatus, string> = {
  pending: "pending",
  dispatched: "dispatched",
  completed: "completed",
  failed: "failed",
  timed_out: "timed out",
  cancelled: "cancelled",
}

export function StatusBadge({ status, className }: { status: DelegationStatus; className?: string }) {
  return (
    <Badge
      variant={VARIANT[status]}
      className={cn((status === "timed_out" || status === "cancelled") && "ring-1 ring-destructive/40", className)}
    >
      {LABEL[status]}
    </Badge>
  )
}
