import test from 'node:test';
import assert from 'node:assert/strict';
import { validateProgram, serializeProgram, ProgramRuntime, PROGRAM_EXAMPLES, PROGRAM_LIMITS } from '../web/program.mjs';

const emotion = (value) => ({ type: 'emotion', value });
const wait = (ms) => ({ type: 'wait', ms });
const program = (blocks, loop = false, enabled = true) => ({ schema: 1, enabled, loop, blocks });
const clone = (value) => JSON.parse(JSON.stringify(value));
const BASE = { character: 'cat', emotion: 'sad', view: 'auto' };

test('canonical serialization round-trips every example without code generation', () => {
  for (const example of PROGRAM_EXAMPLES) {
    const serialized = serializeProgram(example.program);
    assert.deepEqual(JSON.parse(serialized), example.program);
    assert.notEqual(validateProgram(example.program), example.program);
  }
});

test('strict format rejects unknown keys and all unsupported operations', () => {
  const valid = program([emotion('love')]);
  const cases = [null, [], { ...valid, schema: 2 }, { ...valid, enabled: 1 }, { ...valid, loop: 'yes' },
    { ...valid, script: 'throw new Error()' }, program([{ type: 'javascript', code: 'alert(1)' }]),
    program([{ type: 'emotion', value: 'happy', ignored: 'payload' }]), program([{ type: 'emotion', value: 'unknown' }]),
    program([{ type: 'character', value: 'dragon' }]), program([{ type: 'weather', value: true }]),
    program([{ type: 'ifWeather', kind: 'storm', then: [], else: [] }]), program([null]),
    program([]), program(new Array(1)), program([{ type: 'repeat', count: 1, blocks: null }])];
  for (const invalid of cases) assert.throws(() => validateProgram(invalid));
});

test('wait and repetition values require bounded integers without numeric coercion', () => {
  for (const ms of [99, 30001, -1, 100.5, '1000', NaN, Infinity]) assert.throws(() => validateProgram(program([wait(ms)])));
  for (const count of [0, 21, 1.5, '2', NaN]) assert.throws(() => validateProgram(program([{ type: 'repeat', count, blocks: [] }])));
  for (const ms of [100, 123, 30000]) assert.equal(validateProgram(program([wait(ms)])).blocks[0].ms, ms);
});

test('all nested branches count toward the 64-node limit', () => {
  assert.equal(validateProgram(program(Array.from({ length: 64 }, () => emotion('happy')))).blocks.length, 64);
  assert.throws(() => validateProgram(program(Array.from({ length: 65 }, () => emotion('happy')))));
  const split = { type: 'ifWeather', kind: 'rain', then: Array.from({ length: 32 }, () => emotion('happy')), else: Array.from({ length: 32 }, () => emotion('sad')) };
  assert.throws(() => validateProgram(program([split])));
});

test('nesting is capped at four executable levels; empty deepest branches are legal', () => {
  const repeat = (blocks) => ({ type: 'repeat', count: 2, blocks });
  const depth4 = repeat([repeat([repeat([emotion('happy')])])]);
  assert.doesNotThrow(() => validateProgram(program([depth4])));
  assert.throws(() => validateProgram(program([repeat([depth4])])));
  assert.doesNotThrow(() => validateProgram(program([repeat([repeat([repeat([repeat([])])])])])));
});

test('wait preserves output until the exact deadline and never blocks the caller', () => {
  const vm = new ProgramRuntime(program([{ type: 'character', value: 'turtle' }, wait(1000), emotion('love')]), BASE).start(10);
  const first = vm.step(10);
  assert.deepEqual(first.state, { character: 'turtle', emotion: 'sad', view: 'character' });
  assert.equal(first.waitingUntil, 1010);
  assert.equal(vm.step(1009).events.length, 0);
  const end = vm.step(1010);
  assert.equal(end.running, false);
  assert.equal(end.state.emotion, 'love');
  assert.equal(end.events.at(-1).type, 'complete');
});

test('repeat executes exactly the requested count before the following block', () => {
  const vm = new ProgramRuntime(program([{ type: 'repeat', count: 3, blocks: [emotion('happy'), wait(100), emotion('love'), wait(100)] }, { type: 'weather' }]), BASE).start();
  const all = [];
  for (const now of [0, 100, 200, 300, 400, 500, 600]) all.push(...vm.step(now).events);
  assert.equal(all.filter((event) => event.type === 'emotion' && event.value === 'happy').length, 3);
  assert.equal(all.filter((event) => event.type === 'emotion' && event.value === 'love').length, 3);
  assert.equal(vm.state.view, 'weather');
  assert.equal(vm.running, false);
});

test('weather conditions choose one branch and missing weather chooses else', () => {
  const ast = program([{ type: 'ifWeather', kind: 'rain', then: [emotion('sleepy')], else: [emotion('excited')] }]);
  for (const [kind, expected] of [['rain', 'sleepy'], ['sun', 'excited'], [null, 'excited']]) {
    const result = new ProgramRuntime(ast).start().step(0, kind);
    assert.equal(result.state.emotion, expected);
    assert.equal(result.events.filter((event) => event.type === 'emotion').length, 1);
    assert.equal(result.activePath, kind === 'rain' ? '0.then.0' : '0.else.0');
  }
});

test('condition uses the weather supplied at execution, including after a wait', () => {
  const vm = new ProgramRuntime(program([wait(100), { type: 'ifWeather', kind: 'snow', then: [emotion('love')], else: [emotion('sad')] }])).start();
  vm.step(0, 'rain');
  assert.equal(vm.step(100, 'snow').state.emotion, 'love');
});

test('every completed top-level loop yields 100ms, including loops with waits', () => {
  for (const blocks of [[emotion('happy')], [emotion('happy'), wait(100)]]) {
    const vm = new ProgramRuntime(program(blocks, true)).start();
    let result = vm.step(0);
    if (blocks.length > 1) result = vm.step(100);
    const loopAt = blocks.length > 1 ? 100 : 0;
    assert.equal(result.waitingUntil, loopAt + 100);
    assert.equal(vm.step(loopAt + 99).events.length, 0);
    assert.ok(vm.step(loopAt + 100).events.some((event) => event.type === 'emotion'));
  }
});

test('a tick is bounded even for many nested repeats without waits', () => {
  const inner = { type: 'repeat', count: 20, blocks: [emotion('happy'), emotion('love')] };
  const vm = new ProgramRuntime(program([{ type: 'repeat', count: 20, blocks: [inner] }])).start();
  let emotions = 0;
  let ticks = 0;
  while (vm.running && ticks < 500) {
    const result = vm.step(ticks);
    assert.ok(result.events.length <= PROGRAM_LIMITS.operationsPerStep);
    emotions += result.events.filter((event) => event.type === 'emotion').length;
    ticks += 1;
  }
  assert.equal(vm.running, false);
  assert.equal(emotions, 800);
  assert.ok(ticks > 50);
});

test('empty nested containers consume one instruction without adding a stack frame', () => {
  const blocks = Array.from({ length: 15 }, () => ({ type: 'repeat', count: 20, blocks: [] }));
  blocks.push(emotion('love'));
  const vm = new ProgramRuntime(program(blocks)).start();
  const first = vm.step(0);
  assert.equal(first.state.emotion, 'love');
  assert.equal(first.events.length, 16);
  assert.equal(first.running, true);
  assert.equal(vm.step(0).running, false);
});

test('natural completion retains output, explicit stop restores saved manual settings', () => {
  const vm = new ProgramRuntime(program([{ type: 'character', value: 'bear' }, emotion('angry')]), BASE).start();
  assert.equal(vm.step(0).running, false);
  assert.deepEqual(vm.step(20).state, { character: 'bear', emotion: 'angry', view: 'character' });
  assert.deepEqual(vm.stop().state, BASE);
  vm.start(100);
  assert.deepEqual(vm.state, BASE);
});

test('disabled saved programs do not run', () => {
  const result = new ProgramRuntime(program([emotion('love')], true, false), BASE).start().step(0);
  assert.equal(result.running, false);
  assert.deepEqual(result.state, BASE);
  assert.equal(result.events.length, 0);
});

test('time arithmetic survives 32-bit millis rollover and rollback stops safely', () => {
  const now = 2 ** 32 - 50;
  const vm = new ProgramRuntime(program([wait(100), emotion('love')]), BASE).start(now);
  assert.equal(vm.step(now).waitingUntil, now + 100);
  assert.equal(vm.step(now + 99).state.emotion, 'sad');
  assert.equal(vm.step(now + 100).state.emotion, 'love');
  const second = new ProgramRuntime(program([wait(100), emotion('love')]), BASE).start(1000);
  second.step(1000);
  const stopped = second.step(999);
  assert.equal(stopped.running, false);
  assert.deepEqual(stopped.state, BASE);
});

test('validation copies the input, so later edits cannot change a running program', () => {
  const original = program([emotion('love')]);
  const vm = new ProgramRuntime(original).start();
  original.blocks[0].value = 'angry';
  assert.equal(vm.step(0).state.emotion, 'love');
  const copied = validateProgram(clone(PROGRAM_EXAMPLES[1].program));
  assert.deepEqual(copied, PROGRAM_EXAMPLES[1].program);
});
