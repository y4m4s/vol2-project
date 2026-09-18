import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {existsSync} from 'node:fs';

// Invalid comparisons must fail before probing a backend or creating a run.
const out = `eval/results/invalid-comparison-${process.pid}`;
const run = (candidate, extra = []) => spawnSync(process.execPath, [
  'eval/run-paired.mjs', '--baseline', 'eval/configs/m917-lm-q3-14b.json',
  '--candidate', candidate, '--out', out, ...extra
], {encoding:'utf8'});
test('different models require explicit opt-in', () => {
  const result = run('eval/configs/m917-lm-q35-9b.json');
  assert.equal(result.status, 1);
  assert.match(result.stderr, /explicit --model-comparison/);
  assert.equal(existsSync(`${out}-baseline`), false);
});
test('model comparison cannot silently compare different providers', () => {
  const result = run('eval/configs/m917-oll-q35-9b.json', ['--model-comparison']);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /same provider/);
  assert.equal(existsSync(`${out}-baseline`), false);
});
test('model comparison rejects simultaneous changes to request controls', () => {
  const result = run('eval/configs/af-lm-off.json', ['--model-comparison']);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /preserve request controls/);
  assert.equal(existsSync(`${out}-baseline`), false);
});
