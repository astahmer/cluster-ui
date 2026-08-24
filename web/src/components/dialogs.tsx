import * as React from "react"
import { createRoot } from "react-dom/client"
import { Dialog, DialogTitle, DialogDescription, Button } from "../kumo"

/**
 * Confirmation dialog built on kumo Dialog — replacement for window.confirm.
 *
 * Declarative:
 *   <ConfirmDialog open={open} title="…" destructive onConfirm={…} onCancel={…} />
 *
 * Promise style (drop-in for window.confirm):
 *   if (!(await confirmDialog({ title: "Retry message?", destructive: true }))) return
 */

export interface ConfirmOptions {
  title: React.ReactNode
  description?: React.ReactNode
  confirmLabel?: string
  cancelLabel?: string
  destructive?: boolean
}

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  destructive = false,
  onConfirm,
  onCancel
}: ConfirmOptions & {
  open: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  return (
    <Dialog.Root open={open} onOpenChange={(next: boolean) => !next && onCancel()}>
      <Dialog className="p-6">
        <DialogTitle>{title}</DialogTitle>
        {description != null && <DialogDescription>{description}</DialogDescription>}
        <div className="mt-5 flex justify-end gap-2">
          <Dialog.Close render={(p) => (
            <Button variant="secondary" {...(p as object)} onClick={onCancel}>
              {cancelLabel}
            </Button>
          )} />
          <Button
            variant={destructive ? "destructive" : "primary"}
            onClick={() => {
              onConfirm()
            }}
          >
            {confirmLabel}
          </Button>
        </div>
      </Dialog>
    </Dialog.Root>
  )
}

interface MountedConfirm extends ConfirmOptions {
  resolve: (ok: boolean) => void
}

let active: MountedConfirm | null = null
let confirmListeners: Array<() => void> = []
let confirmRoot: ReturnType<typeof createRoot> | null = null

function renderActive() {
  if (!confirmRoot || !active) return
  const current = active
  confirmRoot.render(
    <ConfirmDialog
      open
      title={current.title}
      description={current.description}
      confirmLabel={current.confirmLabel}
      cancelLabel={current.cancelLabel}
      destructive={current.destructive}
      onConfirm={() => finish(true)}
      onCancel={() => finish(false)}
    />
  )

  function finish(ok: boolean) {
    active = null
    confirmRoot?.render(null)
    current.resolve(ok)
  }
}

/** Imperative window.confirm replacement. Resolves true when confirmed. */
export function confirmDialog(opts: ConfirmOptions): Promise<boolean> {
  if (typeof document === "undefined") return Promise.resolve(false)
  if (!confirmRoot) {
    const el = document.createElement("div")
    el.dataset.confirmDialogRoot = ""
    document.body.appendChild(el)
    confirmRoot = createRoot(el)
  }
  return new Promise((resolve) => {
    active = { ...opts, resolve }
    renderActive()
  })
}

// keep unused-var lint quiet for the listener registry (future multi-dialog queueing)
void confirmListeners
