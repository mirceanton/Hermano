import { Route, Routes } from "react-router"
import { AppShell } from "@/components/app-shell"
import { AuthGate } from "@/components/auth-gate"
import { AlertDetailPage } from "@/routes/alert-detail"
import { AlertsHistoryPage } from "@/routes/alerts-history"
import { DelegationsPage } from "@/routes/delegations"
import { OverviewPage } from "@/routes/overview"
import { RulesPage } from "@/routes/rules"

export default function App() {
  return (
    <Routes>
      <Route
        element={
          <AuthGate>
            <AppShell />
          </AuthGate>
        }
      >
        <Route index element={<OverviewPage />} />
        <Route path="alerts" element={<AlertsHistoryPage />} />
        <Route path="alerts/:id" element={<AlertDetailPage />} />
        <Route path="delegations" element={<DelegationsPage />} />
        <Route path="rules" element={<RulesPage />} />
      </Route>
    </Routes>
  )
}
