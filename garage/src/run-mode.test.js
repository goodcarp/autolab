import test from 'node:test';
import assert from 'node:assert/strict';
import { createRunMode, RUN_MODE_PENDING } from './run-mode.js';

test('run mode starts once, says it is coming, and stops back to silence', () => {
  const said = [], changes = [];
  const run = createRunMode({ say: text => said.push(text), onChange: on => changes.push(on) });
  assert.equal(run.active(), false);
  assert.equal(run.stop(), false, 'stopping a stopped run does nothing');
  assert.equal(run.start(), true);
  assert.equal(run.active(), true);
  assert.equal(run.start(), false, 'a second PLAY is not a second run');
  assert.equal(run.stop(), true);
  assert.equal(run.active(), false);
  assert.deepEqual(said, [RUN_MODE_PENDING, '']);
  assert.deepEqual(changes, [true, false]);
  assert.equal(RUN_MODE_PENDING, 'Run mode: coming in the next build');
});
