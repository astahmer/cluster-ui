import * as React from "react"
import { ErrorNote, Shell, useRoute } from "./shell.tsx"
import { OverviewPage } from "./pages/Overview.tsx"
import { RunnersPage } from "./pages/Runners.tsx"
import { ShardsPage } from "./pages/Shards.tsx"
import { EntitiesPage } from "./pages/Entities.tsx"
import { MessagesPage } from "./pages/Messages.tsx"
import { WorkflowListPage, WorkflowRunsPage } from "./pages/Workflows.tsx"
import { CronsPage } from "./pages/Crons.tsx"
import { EntityInstancesPage } from "./pages/EntityInstances.tsx"

/**
 * MessagesPage will accept these once W2 lands (CONTRACT.md); the cast keeps
 * this file compiling against either signature.
 */
const SeededMessagesPage = MessagesPage as unknown as React.ComponentType<{
  initialFilters?: { entityType?: string; entityId?: string; status?: string }
}>

const TypedEntityInstances = EntityInstancesPage as React.ComponentType<{ entityType: string }>

export function App() {
  const route = useRoute()
  const parts = route.segments

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
        content =
          parts.length >= 2 ? (
            <TypedEntityInstances key={parts[1]} entityType={decodeURIComponent(parts[1])} />
          ) : (
            <EntitiesPage />
          )
        break
      case "crons":
        content = <CronsPage />
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
        content = (
          <SeededMessagesPage
            initialFilters={{
              entityType: route.params.get("entityType") ?? undefined,
              entityId: route.params.get("entityId") ?? undefined,
              status: route.params.get("status") ?? undefined
            }}
          />
        )
        break
      case "overview":
        content = <OverviewPage />
        break
      default:
        content = <ErrorNote error={`unknown route: ${route.path}`} />
    }
  } catch (e) {
    content = <ErrorNote error={String(e)} />
  }

  return <Shell route={route.path}>{content}</Shell>
}
