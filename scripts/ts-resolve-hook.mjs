/**
 * Resolve hook: when a .ts file inside the linked effect monorepo sources
 * imports "./x.js", retry as "./x.ts". Everything else resolves normally.
 */
const EFFECT_SRC_MARKER = "/effect/packages/"

export async function resolve(specifier, context, nextResolve) {
  const parent = context.parentURL ?? ""
  const inEffectSources =
    parent.includes(EFFECT_SRC_MARKER) &&
    (parent.endsWith(".ts") || parent.includes("/src/"))
  if (inEffectSources && specifier.startsWith(".") && specifier.endsWith(".js")) {
    try {
      return await nextResolve(specifier, context)
    } catch {
      return nextResolve(`${specifier.slice(0, -3)}.ts`, context)
    }
  }
  // fast path
  return nextResolve(specifier, context)
}
