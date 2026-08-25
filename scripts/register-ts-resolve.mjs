// Registers the .js -> .ts resolve hook for the linked effect monorepo sources.
// Usage: node --import ./scripts/register-ts-resolve.mjs <file.ts>
import { register } from "node:module"
import { pathToFileURL } from "node:url"

register("./ts-resolve-hook.mjs", new URL("./ts-resolve-hook.mjs", import.meta.url))
