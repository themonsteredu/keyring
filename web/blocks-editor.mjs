import { validateProgram, serializeProgram, ProgramRuntime, PROGRAM_EXAMPLES } from './program.mjs';
import { weatherKind } from './weather.mjs';

let activeStudio = null;
export function getActiveStudio() { return activeStudio; }
const TYPES = Object.freeze({ character: 'keyring_character', emotion: 'keyring_emotion', wait: 'keyring_wait', weather: 'keyring_weather', repeat: 'keyring_repeat', ifWeather: 'keyring_if_weather' });
const REVERSE_TYPES = Object.fromEntries(Object.entries(TYPES).map(([key, value]) => [value, key]));

function defineBlocks(Blockly) {
  if (Blockly.Blocks.keyring_start) return;
  Blockly.defineBlocksWithJsonArray([
    { type: 'keyring_start', message0: '키링 시작할 때', nextStatement: null, style: 'start_blocks', hat: 'cap', tooltip: '이 블록 아래에 실행할 블록을 연결해요. 시작 블록은 하나만 필요해요.' },
    { type: TYPES.character, message0: '캐릭터를 %1 로 바꾸기', args0: [{ type: 'field_dropdown', name: 'VALUE', options: [['토끼', 'rabbit'], ['고양이', 'cat'], ['곰', 'bear'], ['거북이', 'turtle'], ['몬스터', 'monster']] }], previousStatement: null, nextStatement: null, style: 'character_blocks', tooltip: '캐릭터 화면으로 바꾸고 이 친구를 보여 줘요.' },
    { type: TYPES.emotion, message0: '표정을 %1 으로 바꾸기', args0: [{ type: 'field_dropdown', name: 'VALUE', options: [['행복', 'happy'], ['신남', 'excited'], ['졸림', 'sleepy'], ['슬픔', 'sad'], ['화남', 'angry'], ['사랑', 'love']] }], previousStatement: null, nextStatement: null, style: 'emotion_blocks', tooltip: '캐릭터가 어떤 마음인지 표정으로 표현해요.' },
    { type: TYPES.wait, message0: '%1 초 기다리기', args0: [{ type: 'field_number', name: 'SECONDS', value: 1, min: 0.1, max: 30, precision: 0.001 }], previousStatement: null, nextStatement: null, style: 'time_blocks', tooltip: '0.1~30초 동안 지금 화면을 보여 줘요. 기다리는 동안에도 키링 설정 화면은 작동해요.' },
    { type: TYPES.weather, message0: '저장된 날씨 보여 주기', previousStatement: null, nextStatement: null, style: 'weather_blocks', tooltip: '키링에 담아 둔 날씨와 예보를 보여 줘요. 오래된 예보와 샘플은 따로 표시해요.' },
    { type: TYPES.repeat, message0: '%1 번 반복하기', args0: [{ type: 'field_number', name: 'COUNT', value: 3, min: 1, max: 20, precision: 1 }], message1: '%1', args1: [{ type: 'input_statement', name: 'DO' }], previousStatement: null, nextStatement: null, style: 'control_blocks', tooltip: '안에 끼운 블록을 1~20번 반복해요.' },
    { type: TYPES.ifWeather, message0: '저장된 날씨가 %1 이면', args0: [{ type: 'field_dropdown', name: 'KIND', options: [['맑음', 'sun'], ['흐림', 'cloud'], ['비', 'rain'], ['눈', 'snow']] }], message1: '%1', args1: [{ type: 'input_statement', name: 'THEN' }], message2: '아니면 %1', args2: [{ type: 'input_statement', name: 'ELSE' }], previousStatement: null, nextStatement: null, style: 'weather_blocks', tooltip: '저장된 날씨의 종류를 보고 실행할 블록을 골라요. 날씨가 없으면 아니면 쪽을 실행해요. 최신 여부는 날씨 표시에서 확인해요.' },
  ]);
}

function compileWorkspace(workspace, loop) {
  const tops = workspace.getTopBlocks(true);
  if (tops.length !== 1 || tops[0].type !== 'keyring_start') throw new Error('시작 블록 하나 아래에 모든 블록을 연결해 주세요. 떨어진 블록은 실행할 수 없어요.');
  const ids = new Map();
  let seen = 0;
  function chain(first, prefix = '', depth = 1) {
    const nodes = [];
    for (let block = first; block; block = block.getNextBlock()) {
      if (++seen > 64 || depth > 4) throw new Error('블록은 64개, 겹치기는 4단계까지만 사용할 수 있어요.');
      if (!block.isEnabled()) throw new Error('사용하지 않는 블록은 삭제하거나 다시 켜 주세요.');
      const type = REVERSE_TYPES[block.type];
      if (!type) throw new Error('키링이 이해할 수 없는 블록이 있어요.');
      const path = prefix ? `${prefix}.${nodes.length}` : String(nodes.length);
      ids.set(path, block.id);
      let node;
      if (type === 'character' || type === 'emotion') node = { type, value: block.getFieldValue('VALUE') };
      else if (type === 'wait') node = { type, ms: Math.round(Number(block.getFieldValue('SECONDS')) * 1000) };
      else if (type === 'weather') node = { type };
      else if (type === 'repeat') node = { type, count: Number(block.getFieldValue('COUNT')), blocks: chain(block.getInputTargetBlock('DO'), `${path}.blocks`, depth + 1) };
      else node = { type, kind: block.getFieldValue('KIND'), then: chain(block.getInputTargetBlock('THEN'), `${path}.then`, depth + 1), else: chain(block.getInputTargetBlock('ELSE'), `${path}.else`, depth + 1) };
      nodes.push(node);
    }
    return nodes;
  }
  const program = validateProgram({ schema: 1, enabled: true, loop: Boolean(loop), blocks: chain(tops[0].getNextBlock()) });
  return { program, ids };
}

/** The public compiler is also used by browser tests; it never generates JavaScript. */
export function workspaceToProgram(workspace, loop = true) { return compileWorkspace(workspace, loop).program; }

function populateWorkspace(Blockly, workspace, program) {
  Blockly.Events.disable();
  try {
    workspace.clear();
    const start = workspace.newBlock('keyring_start');
    start.initSvg(); start.render(); start.moveBy(workspace.options.horizontalLayout ? 16 : 40, workspace.options.horizontalLayout ? 24 : 36);
    function chain(nodes, previousConnection) {
      for (const node of nodes) {
        const block = workspace.newBlock(TYPES[node.type]);
        if (node.type === 'character' || node.type === 'emotion') block.setFieldValue(node.value, 'VALUE');
        else if (node.type === 'wait') block.setFieldValue(String(node.ms / 1000), 'SECONDS');
        else if (node.type === 'repeat') block.setFieldValue(String(node.count), 'COUNT');
        else if (node.type === 'ifWeather') block.setFieldValue(node.kind, 'KIND');
        block.initSvg();
        previousConnection.connect(block.previousConnection);
        if (node.type === 'repeat') chain(node.blocks, block.getInput('DO').connection);
        else if (node.type === 'ifWeather') { chain(node.then, block.getInput('THEN').connection); chain(node.else, block.getInput('ELSE').connection); }
        block.render();
        previousConnection = block.nextConnection;
      }
    }
    chain(program.blocks, start.nextConnection);
    start.render();
  } finally { Blockly.Events.enable(); }
  workspace.clearUndo();
  Blockly.svgResize(workspace);
}

export async function initializeBlocks({ getDevice = () => null, getWeather = () => getDevice()?.weather, api, onPreview = () => {}, onStatus = () => {} } = {}) {
  const Blockly = globalThis.Blockly;
  const element = document.getElementById('blockly-workspace');
  const $ = (id) => document.getElementById(id);
  const message = (value, kind = '') => {
    $('program-status').textContent = value;
    $('program-status').classList.toggle('error', kind === 'error');
    $('program-status').classList.toggle('success', kind === 'success');
    onStatus(value, kind);
  };
  if (!Blockly || !element) {
    message('블록 편집기를 불러오지 못했어요. 페이지를 새로 열어 주세요.', 'error');
    return null;
  }
  defineBlocks(Blockly);
  const theme = Blockly.Theme.defineTheme('keyring', {
    base: Blockly.Themes.Classic,
    blockStyles: {
      start_blocks: { colourPrimary: '#F1B92B', colourSecondary: '#D29B18', colourTertiary: '#B57D06', hat: 'cap' },
      character_blocks: { colourPrimary: '#4768E8', colourSecondary: '#3150C8', colourTertiary: '#243D9A' },
      emotion_blocks: { colourPrimary: '#B45DD4', colourSecondary: '#9143B3', colourTertiary: '#71358B' },
      time_blocks: { colourPrimary: '#E59435', colourSecondary: '#C47523', colourTertiary: '#A16015' },
      weather_blocks: { colourPrimary: '#269BBD', colourSecondary: '#197E9B', colourTertiary: '#14617A' },
      control_blocks: { colourPrimary: '#E59435', colourSecondary: '#C47523', colourTertiary: '#A16015' },
    },
    categoryStyles: { start_category: { colour: '#D69B0F' }, character_category: { colour: '#4768E8' }, emotion_category: { colour: '#A553C9' }, time_category: { colour: '#D5852D' }, weather_category: { colour: '#228DAE' } },
    componentStyles: { workspaceBackgroundColour: '#F8FAFF', toolboxBackgroundColour: '#FFFFFF', toolboxForegroundColour: '#273758', flyoutBackgroundColour: '#ECF0FA', flyoutForegroundColour: '#273758', flyoutOpacity: 1, scrollbarColour: '#A5B3D3', scrollbarOpacity: 0.6, insertionMarkerColour: '#4057C8', insertionMarkerOpacity: 0.35, cursorColour: '#293EB2' },
    fontStyle: { family: '"S-Core Dream", "Noto Sans KR", sans-serif', weight: '600', size: 12 },
  });
  const toolbox = { kind: 'categoryToolbox', contents: [
    { kind: 'category', name: '시작', categorystyle: 'start_category', contents: [{ kind: 'block', type: 'keyring_start' }] },
    { kind: 'category', name: '캐릭터', categorystyle: 'character_category', contents: [{ kind: 'block', type: TYPES.character }, { kind: 'block', type: TYPES.emotion }] },
    { kind: 'category', name: '시간·반복', categorystyle: 'time_category', contents: [{ kind: 'block', type: TYPES.wait }, { kind: 'block', type: TYPES.repeat }] },
    { kind: 'category', name: '날씨', categorystyle: 'weather_category', contents: [{ kind: 'block', type: TYPES.weather }, { kind: 'block', type: TYPES.ifWeather }] },
  ] };
  const mobileLayout = window.matchMedia('(max-width: 600px)').matches;
  const workspace = Blockly.inject(element, { toolbox, theme, renderer: 'zelos', media: '/vendor/blockly/media/', sounds: false,
    horizontalLayout: mobileLayout, toolboxPosition: 'start',
    trashcan: true, comments: false, collapse: false, disable: false, maxBlocks: 65, scrollbars: true,
    zoom: { controls: true, wheel: true, startScale: mobileLayout ? 0.8 : 0.88, minScale: 0.45, maxScale: 1.4, scaleSpeed: 1.1 },
    move: { scrollbars: true, drag: true, wheel: true }, grid: { spacing: 24, length: 2, colour: '#DCE4F4', snap: false } });
  let runtime = null;
  let ids = new Map();
  let animationFrame = null;
  let dirty = false;
  let changing = false;
  let saving = false;
  let revision = 0;
  let restoredDevice = false;
  let legacyNoticeShown = false;
  let savedDeviceProgram = null;
  let localPreviewRetained = false;
  const initial = PROGRAM_EXAMPLES[0].program;
  function initialState() {
    const device = getDevice();
    return device ? { character: device.character, emotion: device.emotion, view: device.view } : { character: 'rabbit', emotion: 'happy', view: 'character' };
  }
  function stopLocal(explicit = true) {
    if (animationFrame !== null) cancelAnimationFrame(animationFrame);
    animationFrame = null;
    const result = runtime?.stop();
    runtime = null;
    workspace.highlightBlock(null);
    if (explicit && localPreviewRetained) onPreview({ ...(result?.state || initialState()), running: false, stopped: true });
    localPreviewRetained = false;
  }
  function controls() {
    $('program-save').disabled = getDevice()?.capabilities?.blockPrograms !== true || saving;
    $('program-run').disabled = saving;
    $('program-stop').disabled = saving || (!runtime?.running && !localPreviewRetained && !getDevice()?.programRunning && !getDevice()?.program?.enabled);
    $('program-loop').disabled = saving;
    $('program-examples').disabled = saving;
    $('program-import').disabled = saving;
    $('program-reset').disabled = saving;
  }
  function load(program, markDirty = false) {
    const clean = validateProgram(program);
    stopLocal(); changing = true;
    try { populateWorkspace(Blockly, workspace, clean); $('program-loop').checked = clean.loop; }
    finally { changing = false; }
    revision += 1;
    dirty = markDirty;
    controls();
    return clean;
  }
  const examples = $('program-examples');
  const placeholder = document.createElement('option'); placeholder.value = ''; placeholder.textContent = '예제 선택'; examples.append(placeholder);
  for (const example of PROGRAM_EXAMPLES) { const option = document.createElement('option'); option.value = example.id; option.textContent = example.name; examples.append(option); }
  load(initial);
  workspace.addChangeListener((event) => {
    if (changing || event.isUiEvent || event.type === Blockly.Events.FINISHED_LOADING) return;
    revision += 1;
    dirty = true;
    if (runtime || localPreviewRetained) stopLocal();
    message('블록을 바꿨어요. 미리 실행해서 확인한 뒤 키링에 저장해 주세요.');
    controls();
  });
  $('program-loop').addEventListener('change', () => { revision += 1; dirty = true; stopLocal(); message('반복 설정을 바꿨어요. 미리 실행해서 확인해 주세요.'); controls(); });
  examples.addEventListener('change', () => {
    const example = PROGRAM_EXAMPLES.find((entry) => entry.id === examples.value);
    if (!example) return;
    load(example.program, true); message(`${example.name} 블록을 준비했어요. 블록을 옮기거나 숫자를 바꿔 보세요.`);
    examples.value = '';
  });
  function cachedWeatherKind() {
    const weather = getWeather();
    return weather?.current && typeof weather.current.code === 'number' ? weatherKind(weather.current.code) : null;
  }
  function tick() {
    if (!runtime?.running) return;
    // RAF timestamps describe the frame and can predate the click that started
    // this program. Read the same monotonic clock used by start() instead.
    const result = runtime.step(performance.now(), cachedWeatherKind());
    workspace.highlightBlock(ids.get(result.activePath) || null);
    localPreviewRetained = true;
    onPreview({ ...result.state, running: result.running });
    if (result.running) animationFrame = requestAnimationFrame(tick);
    else {
      animationFrame = null;
      message('미리 실행이 끝났어요. 마지막 화면을 보여 주고 있어요. 키링에 저장하면 기기에서도 실행돼요.', 'success');
      controls();
    }
  }
  function run(program = null) {
    stopLocal();
    const compiled = compileWorkspace(workspace, $('program-loop').checked);
    ids = compiled.ids;
    runtime = new ProgramRuntime(program || compiled.program, initialState()).start(performance.now());
    localPreviewRetained = true;
    animationFrame = requestAnimationFrame(tick);
    message('미리보기에서 실행 중이에요. 빛나는 블록을 따라가 보세요. 실제 키링은 저장한 뒤 실행돼요.');
    controls();
  }
  $('program-run').addEventListener('click', () => { try { run(); } catch (error) { message(error.message, 'error'); } });
  async function stop({ localOnly = false } = {}) {
    stopLocal();
    const device = getDevice();
    if (device && !localOnly && (device.program || device.programRunning)) {
      try {
        const response = await api('program/control', { action: 'stop' });
        if (response.ok !== true) throw new Error('키링이 중지를 확인하지 못했어요.');
        device.programRunning = false;
        if (device.program) device.program.enabled = false;
      } catch (error) { message(`미리보기는 멈췄지만 키링 중지는 확인하지 못했어요. ${error.message}`, 'error'); controls(); return; }
    }
    message('실행을 멈췄어요. 캐릭터 꾸미기에 저장된 모습으로 돌아가요.'); controls();
  }
  $('program-stop').addEventListener('click', () => stop());
  $('program-save').addEventListener('click', async () => {
    if (!getDevice() || saving) return;
    if (getDevice().capabilities?.blockPrograms !== true) {
      message('블록을 키링에 저장하려면 새 펌웨어를 업로드해 주세요. 미리 실행과 코드 파일 저장은 지금도 사용할 수 있어요.', 'error');
      return;
    }
    let program;
    try { program = workspaceToProgram(workspace, $('program-loop').checked); }
    catch (error) { message(error.message, 'error'); return; }
    const revisionAtSave = revision;
    saving = true; controls(); message('프로그램을 키링에 저장하고 있어요…');
    try {
      const response = await api('program', program);
      if (response.ok !== true || response.saved !== true) throw new Error('프로그램 저장을 확인하지 못했어요.');
      const state = await api('state');
      if (!state.program || serializeProgram(state.program) !== serializeProgram(program)) throw new Error('키링에서 읽은 프로그램이 달라요. 다시 저장해 주세요.');
      const device = getDevice();
      if (device) { device.program = state.program; device.programRunning = state.programRunning; device.rendered = state.rendered; }
      savedDeviceProgram = serializeProgram(program); restoredDevice = true;
      if (revisionAtSave === revision) {
        dirty = false;
        run(program);
        message('키링에 프로그램을 저장하고 실행했어요. 전원을 껐다 켜도 다시 시작해요.', 'success');
      } else {
        dirty = true;
        message('요청한 프로그램은 키링에 저장됐어요. 저장하는 동안 새로 바꾼 블록은 아직 저장되지 않았어요.');
      }
    } catch (error) { message(`저장을 확인하지 못했어요. ${error.message}`, 'error'); }
    finally { saving = false; controls(); }
  });
  $('program-export').addEventListener('click', () => {
    try {
      const program = workspaceToProgram(workspace, $('program-loop').checked);
      const url = URL.createObjectURL(new Blob([JSON.stringify(program, null, 2)], { type: 'application/json' }));
      const link = document.createElement('a'); link.href = url; link.download = 'keyring-program.json'; document.body.append(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      message('프로그램 파일을 내보냈어요. 키링 Wi-Fi에서 이 파일을 불러와 저장할 수 있어요.', 'success');
    } catch (error) { message(error.message, 'error'); }
  });
  $('program-import').addEventListener('change', async (event) => {
    const file = event.target.files?.[0]; if (!file) return;
    try {
      if (file.size > 16000) throw new Error('프로그램 파일은 16KB 이하로 골라 주세요.');
      load(validateProgram(JSON.parse(await file.text())), true);
      message('프로그램 파일을 블록으로 불러왔어요. 미리 실행하거나 키링에 저장해 주세요.', 'success');
    } catch (error) { message(`파일을 불러오지 못했어요. ${error.message}`, 'error'); }
    finally { event.target.value = ''; }
  });
  $('program-reset').addEventListener('click', () => {
    if (dirty && !window.confirm('지금 편집한 블록을 지우고 처음 예제로 돌아갈까요? 파일로 내보내면 작품을 보관할 수 있어요.')) return;
    load(initial, true); message('처음 예제로 돌아왔어요. 키링에 저장된 프로그램은 아직 바뀌지 않았어요.');
  });
  function refreshDevice() {
    const device = getDevice();
    if (!device) { restoredDevice = false; legacyNoticeShown = false; controls(); return; }
    if (device.capabilities?.blockPrograms !== true) {
      if (!legacyNoticeShown && !runtime && !localPreviewRetained) message('블록을 키링에 저장하려면 새 펌웨어를 업로드해 주세요. 미리 실행과 코드 파일 저장은 지금도 사용할 수 있어요.');
      legacyNoticeShown = true;
      controls();
      return;
    }
    legacyNoticeShown = false;
    if (device.program && !restoredDevice && !dirty && !runtime && !localPreviewRetained) {
      try { load(device.program); savedDeviceProgram = serializeProgram(device.program); message('키링에 저장된 프로그램을 블록으로 불러왔어요.', 'success'); }
      catch (error) { message(`기기의 프로그램을 읽지 못했어요. ${error.message}`, 'error'); }
    }
    restoredDevice = true;
    if (!device.program && savedDeviceProgram && !dirty && !runtime && !localPreviewRetained) savedDeviceProgram = null;
    controls();
  }
  window.addEventListener('resize', () => Blockly.svgResize(workspace));
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(() => Blockly.svgResize(workspace)).observe(element);
  activeStudio = { workspace, refreshDevice, restoreProgram: (program) => load(program, false), stop, getProgram: () => workspaceToProgram(workspace, $('program-loop').checked), get dirty() { return dirty; } };
  refreshDevice();
  if (!getDevice()) message('블록을 끌어 연결해 보세요. 키링 없이도 미리 실행하고 파일로 내보낼 수 있어요.');
  return activeStudio;
}
