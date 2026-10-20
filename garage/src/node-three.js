// Test support, never loaded by the page. Resolves the bare 'three' and 'three/addons/' imports
// the way index.html's import map does, from the configurator's installed copy, so a test can
// import the sheet's own modules (vehicles.js, the Roadster under rd/) under plain Node.
import { register } from 'node:module';

const base = new URL('../../universal-vehicle-configurator/node_modules/three/', import.meta.url).href;
const hooks = `export async function resolve(specifier, context, next) {
  if (specifier === 'three') return next(${JSON.stringify(base + 'build/three.module.js')}, context);
  if (specifier.startsWith('three/addons/')) return next(${JSON.stringify(base + 'examples/jsm/')} + specifier.slice(13), context);
  return next(specifier, context);
}`;
register(`data:text/javascript,${encodeURIComponent(hooks)}`);

export const threeUrl = base + 'build/three.module.js';
