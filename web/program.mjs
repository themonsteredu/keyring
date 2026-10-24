/** Portable, deliberately small keyring program format. No generated code or eval. */
export const PROGRAM_LIMITS = Object.freeze({ nodes: 64, depth: 4, operationsPerStep: 16, loopDelayMs: 100 });
export const CHARACTER_VALUES = Object.freeze(['rabbit', 'cat', 'bear', 'turtle', 'monster']);
export const EMOTION_VALUES = Object.freeze(['happy', 'excited', 'sleepy', 'sad', 'angry', 'love']);
export const WEATHER_KINDS = Object.freeze(['sun', 'cloud', 'rain', 'snow']);

function requireValue(condition, message) { if (!condition) throw new Error(message); }
function object(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function exactKeys(value, keys, name) {
  requireValue(object(value) && Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key)), `${name} 형식이 올바르지 않아요.`);
}
function integer(value, minimum, maximum, name) {
  requireValue(Number.isInteger(value) && value >= minimum && value <= maximum, `${name}은 ${minimum}~${maximum} 사이의 정수로 입력해 주세요.`);
  return value;
}

/** Validate and copy a program; reject unexpected keys instead of executing text. */
export function validateProgram(input) {
  exactKeys(input, ['schema', 'enabled', 'loop', 'blocks'], '프로그램');
  requireValue(input.schema === 1 && typeof input.enabled === 'boolean' && typeof input.loop === 'boolean', '이 키링에서 읽을 수 없는 프로그램이에요.');
  requireValue(Array.isArray(input.blocks) && input.blocks.length > 0, '시작 블록 아래에 실행할 블록을 하나 이상 연결해 주세요.');
  let total = 0;
  function sequence(blocks, depth) {
    requireValue(Array.isArray(blocks), '연결된 블록 목록이 필요해요.');
    requireValue(depth <= PROGRAM_LIMITS.depth || blocks.length === 0, `블록은 ${PROGRAM_LIMITS.depth}단계까지만 겹칠 수 있어요.`);
    return Array.from(blocks, (block) => {
      total += 1;
      requireValue(total <= PROGRAM_LIMITS.nodes, `블록은 ${PROGRAM_LIMITS.nodes}개까지만 사용할 수 있어요.`);
      requireValue(object(block) && typeof block.type === 'string', '알 수 없는 블록이 있어요.');
      switch (block.type) {
        case 'character':
          exactKeys(block, ['type', 'value'], '눈 모양 블록');
          requireValue(CHARACTER_VALUES.includes(block.value), '키링이 아는 눈 모양을 골라 주세요.');
          return { type: 'character', value: block.value };
        case 'emotion':
          exactKeys(block, ['type', 'value'], '표정 블록');
          requireValue(EMOTION_VALUES.includes(block.value), '키링이 아는 표정을 골라 주세요.');
          return { type: 'emotion', value: block.value };
        case 'wait':
          exactKeys(block, ['type', 'ms'], '기다리기 블록');
          return { type: 'wait', ms: integer(block.ms, 100, 30000, '기다리는 시간(밀리초)') };
        case 'weather':
          exactKeys(block, ['type'], '날씨 블록');
          return { type: 'weather' };
        case 'repeat':
          exactKeys(block, ['type', 'count', 'blocks'], '반복 블록');
          return { type: 'repeat', count: integer(block.count, 1, 20, '반복 횟수'), blocks: sequence(block.blocks, depth + 1) };
        case 'ifWeather':
          exactKeys(block, ['type', 'kind', 'then', 'else'], '날씨 조건 블록');
          requireValue(WEATHER_KINDS.includes(block.kind), '맑음·흐림·비·눈 중 하나를 골라 주세요.');
          return { type: 'ifWeather', kind: block.kind, then: sequence(block.then, depth + 1), else: sequence(block.else, depth + 1) };
        default: throw new Error('키링에서 사용할 수 없는 블록이 있어요.');
      }
    });
  }
  return { schema: 1, enabled: input.enabled, loop: input.loop, blocks: sequence(input.blocks, 1) };
}

export function serializeProgram(program) { return JSON.stringify(validateProgram(program)); }

/** A monotonic, bounded interpreter matching the device's millis-independent VM. */
export class ProgramRuntime {
  constructor(program, initialState = {}) {
    this.program = validateProgram(program);
    this.state = {
      character: CHARACTER_VALUES.includes(initialState.character) ? initialState.character : 'rabbit',
      emotion: EMOTION_VALUES.includes(initialState.emotion) ? initialState.emotion : 'happy',
      view: ['character', 'weather', 'auto'].includes(initialState.view) ? initialState.view : 'character',
    };
    this.baseState = { ...this.state };
    this.running = false;
    this.waitingUntil = null;
    this.activePath = null;
    this.stack = [];
    this.lastNow = 0;
  }

  start(nowMs = 0) {
    requireValue(Number.isFinite(nowMs) && nowMs >= 0, '실행 시각이 올바르지 않아요.');
    this.running = this.program.enabled;
    this.state = { ...this.baseState };
    this.waitingUntil = null;
    this.activePath = null;
    this.lastNow = nowMs;
    this.stack = [{ blocks: this.program.blocks, index: 0, remaining: 1, path: '' }];
    return this;
  }

  stop() { this.running = false; this.state = { ...this.baseState }; this.waitingUntil = null; this.stack = []; return this.snapshot([]); }
  snapshot(events) { return { running: this.running, state: { ...this.state }, events, activePath: this.activePath, waitingUntil: this.waitingUntil }; }

  step(nowMs, weatherKind = null) {
    requireValue(Number.isFinite(nowMs) && nowMs >= 0, '실행 시각이 올바르지 않아요.');
    if (nowMs < this.lastNow) return this.stop();
    const now = nowMs;
    this.lastNow = now;
    const events = [];
    if (!this.running || (this.waitingUntil !== null && now < this.waitingUntil)) return this.snapshot(events);
    this.waitingUntil = null;
    for (let operations = 0; operations < PROGRAM_LIMITS.operationsPerStep && this.running; operations += 1) {
      const frame = this.stack[this.stack.length - 1];
      if (!frame) { this.running = false; break; }
      if (frame.index >= frame.blocks.length) {
        if (frame.remaining > 1) { frame.remaining -= 1; frame.index = 0; continue; }
        this.stack.pop();
        if (this.stack.length) continue;
        if (this.program.loop && this.program.blocks.length) {
          this.stack.push({ blocks: this.program.blocks, index: 0, remaining: 1, path: '' });
          this.waitingUntil = now + PROGRAM_LIMITS.loopDelayMs;
          events.push({ type: 'loop' });
        } else { this.running = false; events.push({ type: 'complete' }); }
        break;
      }
      const index = frame.index++;
      const block = frame.blocks[index];
      const path = frame.path ? `${frame.path}.${index}` : String(index);
      this.activePath = path;
      events.push({ ...block, path });
      switch (block.type) {
        case 'character': this.state.character = block.value; this.state.view = 'character'; break;
        case 'emotion': this.state.emotion = block.value; this.state.view = 'character'; break;
        case 'weather': this.state.view = 'weather'; break;
        case 'wait': this.waitingUntil = now + block.ms; return this.snapshot(events);
        case 'repeat': if (block.blocks.length) this.stack.push({ blocks: block.blocks, index: 0, remaining: block.count, path: `${path}.blocks` }); break;
        case 'ifWeather': {
          const branch = weatherKind === block.kind ? 'then' : 'else';
          if (block[branch].length) this.stack.push({ blocks: block[branch], index: 0, remaining: 1, path: `${path}.${branch}` });
          break;
        }
      }
    }
    return this.snapshot(events);
  }
}

export const PROGRAM_EXAMPLES = Object.freeze([
  { id: 'feelings', name: '두근두근 하트', program: {
    schema: 1, enabled: true, loop: true,
    blocks: [{ type: 'character', value: 'rabbit' }, { type: 'emotion', value: 'happy' }, { type: 'wait', ms: 1000 },
      { type: 'emotion', value: 'love' }, { type: 'wait', ms: 1000 }],
  } },
  { id: 'weather', name: '비 오는 날의 표정', program: {
    schema: 1, enabled: true, loop: true,
    blocks: [{ type: 'character', value: 'turtle' }, { type: 'ifWeather', kind: 'rain',
      then: [{ type: 'emotion', value: 'sleepy' }], else: [{ type: 'emotion', value: 'happy' }] },
    { type: 'wait', ms: 3000 }, { type: 'weather' }, { type: 'wait', ms: 5000 }],
  } },
  { id: 'all-emotions', name: '여섯 가지 마음 만나기', program: {
    schema: 1, enabled: true, loop: true,
    blocks: [{ type: 'character', value: 'monster' }, ...EMOTION_VALUES.flatMap((value) => [{ type: 'emotion', value }, { type: 'wait', ms: 1500 }])],
  } },
]);
