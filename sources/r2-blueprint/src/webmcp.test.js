import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { CONFIG } from './config.js';

// No WebGL is needed to inspect declarations or exercise browser registration.
const source = (await readFile(new URL('./webmcp.js', import.meta.url), 'utf8'))
  .replace("import * as THREE from 'three';", 'const THREE = { Box3: class {}, Vector3: class {} };');
const { installWebMCP, toolDeclarations, watchWebMCP } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
function browser(t, doc = {}, nav = {}) {
  for (const [name, value] of Object.entries({ document: doc, navigator: nav, window: { addEventListener() {} } })) {
    const old = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
    t.after(() => { if (old) Object.defineProperty(globalThis, name, old); else delete globalThis[name]; });
  }
  t.mock.timers.enable({ apis: ['setInterval', 'setTimeout'] });
}
const mirror = () => ({ tools: toolDeclarations([{ name: 'get_state', description: 'Read state.', inputSchema: { type: 'object', properties: {} } }]), registered: false, api: null });

test('all 18 actual tools have closed schemas, titles and complete annotations', async t => {
  const registered = [];
  browser(t, { modelContext: { registerTool: tool => registered.push(tool) } });
  installWebMCP({ config: CONFIG, ui: {} });
  await flush();
  assert.equal(window.r2.tools.length, 18);
  assert.equal(registered.length, 18);
  for (const tool of window.r2.tools) {
    assert.equal(tool.inputSchema.additionalProperties, false, tool.name);
    assert.ok(tool.title.trim() && !tool.title.includes('_'), tool.name);
    assert.deepEqual(Object.keys(tool.annotations).sort(), ['destructiveHint', 'idempotentHint', 'openWorldHint', 'readOnlyHint']);
    for (const value of Object.values(tool.annotations)) assert.equal(typeof value, 'boolean');
    const declaration = registered.find(t => t.name === tool.name);
    assert.deepEqual(toolDeclarations([declaration])[0], tool);
  }
  assert.equal(window.r2.registered, true);
});
test('declaration projection preserves property names and enums without mutating the input', () => {
  const schema = { type: 'object', properties: { motion: { type: 'string', enum: ['run', 'drive'] } }, required: ['motion'] };
  const tools = [{ name: 'set_motion', description: 'Toggle.', inputSchema: schema }];
  const [result] = toolDeclarations(tools);
  assert.deepEqual(result.inputSchema, { ...schema, additionalProperties: false });
  assert.equal(schema.additionalProperties, undefined);
  assert.equal(result.annotations.idempotentHint, false);
});
test('document registerTool wins over navigator and provideContext; waits for success', async t => {
  let resolve, updates = 0;
  browser(t, { modelContext: { registerTool: () => new Promise(r => { resolve = r; }), provideContext: () => assert.fail('legacy') } },
    { modelContext: { registerTool: () => assert.fail('navigator') } });
  const api = mirror(); watchWebMCP(api, () => ({}), () => updates++);
  assert.equal(api.registered, false);
  resolve(); await flush();
  assert.equal(api.registered, true); assert.equal(api.api, 'document.modelContext.registerTool'); assert.equal(updates, 1);
});
test('late navigator injection registers once and execute uses the shared dispatcher', async t => {
  browser(t);
  const api = mirror(), declared = [];
  watchWebMCP(api, name => ({ name }));
  t.mock.timers.tick(11000);
  navigator.modelContext = { registerTool: tool => declared.push(tool) };
  t.mock.timers.tick(250); await flush();
  assert.equal(api.registered, true); assert.equal(api.api, 'navigator.modelContext.registerTool');
  t.mock.timers.tick(2000); await flush(); assert.equal(declared.length, 1);
  assert.deepEqual(JSON.parse((await declared[0].execute({})).content[0].text), { name: 'get_state' });
});
test('provideContext is used only as fallback', async t => {
  let declared;
  browser(t, { modelContext: { provideContext: ({ tools }) => { declared = tools; } } });
  const api = mirror(); watchWebMCP(api, () => ({})); await flush();
  assert.equal(api.registered, true); assert.equal(api.api, 'document.modelContext.provideContext');
  assert.equal(declared[0].title, 'Get State');
});
test('watch expires at 12 seconds and unsupported objects never report registration', async t => {
  browser(t, { modelContext: {} });
  const api = mirror(); watchWebMCP(api, () => ({}));
  t.mock.timers.tick(12000);
  document.modelContext.registerTool = () => assert.fail('watch should have ended');
  t.mock.timers.tick(1000); await flush();
  assert.equal(api.registered, false); assert.equal(api.api, null);
});
test('failed registration retries only tools that failed', async t => {
  let first = 0, second = 0;
  browser(t, { modelContext: { registerTool: ({ name }) => {
    if (name === 'get_state') first++;
    else if (++second === 1) throw new Error('temporarily unavailable');
  } } });
  t.mock.method(console, 'warn', () => {});
  const api = mirror(); api.tools.push({ ...api.tools[0], name: 'measure' });
  watchWebMCP(api, () => ({})); await flush(); assert.equal(api.registered, false);
  t.mock.timers.tick(250); await flush();
  assert.equal(api.registered, true); assert.equal(first, 1); assert.equal(second, 2);
});
