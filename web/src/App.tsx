import * as React from "react"
import { ErrorNote, Shell, useHashRoute } from "./shell.tsx"
import { OverviewPage } from "./pages/Overview.tsx"
import { RunnersPage } from "./pages/Runners.tsx"
import { ShardsPage } from "./pages/Shards.tsx"
import { EntitiesPage } from "./pages/Entities.tsx"
import { MessagesPage } from "./pages/Messages.tsx"
import { WorkflowListPage, WorkflowRunsPage } from "./pages/Workflows.tsx"

export function App() {
  const route = useHashRoute()
  const parts = route.split("/").filter(Boolean)

  let content: React.ReactNode
  try {
    switch (parts[0]) {
      case "runners":
        content = <RunnersPage />
        break
      case "shards":
        content = <ShardsPage />
        break
      case "entities":
        content = <EntitiesPage />
        break
      case "workflows":
        content =
          parts.length >= 2 ? (
            <WorkflowRunsPage key={parts[1]} name={decodeURIComponent(parts[1])} />
          ) : (
            <WorkflowListPage />
          )
        break
      case "messages":
        content = <MessagesPage />
        break
      case "overview":
        content = <OverviewPage />
        break
      default:
        content = <ErrorNote error={`unknown route: ${route}`} />
    }
  } catch (e) {
    content = <ErrorNote error={String(e)} />
  }

  return <Shell route={route}>{content}</Shell>
}
