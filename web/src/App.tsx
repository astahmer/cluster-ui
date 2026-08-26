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
import { SingletonsPage } from "./pages/Singletons.tsx"
import { TracesPage, TraceDetailPage } from "./pages/Traces.tsx"
import { AgentPage } from "./pages/Agent.tsx"
import { McpPage } from "./pages/Mcp.tsx"
import { QueuesPage } from "./pages/Queues.tsx"
import { OperationsPage } from "./pages/Operations.tsx"

/**
 * MessagesPage supports initialFilters (CONTRACT.md W2) and messageId
 * (#/messages/<id> deep links, UX review P1-1); the cast keeps this file
 * compiling against either signature.
 */
const SeededMessagesPage = MessagesPage as unknown as React.ComponentType<{
  initialFilters?: {
    entityType?: string
    entityId?: string
    status?: string
    failed?: string
    q?: string
  }
  messageId?: string
}>

const TypedEntityInstances = EntityInstancesPage as React.ComponentType<{ entityType: string }>

export function App() {
  const route = useRoute()
  const parts = route.segments

  // bare #/ should render Overview, not 'unknown route'
  if (parts.length === 0) parts.push("overview")

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
      case "traces":
        content =
          parts.length >= 2 ? (
            <TraceDetailPage key={parts[1]} traceId={decodeURIComponent(parts[1])} />
          ) : (
            <TracesPage />
          )
        break
      case "singletons":
        content = <SingletonsPage />
        break
      case "workflows":
        content =
          parts.length >= 2 ? (
            <WorkflowRunsPage
              key={parts[1]}
              name={decodeURIComponent(parts[1])}
              executionId={parts.length >= 3 ? decodeURIComponent(parts[2]) : undefined}
            />
          ) : (
            <WorkflowListPage />
          )
        break
      case "messages":
        content = (
          <SeededMessagesPage
            messageId={parts.length >= 2 ? decodeURIComponent(parts[1]) : undefined}
            initialFilters={{
              entityType: route.params.get("entityType") ?? undefined,
              entityId: route.params.get("entityId") ?? undefined,
              status: route.params.get("status") ?? undefined,
              failed: route.params.get("failed") ?? undefined,
              q: route.params.get("q") ?? undefined
            }}
          />
        )
        break
      case "agent":
        content = <AgentPage />
        break
      case "mcp":
        content = <McpPage />
        break
      case "operations":
        content = <OperationsPage />
        break
      case "queues":
        content = <QueuesPage />
        break
      case "overview":
        content = <OverviewPage />
        break
      default:
        content = (
          <div className="space-y-2">
            <ErrorNote error={`unknown route: ${route.path}`} />
            <a href="#/overview" className="text-[13px] text-kumo-link hover:underline">
              ← back to overview
            </a>
          </div>
        )
    }
  } catch (e) {
    content = <ErrorNote error={String(e)} />
  }

  return <Shell route={route.path}>{content}</Shell>
}
