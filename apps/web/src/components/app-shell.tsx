import { Bell, LogOut, Settings } from "lucide-react"
import { Link, NavLink, Outlet } from "react-router"
import { Button } from "@/components/ui/button"
import { ThemeToggle } from "@/components/theme-toggle"
import { useAuthMe, useLogout } from "@/lib/queries"
import { cn } from "@/lib/utils"

function TopNav() {
  const linkClass = ({ isActive }: { isActive: boolean }) =>
    cn(
      "rounded-md px-3 py-1 text-sm font-medium transition-colors",
      isActive ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground",
    )

  return (
    <nav className="flex items-center justify-center gap-1 rounded-lg bg-muted p-[3px] sm:justify-start">
      <NavLink to="/" end className={linkClass}>
        Overview
      </NavLink>
      <NavLink to="/alerts" className={linkClass}>
        Alerts
      </NavLink>
      <NavLink to="/delegations" className={linkClass}>
        Delegations
      </NavLink>
      <NavLink to="/rules" className={linkClass}>
        Rules
      </NavLink>
    </nav>
  )
}

function UserMenu() {
  const { data } = useAuthMe()
  const logout = useLogout()

  if (!data?.oidcEnabled) return null

  return (
    <div className="flex items-center gap-2">
      {data.user?.name && (
        <span className="hidden text-sm text-muted-foreground sm:inline">{data.user.name}</span>
      )}
      <Button
        variant="ghost"
        size="icon"
        aria-label="Log out"
        onClick={() => logout.mutate()}
        disabled={logout.isPending}
      >
        <LogOut className="size-4" />
      </Button>
    </div>
  )
}

export function AppShell() {
  return (
    <div className="min-h-svh bg-background text-foreground">
      <header className="border-b">
        <div className="mx-auto max-w-6xl px-4">
          <div className="flex h-14 items-center justify-between gap-2">
            <Link to="/" className="flex items-center gap-2 font-semibold">
              <Bell className="size-5" />
              Hermano
            </Link>
            <div className="hidden sm:block">
              <TopNav />
            </div>
            <div className="flex items-center gap-1">
              <UserMenu />
              <ThemeToggle />
              <Button variant="ghost" size="icon" aria-label="Settings" nativeButton={false} render={<Link to="/settings" />}>
                <Settings className="size-4" />
              </Button>
            </div>
          </div>
          <div className="pb-3 sm:hidden">
            <TopNav />
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6">
        <Outlet />
      </main>
    </div>
  )
}
