import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ProgramRuntime, validateProgram, PROGRAM_EXAMPLES } from '../web/program.mjs';
const executable = fileURLToPath(new URL('../.build/native/trace_program', import.meta.url));

function nativeTrace(program, weather, times) {
  const run = spawnSync(executable, {
    input: JSON.stringify({ program, weather, times }), encoding: 'utf8',
  });
  assert.equal(run.status, 0, run.stderr || run.error?.message);
  return JSON.parse(run.stdout);
}

function browserTrace(program, weather, times) {
  const runtime = new ProgramRuntime(program).start(0);
  return times.map(time => {
    const frame = runtime.step(time, weather);
    return { time, running: frame.running, ...frame.state };
  });
}

const times = [0, 50, 99, 100, 199, 200, 500, 999, 1000, 1100, 2000, 3000, 7000, 10000, 30000, 30001];
for (const example of PROGRAM_EXAMPLES) {
  for (const weather of ['sun', 'cloud', 'rain', 'snow', 'unknown']) {
    test(`device/browser trace match: ${example.id}, cached ${weather}`, () => {
      assert.deepEqual(nativeTrace(example.program, weather, times), browserTrace(example.program, weather, times));
    });
  }
}

test('nested empty branches and repeats have the same execution budget and completion', () => {
  const program = { schema: 1, enabled: true, loop: false, blocks: [
    { type: 'repeat', count: 20, blocks: [] },
    { type: 'repeat', count: 2, blocks: [
      { type: 'ifWeather', kind: 'rain', then: [], else: [{ type: 'emotion', value: 'love' }] },
      { type: 'wait', ms: 100 },
    ] },
    { type: 'character', value: 'turtle' },
  ] };
  assert.deepEqual(nativeTrace(program, 'unknown', times), browserTrace(program, 'unknown', times));
});

test('waitless loops stay bounded and yield identically', () => {
  const program = { schema: 1, enabled: true, loop: true,
    blocks: [{ type: 'repeat', count: 20, blocks: [{ type: 'emotion', value: 'excited' }] }] };
  assert.deepEqual(nativeTrace(program, 'sun', times), browserTrace(program, 'sun', times));
});

test('64-bit elapsed time does not wrap in either runtime', () => {
  const program = { schema: 1, enabled: true, loop: false,
    blocks: [{ type: 'wait', ms: 100 }, { type: 'emotion', value: 'love' }] };
  const sequence = [0, 50, 4294967295, 4294967400];
  assert.deepEqual(nativeTrace(program, 'unknown', sequence), browserTrace(program, 'unknown', sequence));
});

test('malformed program contracts are rejected on both platforms', () => {
  const good = PROGRAM_EXAMPLES[0].program;
  const invalid = [
    { ...good, schema: true }, { ...good, enabled: 1 }, { ...good, loop: 'true' },
    { ...good, extra: 'not part of schema' }, { ...good, blocks: [] },
    { ...good, blocks: [{ type: 'wait', ms: 99 }] },
    { ...good, blocks: [{ type: 'wait', ms: 100.5 }] },
    { ...good, blocks: [{ type: 'emotion', value: 'surprise' }] },
    { ...good, blocks: [{ type: 'character', value: 'cat\u0000extra' }] },
    { ...good, blocks: [{ type: 'weather\u0000extra' }] },
    { ...good, blocks: [{ type: 'ifWeather', kind: 'rain\u0000extra', then: [], else: [] }] },
    { ...good, blocks: [{ type: 'repeat', count: 21, blocks: [] }] },
    { ...good, blocks: Array.from({ length: 65 }, () => ({ type: 'weather' })) },
    { ...good, blocks: [{ type: 'weather', value: 'unused' }] },
  ];
  for (const program of invalid) {
    assert.throws(() => validateProgram(program));
    const run = spawnSync(executable, {
      input: JSON.stringify({ program, weather: 'unknown', times: [0] }), encoding: 'utf8',
    });
    assert.notEqual(run.status, 0, JSON.stringify(program));
  }
});

test('disabled programs and monotonic-clock rollback fail safe identically', () => {
  const program = { schema: 1, enabled: true, loop: false,
    blocks: [{ type: 'character', value: 'bear' }, { type: 'wait', ms: 1000 }] };
  assert.deepEqual(nativeTrace({ ...program, enabled: false }, 'sun', [0, 1000]),
    browserTrace({ ...program, enabled: false }, 'sun', [0, 1000]));
  assert.deepEqual(nativeTrace(program, 'sun', [0, 500, 200]), browserTrace(program, 'sun', [0, 500, 200]));
});
