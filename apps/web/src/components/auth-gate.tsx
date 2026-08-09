import { Loader2 } from "lucide-react"
import { useEffect } from "react"
import { useAuthMe } from "@/lib/queries"

function CenteredSpinner() {
  return (
    <div className="flex min-h-svh items-center justify-center">
      <Loader2 className="size-6 animate-spin text-muted-foreground" />
    </div>
  )
}

/**
 * Gates the whole app behind a quick /api/auth/me check. In single-user mode
 * this always resolves authenticated=true (adds one fast local round-trip).
 * In OIDC mode, an unauthenticated visitor is bounced to /auth/login via a
 * full page navigation — login has to leave the SPA to reach the provider.
 */
export function AuthGate({ children }: { children: React.ReactNode }) {
  const { data, isPending, isError } = useAuthMe()
  const shouldRedirect = isError || (data && !data.authenticated)

  useEffect(() => {
    if (shouldRedirect) {
      window.location.href = "/auth/login"
    }
  }, [shouldRedirect])

  if (isPending || shouldRedirect) {
    return <CenteredSpinner />
  }

  return <>{children}</>
}
