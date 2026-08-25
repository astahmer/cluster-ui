import * as React from "react"
import {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  Position,
  ReactFlow,
  type Edge,
  type Node,
  type NodeProps,
} from "@xyflow/react"
import { cn } from "./ui.tsx"

/**
 * Dependency-free-ish DAG renderer over @xyflow/react (docs/ROADMAP.md §7).
 *
 * Callers pass a plain tree/graph description; we do BFS layering (no dagre)
 * so parents sit above children. Used for:
 * - BullMQ job flows (parent/child via parentKey chains) — #/messages detail
 * - Effect-cluster workflow runs (entity → activity steps) — WorkflowRunDetail
 */

export interface FlowNodeSpec {
  key: string
  label: string
  sublabel?: string
  tone?: "default" | "success" | "danger" | "warning" | "running"
  /** children become downstream nodes connected by edges */
  children?: FlowNodeSpec[]
}

const TONE_CLASS: Record<NonNullable<FlowNodeSpec["tone"]>, string> = {
  default: "border-kumo-line bg-kumo-base text-kumo-default",
  success: "border-kumo-success/50 bg-kumo-base text-kumo-success",
  danger: "border-kumo-danger/50 bg-kumo-base text-kumo-danger",
  warning: "border-kumo-warning/50 bg-kumo-base text-kumo-warning",
  running: "border-kumo-info/50 bg-kumo-base text-kumo-info"
}

function FlowNode({ data }: NodeProps) {
  const { label, sublabel, tone = "default" } = data as {
    label: string
    sublabel?: string
    tone?: FlowNodeSpec["tone"]
  }
  return (
    <div
      className={cn(
        "rounded-md border px-3 py-1.5 text-[12px] shadow-sm",
        TONE_CLASS[tone as keyof typeof TONE_CLASS] ?? TONE_CLASS.default
      )}
      style={{ minWidth: 120 }}
    >
      <Handle type="target" position={Position.Top} className="!bg-kumo-line !w-1.5 !h-1.5" />
      <div className="font-medium leading-4">{label}</div>
      {sublabel && <div className="text-[10px] text-kumo-subtle">{sublabel}</div>}
      <Handle type="source" position={Position.Bottom} className="!bg-kumo-line !w-1.5 !h-1.5" />
    </div>
  )
}

const nodeTypes = { spec: FlowNode }

interface LaidOut {
  nodes: Node[]
  edges: Edge[]
}

function layout(specs: ReadonlyArray<FlowNodeSpec>): LaidOut {
  const nodes: Node[] = []
  const edges: Edge[] = []
  const seen = new Set<string>()

  // BFS from roots assigning depth
  const depth = new Map<string, number>()
  const queue: Array<{ spec: FlowNodeSpec; d: number }> = specs.map((s) => ({ spec: s, d: 0 }))
  while (queue.length > 0) {
    const { spec, d } = queue.shift()!
    if (seen.has(spec.key)) {
      depth.set(spec.key, Math.max(depth.get(spec.key) ?? 0, d))
      continue
    }
    seen.add(spec.key)
    depth.set(spec.key, d)
    nodes.push({
      id: spec.key,
      type: "spec",
      position: { x: 0, y: 0 },
      data: { label: spec.label, sublabel: spec.sublabel, tone: spec.tone ?? "default" }
    })
    for (const child of spec.children ?? []) {
      edges.push({ id: `${spec.key}->${child.key}`, source: spec.key, target: child.key })
      queue.push({ spec: child, d: d + 1 })
    }
  }

  // group by depth, then lay each layer out horizontally
  const byDepth = new Map<number, string[]>()
  for (const [key, d] of depth) {
    const arr = byDepth.get(d) ?? []
    arr.push(key)
    byDepth.set(d, arr)
  }
  const LEVEL_H = 110
  const NODE_W = 190
  for (const [d, keys] of [...byDepth.entries()].sort((a, b) => a[0] - b[0])) {
    keys.forEach((key, i) => {
      const node = nodes.find((n) => n.id === key)
      if (node) node.position = { x: i * NODE_W, y: d * LEVEL_H }
    })
  }
  return { nodes, edges }
}

export function FlowGraph({
  specs,
  height = 360,
  className
}: {
  specs: ReadonlyArray<FlowNodeSpec>
  height?: number
  className?: string
}) {
  const laidOut = React.useMemo(() => layout(specs), [specs])
  if (laidOut.nodes.length === 0) return null
  return (
    <div className={cn("overflow-hidden rounded-md border border-kumo-line", className)} style={{ height }}>
      <ReactFlow
        nodes={laidOut.nodes}
        edges={laidOut.edges}
        nodeTypes={nodeTypes}
        fitView
        proOptions={{ hideAttribution: true }}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
      >
        <Background variant={BackgroundVariant.Dots} gap={16} size={1} color="var(--color-kumo-line)" />
        <Controls showInteractive={false} className="!bg-kumo-base [&>button]:!bg-kumo-base [&>button]:!border-kumo-line [&>button]:!fill-kumo-subtle" />
      </ReactFlow>
    </div>
  )
}

/** Convert a BullMQ-style recursive job tree into FlowNodeSpecs. */
export interface JobTreeNode {
  id: string
  label: string
  state?: string
  children?: ReadonlyArray<JobTreeNode>
}

export function jobTreeToSpecs(root: JobTreeNode): FlowNodeSpec {
  return {
    key: root.id,
    label: root.label,
    sublabel: root.state,
    tone:
      root.state === "failed" ?
        "danger" :
        root.state === "completed" ?
        "success" :
        root.state === "active" || root.state === "wait" ?
        "running" :
        "default",
    children: (root.children ?? []).map(jobTreeToSpecs)
  }
}
