import { AlertTriangle } from "lucide-react"
import { Component, type ReactNode } from "react"
import { Button } from "@/components/ui/button"

interface State {
  error: Error | null
}

export class RootErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: { componentStack?: string | null }) {
    console.error("Unhandled error in hermano UI:", error, info.componentStack)
  }

  render() {
    if (!this.state.error) return this.props.children

    return (
      <div className="flex min-h-svh flex-col items-center justify-center gap-3 p-6 text-center">
        <AlertTriangle className="size-8 text-destructive" />
        <p className="font-medium">Something went wrong</p>
        <p className="max-w-sm text-sm text-muted-foreground">{this.state.error.message}</p>
        <Button variant="outline" size="sm" onClick={() => window.location.reload()}>
          Reload
        </Button>
      </div>
    )
  }
}
