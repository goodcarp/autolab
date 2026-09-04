// Make `three` resolvable from wherever the model happens to live.
//
// The model is authored in another repository, imports `three` bare, and has no
// node_modules of its own. The alternative to this hook is copying the model in
// — which is exactly the drift that let a released door fix sit unused for a
// day. The engine supplies the runtime instead, and the model stays canonical
// and untouched at its own path.

import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);

export function resolve(specifier, context, nextResolve) {
  if (specifier === "three" || specifier.startsWith("three/")) {
    try {
      return { url: pathToFileURL(require.resolve(specifier)).href, shortCircuit: true };
    } catch {
      // Fall through: let Node report its own error rather than masking it.
    }
  }
  return nextResolve(specifier, context);
}
