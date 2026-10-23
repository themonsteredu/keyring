import { validateWeather, normalizeOpenMeteo, makeSample, weatherStatus, weatherKind, WEATHER_LABELS, kstTime } from './weather.mjs';

const CHARACTERS = [ ['rabbit', '토끼'], ['cat', '고양이'], ['bear', '곰'], ['turtle', '거북이'], ['monster', '몬스터'] ];
const EMOTIONS = [ ['happy', '행복', '행복한'], ['excited', '신남', '신나는'], ['sleepy', '졸림', '졸린'], ['sad', '슬픔', '슬픈'], ['angry', '화남', '화난'], ['love', '사랑', '사랑에 빠진'] ];
const CITIES = {
  seoul: { name: '서울', latitude: 37.5665, longitude: 126.978 },
  busan: { name: '부산', latitude: 35.1796, longitude: 129.0756 },
  incheon: { name: '인천', latitude: 37.4563, longitude: 126.7052 },
  daejeon: { name: '대전', latitude: 36.3504, longitude: 127.3845 },
  gwangju: { name: '광주', latitude: 35.1595, longitude: 126.8526 },
  daegu: { name: '대구', latitude: 35.8714, longitude: 128.6014 },
  jeju: { name: '제주', latitude: 33.4996, longitude: 126.5312 },
};
const $ = (id) => document.getElementById(id);
let selection = { character: 'rabbit', emotion: 'happy', view: 'character' };
let lastSaved = null;
let device = null;
let deviceClockReadAt = 0;
let connected = false;
let busy = false;
let weatherBusy = false;
let atlas = null;
let phase = 0;
let localWeather = null;
let weatherOnDevice = false;
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
let animate = !reducedMotion.matches;
const frameCache = new Map();
let animationTimer;
let activeTab = 'blocks';
let programPreview = null;
let blocksStudio = null;
let previewStartedAt = performance.now();

const sameSettings = (left, right) => left && right && ['character', 'emotion', 'view'].every((key) => left[key] === right[key]);
const text = (id, value) => { $(id).textContent = value; };
const setMessage = (id, value, error = false) => { text(id, value); $(id).classList.toggle('error', error); };
function saveMessage(value, kind = '') {
  text('save-state', value);
  $('save-state').className = `save-state ${kind}`;
  text('save-state-mobile', value);
  $('save-state-mobile').className = `save-state ${kind}`;
}

function createChoice(group, value, label, checked) {
  const wrapper = document.createElement('label'); wrapper.className = 'choice';
  const input = document.createElement('input'); input.type = 'radio'; input.name = group; input.value = value; input.checked = checked;
  const contents = document.createElement('span');
  const canvas = document.createElement('canvas'); canvas.width = 128; canvas.height = 64; canvas.setAttribute('aria-hidden', 'true'); canvas.dataset[group] = value;
  const title = document.createElement('strong'); title.textContent = label;
  contents.append(canvas, title); wrapper.append(input, contents);
  return wrapper;
}
for (const [value, label] of CHARACTERS) $('characters').append(createChoice('character', value, label, value === selection.character));
for (const [value, label] of EMOTIONS) $('emotions').append(createChoice('emotion', value, label, value === selection.emotion));

function updateControls() {
  for (const [name, value] of Object.entries(selection)) {
    document.querySelectorAll(`input[name="${name}"]`).forEach((input) => { input.checked = input.value === value; });
  }
  updatePreviewTitle();
  updateSaveControls();
  drawAll();
}

function displayedSettings() {
  if (activeTab === 'customize') return selection;
  if (activeTab === 'weather') return { ...selection, view: 'weather' };
  return programPreview || selection;
}
function updatePreviewTitle() {
  const shown = displayedSettings();
  const character = CHARACTERS.find(([value]) => value === shown.character)?.[1] || '토끼';
  const emotion = EMOTIONS.find(([value]) => value === shown.emotion)?.[2] || '행복한';
  const weatherView = shown.view === 'weather';
  text('preview-name', weatherView ? '우리 동네 날씨' : `${emotion} ${character}`);
  text('preview-caption', weatherView ? localWeather ? '저장된 예보를 보여 줘요' : '날씨 탭에서 예보를 담아 주세요' : '키링과 똑같은 픽셀로 보여요');
  $('preview').setAttribute('aria-label', weatherView ? '저장된 날씨 화면 미리보기' : `${emotion} ${character}, 실제 OLED와 같은 128×64 픽셀 미리보기`);
}
function activateTab(name, focus = false) {
  if (!['customize', 'blocks', 'weather'].includes(name)) return;
  activeTab = name; document.body.dataset.activeTab = name;
  for (const tab of document.querySelectorAll('[role="tab"]')) {
    const selected = tab.id === `tab-${name}`;
    tab.classList.toggle('active', selected); tab.setAttribute('aria-selected', String(selected)); tab.tabIndex = selected ? 0 : -1;
    $(tab.getAttribute('aria-controls')).hidden = !selected;
  }
  if (focus) $(`tab-${name}`).focus();
  updatePreviewTitle(); drawMain();
  window.dispatchEvent(new Event('resize'));
}
for (const [index, tab] of [...document.querySelectorAll('[role="tab"]')].entries()) {
  const names = ['customize', 'blocks', 'weather'];
  tab.addEventListener('click', () => activateTab(names[index]));
  tab.addEventListener('keydown', (event) => {
    let next = index;
    if (event.key === 'ArrowRight') next = (index + 1) % 3;
    else if (event.key === 'ArrowLeft') next = (index + 2) % 3;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = 2;
    else return;
    event.preventDefault(); activateTab(names[next], true);
  });
}
function showProgramPreview(state) {
  if (state.stopped) programPreview = null;
  else programPreview = { ...state };
  $('preview-run-dot').classList.toggle('running', !!state.running);
  text('preview-run-state', state.running ? '코드 실행 중 · 화면에서 먼저 확인해요' : state.stopped ? '실행을 멈췄어요. 다시 바꿔 볼까요?' : '실행 완료 · 마지막 모습을 보여 줘요');
  updatePreviewTitle(); drawMain();
}
function showProgramStatus(message, kind = '') {
  text('preview-run-state', message);
  $('preview-run-state').classList.toggle('error', kind === 'error');
}

function updateButtonLocks() {
  const locked = busy || weatherBusy;
  $('apply').disabled = !connected || locked || device?.storage === false || sameSettings(selection, lastSaved);
  $('apply-mobile').disabled = $('apply').disabled;
  $('reset').disabled = !connected || locked;
  $('sync-time').disabled = !connected || locked;
  $('fetch-weather').disabled = locked;
  $('sample-weather').disabled = locked;
  $('weather-file').disabled = locked;
}
function updateSaveControls() {
  updateButtonLocks();
  if (!connected) saveMessage('미리보기 모드 · 키링에 연결하면 저장할 수 있어요.');
  else if (device.storage === false) saveMessage('키링의 저장 공간을 열지 못했어요. 선생님께 알려 주세요.', 'error');
  else if (sameSettings(selection, lastSaved)) saveMessage('키링에 저장된 모습이에요.', 'success');
  else saveMessage('마음에 들면 적용하기를 눌러 저장해 주세요.');
}

document.querySelectorAll('fieldset').forEach((fieldset) => fieldset.addEventListener('change', (event) => {
  const { name, value } = event.target;
  if (!(name in selection)) return;
  blocksStudio?.stop({ localOnly: true });
  programPreview = null; selection[name] = value; phase = 0; updateControls();
}));

/** The same vertical-page buffer bytes that Adafruit SSD1306 sends to the OLED. */
function drawFrame(canvas, encoded, mini = false) {
  let buffer = frameCache.get(encoded);
  if (!buffer) {
    const binary = atob(encoded); buffer = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    if (buffer.length !== 1024) throw new Error('잘못된 OLED 프레임');
    frameCache.set(encoded, buffer);
  }
  const context = canvas.getContext('2d', { alpha: false });
  const image = context.createImageData(128, 64);
  const lit = mini ? [76, 107, 70] : [210, 236, 193];
  const dark = mini ? [247, 249, 239] : [18, 31, 29];
  for (let y = 0; y < 64; y += 1) for (let x = 0; x < 128; x += 1) {
    const color = buffer[x + (y >> 3) * 128] & (1 << (y & 7)) ? lit : dark;
    const offset = (y * 128 + x) * 4;
    image.data[offset] = color[0]; image.data[offset + 1] = color[1]; image.data[offset + 2] = color[2]; image.data[offset + 3] = 255;
  }
  context.putImageData(image, 0, 0);
}
function drawMain() {
  if (!atlas) return;
  const shown = displayedSettings();
  const cycle = (performance.now() - previewStartedAt) % 40000;
  if (shown.view === 'weather' || (shown.view === 'auto' && cycle >= 15000)) { drawWeatherScreen(); return; }
  const frames = atlas.data[`${shown.character}:${shown.emotion}`];
  if (frames) drawFrame($('preview'), frames[phase % atlas.frames]);
}

/**
 * Classic 5x7 font and integer drawing primitives adapted from Adafruit_GFX.
 * Copyright (c) 2012 Adafruit Industries. All rights reserved.
 * Redistribution and use in source and binary forms, with or without modification,
 * are permitted provided that source redistributions retain this notice, these
 * conditions and disclaimer; binary redistributions reproduce them in supporting
 * documentation and/or other materials.
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
 * AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
 * IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE
 * ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE
 * LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR
 * CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF
 * SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS
 * INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN
 * CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE)
 * ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE
 * POSSIBILITY OF SUCH DAMAGE.
 */
const OLED_FONT = Uint8Array.from(atob('AAAAAAAAAF8AAAAHAAcAFH8UfxQkKn8qEiMTCGRiNklWIFAACAcDAAAcIkEAAEEiHAAqHH8cKggIPggIAIBwMAAICAgICAAAYGAAIBAIBAI+UUlFPgBCf0AAcklJSUYhQUlNMxgUEn8QJ0VFRTk8SklJMUEhEQkHNklJSTZGSUkpHgAAFAAAAEA0AAAACBQiQRQUFBQUAEEiFAgCAVkJBj5BXVlOfBIREnx/SUlJNj5BQUEif0FBQT5/SUlJQX8JCQkBPkFBUXN/CAgIfwBBf0EAIEBBPwF/CBQiQX9AQEBAfwIcAn9/BAgQfz5BQUE+fwkJCQY+QVEhXn8JGSlGJklJSTIDAX8BAz9AQEA/HyBAIB8/QDhAP2MUCBRjAwR4BANhWUlNQwB/QUFBAgQIECAAQUFBfwQCAQIEQEBAQEAAAwcIACBUVHhAfyhERDg4REREKDhERCh/OFRUVBgACH4JAhikpJx4fwgEBHgARH1AACBAQD0AfxAoRAAAQX9AAHwEeAR4fAgEBHg4REREOPwYJCQYGCQkGPx8CAQECEhUVFQkBAQ/RCQ8QEAgfBwgQCAcPEAwQDxEKBAoREyQkJB8RGRUTEQACDZBAAAAdwAAAEE2CAACAQIEAjwmIyY8'), (character) => character.charCodeAt(0));
function drawWeatherScreen() {
  const context = $('preview').getContext('2d', { alpha: false });
  context.fillStyle = '#121f1d'; context.fillRect(0, 0, 128, 64); context.fillStyle = '#d2ecc1';
  const pixel = (x, y) => context.fillRect(Math.trunc(x), Math.trunc(y), 1, 1);
  const vertical = (x, y, height) => context.fillRect(x, y, 1, height);
  const horizontal = (x, y, width) => context.fillRect(x, y, width, 1);
  function words(value, x, y, size = 1) {
    for (const character of String(value)) {
      const code = character.charCodeAt(0) - 32;
      if (code >= 0 && code < 96) for (let column = 0; column < 5; column += 1) {
        const bits = OLED_FONT[code * 5 + column];
        for (let row = 0; row < 8; row += 1) if (bits & (1 << row)) context.fillRect(x + column * size, y + row * size, size, size);
      }
      x += 6 * size;
    }
  }
  function line(x0, y0, x1, y1) {
    x0 = Math.trunc(x0); y0 = Math.trunc(y0); x1 = Math.trunc(x1); y1 = Math.trunc(y1);
    const steep = Math.abs(y1 - y0) > Math.abs(x1 - x0);
    if (steep) { [x0, y0] = [y0, x0]; [x1, y1] = [y1, x1]; }
    if (x0 > x1) { [x0, x1] = [x1, x0]; [y0, y1] = [y1, y0]; }
    const dx = x1 - x0; const dy = Math.abs(y1 - y0); const step = y0 < y1 ? 1 : -1;
    let error = Math.trunc(dx / 2);
    for (; x0 <= x1; x0 += 1) { if (steep) pixel(y0, x0); else pixel(x0, y0); error -= dy; if (error < 0) { y0 += step; error += dx; } }
  }
  function circle(cx, cy, radius) {
    let f = 1 - radius; let dx = 1; let dy = -2 * radius; let x = 0; let y = radius;
    pixel(cx, cy + radius); pixel(cx, cy - radius); pixel(cx + radius, cy); pixel(cx - radius, cy);
    while (x < y) {
      if (f >= 0) { y -= 1; dy += 2; f += dy; } x += 1; dx += 2; f += dx;
      for (const [a, b] of [[x, y], [-x, y], [x, -y], [-x, -y], [y, x], [-y, x], [y, -x], [-y, -x]]) pixel(cx + a, cy + b);
    }
  }
  function fillHelper(cx, cy, radius, corners, delta) {
    let f = 1 - radius; let dx = 1; let dy = -2 * radius; let x = 0; let y = radius; let px = 0; let py = y;
    delta += 1;
    while (x < y) {
      if (f >= 0) { y -= 1; dy += 2; f += dy; } x += 1; dx += 2; f += dx;
      if (x < y + 1) { if (corners & 1) vertical(cx + x, cy - y, 2 * y + delta); if (corners & 2) vertical(cx - x, cy - y, 2 * y + delta); }
      if (y !== py) { if (corners & 1) vertical(cx + py, cy - px, 2 * px + delta); if (corners & 2) vertical(cx - py, cy - px, 2 * px + delta); py = y; } px = x;
    }
  }
  function filledCircle(x, y, radius) { vertical(x, y - radius, radius * 2 + 1); fillHelper(x, y, radius, 3, 0); }
  function roundRect(x, y, width, height, radius) { context.fillRect(x + radius, y, width - 2 * radius, height); fillHelper(x + width - radius - 1, y + radius, radius, 1, height - 2 * radius - 1); fillHelper(x + radius, y + radius, radius, 2, height - 2 * radius - 1); }
  function weatherIcon(x, y, code, small) {
    const kind = [95, 96, 99].includes(code) ? 'storm' : [45, 48].includes(code) ? 'fog' : weatherKind(code);
    const radius = small ? 3 : 8; const cx = x + (small ? 5 : 14); const cy = y + (small ? 5 : 14);
    if (kind === 'sun') {
      circle(cx, cy, radius);
      for (let index = 0; index < 8; index += 1) { const angle = Math.fround(index * Math.fround(Math.PI) / 4); line(cx + Math.fround(Math.cos(angle)) * (radius + 2), cy + Math.fround(Math.sin(angle)) * (radius + 2), cx + Math.fround(Math.cos(angle)) * (radius + 4), cy + Math.fround(Math.sin(angle)) * (radius + 4)); }
      return;
    }
    const width = small ? 10 : 29; const height = small ? 5 : 12; const bottom = y + (small ? 9 : 23);
    roundRect(x, y + (small ? 2 : 5), width, height, small ? 2 : 5);
    filledCircle(x + Math.trunc(width / 3), y + (small ? 3 : 7), small ? 3 : 7);
    filledCircle(x + Math.trunc(2 * width / 3), y + (small ? 2 : 4), small ? 2 : 6);
    if (kind === 'rain') { line(x + 2, bottom, x, bottom + (small ? 2 : 5)); line(x + Math.trunc(width / 2), bottom, x + Math.trunc(width / 2) - 2, bottom + (small ? 2 : 5)); line(x + width - 2, bottom, x + width - 4, bottom + (small ? 2 : 5)); }
    else if (kind === 'snow') { horizontal(x + Math.trunc(width / 2) - 2, bottom + 1, 5); vertical(x + Math.trunc(width / 2), bottom - 1, 5); if (!small) { line(x + Math.trunc(width / 2) - 2, bottom - 1, x + Math.trunc(width / 2) + 2, bottom + 3); line(x + Math.trunc(width / 2) + 2, bottom - 1, x + Math.trunc(width / 2) - 2, bottom + 3); } }
    else if (kind === 'storm') { line(x + Math.trunc(width / 2) + 2, bottom - 2, x + Math.trunc(width / 2) - 2, bottom + 2); line(x + Math.trunc(width / 2) - 2, bottom + 2, x + Math.trunc(width / 2) + 2, bottom + 2); line(x + Math.trunc(width / 2) + 2, bottom + 2, x + Math.trunc(width / 2) - 2, bottom + 6); }
    else if (kind === 'fog') { horizontal(x, bottom, width); horizontal(x + 2, bottom + 3, width - 4); }
  }
  const clock = weatherOnDevice ? { trusted: device?.clock?.trusted, now: typeof device?.clock?.now === 'number' ? device.clock.now + Math.floor((performance.now() - deviceClockReadAt) / 1000) : null } : { trusted: true, now: Math.floor(Date.now() / 1000) };
  const status = weatherStatus(localWeather, clock.trusted, clock.now);
  words({ missing: 'NO WEATHER', sample: 'SAMPLE', 'clock-unknown': 'TIME UNKNOWN', stale: 'OLD FORECAST', fresh: 'SYNCED' }[status], 0, 0);
  if (!localWeather) { words('Connect phone Wi-Fi', 0, 22); words('192.168.4.1', 0, 34); words('Import weather JSON', 0, 48); return; }
  const elapsed = performance.now() - previewStartedAt; const cycle = elapsed % 40000; const shown = displayedSettings();
  const page = shown.view === 'auto' && cycle >= 15000 ? Math.floor((cycle - 15000) / 5000) : Math.floor(elapsed / 5000) % 5;
  const parts = (epoch) => { const date = new Date((epoch + 9 * 3600) * 1000); const pad = (value) => String(value).padStart(2, '0'); return { year: pad(date.getUTCFullYear() % 100), month: pad(date.getUTCMonth() + 1), day: pad(date.getUTCDate()), hour: pad(date.getUTCHours()), minute: pad(date.getUTCMinutes()) }; };
  const received = parts(localWeather.fetchedAt); words(page ? `${page}/4` : 'NOW', 104, 0); words(`UPD${received.year}/${received.month}/${received.day} ${received.hour}:${received.minute}K`, 0, 10);
  if (!page) { weatherIcon(4, 26, localWeather.current.code, false); words(`${Math.fround(localWeather.current.temperature).toFixed(1)}C`, 43, 28, 2); const current = parts(localWeather.current.time); words(`AT ${current.month}/${current.day} ${current.hour}:${current.minute} KST`, 0, 55); }
  else localWeather.hourly.slice((page - 1) * 6, page * 6).forEach((point, index) => { const x = index % 2 * 64; const y = 22 + Math.floor(index / 2) * 14; words(parts(point.time).hour, x, y); words(`${point.temperature < 0 ? -Math.round(-point.temperature) : Math.round(point.temperature)}C`, x + 14, y); weatherIcon(x + 48, y - 1, point.code, true); });
}

function drawAll() {
  if (!atlas) return;
  drawMain();
  document.querySelectorAll('canvas[data-character]').forEach((canvas) => drawFrame(canvas, atlas.data[`${canvas.dataset.character}:${selection.emotion}`][0], true));
  document.querySelectorAll('canvas[data-emotion]').forEach((canvas) => drawFrame(canvas, atlas.data[`${selection.character}:${canvas.dataset.emotion}`][0], true));
}
function updateAnimationButton() {
  $('animation-toggle').setAttribute('aria-pressed', String(animate));
  $('animation-toggle').setAttribute('aria-label', animate ? '애니메이션 멈추기' : '애니메이션 재생하기');
  text('animation-label', animate ? '멈춤' : '재생');
  // These are fixed SVG paths, never imported or user-supplied text.
  $('pause-icon').innerHTML = animate ? '<path d="M8 6v12M16 6v12"/>' : '<path d="m8 5 11 7-11 7Z"/>';
}
function runAnimation() {
  clearTimeout(animationTimer);
  if (!document.hidden && animate && atlas) { phase = (phase + 1) % atlas.frames; drawMain(); }
  animationTimer = setTimeout(runAnimation, atlas?.frameMs || 160);
}
$('animation-toggle').addEventListener('click', () => { animate = !animate; updateAnimationButton(); });
reducedMotion.addEventListener('change', (event) => { if (event.matches) { animate = false; updateAnimationButton(); } });

async function api(path, payload) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 9000);
  try {
    const response = await fetch(`/api/${path}`, { method: payload === undefined ? 'GET' : 'POST', headers: payload === undefined ? {} : { 'Content-Type': 'application/json' }, body: payload === undefined ? undefined : JSON.stringify(payload), cache: 'no-store', signal: controller.signal });
    if (!response.ok) {
      let message = `키링 응답 오류 (${response.status})`;
      try { const error = await response.json(); if (typeof error.error === 'string') message = error.error; } catch { /* A development static server can send an HTML 404. */ }
      if (path.startsWith('program') && response.status === 404) message = '블록 코딩을 쓰려면 키링 업데이트가 필요해요. 선생님께 최신 펌웨어 업로드를 부탁해 주세요.';
      throw new Error(message);
    }
    return await response.json();
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('키링 응답을 기다리다 시간이 지났어요. Wi-Fi 연결을 확인해 주세요.');
    throw error;
  } finally { clearTimeout(timeout); }
}
function validState(state) {
  return state && CHARACTERS.some(([value]) => value === state.character) && EMOTIONS.some(([value]) => value === state.emotion) && ['character', 'weather', 'auto'].includes(state.view) && state.clock && typeof state.clock.trusted === 'boolean';
}
function showConnection() {
  $('connection').classList.toggle('connected', connected);
  text('connection-text', !connected ? '미리보기 모드' : device.simulated ? '개발용 모의 기기' : '내 키링 연결됨');
  $('offline-note').hidden = connected;
  $('oled-note').hidden = !connected || device.oled !== false;
  let simulationNote = $('simulation-note');
  if (connected && device.simulated && !simulationNote) {
    simulationNote = document.createElement('div'); simulationNote.id = 'simulation-note'; simulationNote.className = 'notice warning';
    const paragraph = document.createElement('p'); paragraph.textContent = '개발용 모의 기기 · 실제 키링이 아니에요. 설정과 저장 결과는 이 개발 서버에서만 확인돼요.'; simulationNote.append(paragraph);
    $('offline-note').after(simulationNote);
  }
  if (simulationNote) simulationNote.hidden = !connected || !device.simulated;
  updateSaveControls();
}
async function readState(adoptSettings = false) {
  const state = await api('state');
  if (!validState(state)) throw new Error('키링 설정 응답을 읽지 못했어요.');
  device = state; deviceClockReadAt = performance.now(); connected = true;
  lastSaved = { character: state.character, emotion: state.emotion, view: state.view };
  if (adoptSettings) selection = { ...lastSaved };
  showConnection(); updateControls();
  if (state.weather) {
    localWeather = validateWeather(state.weather); weatherOnDevice = true;
  } else { localWeather = null; weatherOnDevice = false; }
  renderWeather();
  blocksStudio?.refreshDevice();
}
async function connect() {
  text('connection-text', '키링 확인 중');
  try {
    await readState(true);
    try {
      await api('time', { epoch: Math.floor(Date.now() / 1000) });
      await readState(false);
      if (device.weather && device.weather.source !== 'sample') setMessage('weather-action-state', '휴대폰 시각으로 키링의 시계를 맞췄어요. 예보의 오래된 정도를 확인할 수 있어요.');
    } catch {
      setMessage('weather-action-state', '키링은 연결됐지만 시각을 맞추지 못했어요. 휴대폰 날짜를 확인하고 시각 맞추기를 눌러 주세요.', true);
    }
  } catch {
    connected = false; device = null; showConnection(); blocksStudio?.refreshDevice();
  }
}
$('reconnect').addEventListener('click', connect);
$('apply-mobile').addEventListener('click', () => $('apply').click());
$('apply').addEventListener('click', async () => {
  if (!connected || busy || weatherBusy) return;
  busy = true; updateSaveControls(); saveMessage('키링에 저장하고 있어요…');
  const requested = { ...selection };
  try {
    const response = await api('settings', requested);
    if (response.ok !== true) throw new Error('저장이 확인되지 않았어요.');
    await readState(false);
    if (!sameSettings(lastSaved, requested)) throw new Error('저장된 값이 달라요. 다시 적용해 주세요.');
    saveMessage('저장 완료! 전원을 껐다 켜도 그대로예요.', 'success');
  } catch (error) { saveMessage(`저장하지 못했어요. ${error.message}`, 'error'); }
  finally { busy = false; updateButtonLocks(); }
});
$('reset').addEventListener('click', () => $('reset-dialog').showModal());
$('reset-dialog').addEventListener('close', async () => {
  if ($('reset-dialog').returnValue !== 'reset' || !connected || busy || weatherBusy) return;
  busy = true; updateSaveControls();
  try {
    const response = await api('reset', {});
    if (response.ok !== true) throw new Error('초기화가 확인되지 않았어요.');
    await readState(true); saveMessage('행복한 토끼로 다시 시작해요. 저장된 날씨도 지웠어요.', 'success');
    setMessage('weather-action-state', '저장된 날씨를 지웠어요. 새 날씨를 담을 수 있어요.');
  } catch (error) { saveMessage(`초기화하지 못했어요. ${error.message}`, 'error'); }
  finally { busy = false; updateButtonLocks(); }
});

const ICON_PATHS = {
  sun: '<circle cx="24" cy="24" r="8"/><path d="M24 4v5m0 30v5M4 24h5m30 0h5M10 10l4 4m20 20 4 4m0-28-4 4M14 34l-4 4"/>',
  cloud: '<path d="M13 35a9 9 0 0 1-1-18 12 12 0 0 1 23-1 10 10 0 1 1 1 19Z"/>',
  rain: '<path d="M12 29a7 7 0 0 1 0-14 10 10 0 0 1 19-2 8 8 0 1 1 4 16Z"/><path d="m16 35-3 6m13-6-3 6m13-6-3 6"/>',
  snow: '<path d="M12 27a7 7 0 0 1 0-14 10 10 0 0 1 19-2 8 8 0 1 1 4 16Z"/><path d="M17 33v10m-4-8 8 6m0-6-8 6m21-8v10m-4-8 8 6m0-6-8 6"/>',
};
function icon(container, kind) {
  container.innerHTML = `<svg viewBox="0 0 48 48" aria-hidden="true">${ICON_PATHS[kind] || ICON_PATHS.cloud}</svg>`;
}
function renderWeather() {
  $('weather-content').hidden = !localWeather;
  $('download-weather').disabled = !localWeather;
  const badge = $('weather-badge');
  if (!localWeather) { badge.className = 'weather-badge neutral'; badge.textContent = '저장된 날씨 없음'; updatePreviewTitle(); drawMain(); return; }
  const clock = weatherOnDevice ? { trusted: device?.clock?.trusted, now: typeof device?.clock?.now === 'number' ? device.clock.now + Math.floor((performance.now() - deviceClockReadAt) / 1000) : null } : { trusted: true, now: Math.floor(Date.now() / 1000) };
  const status = weatherStatus(localWeather, clock?.trusted, clock?.now);
  const badgeText = { sample: '연습용 · 실제 날씨 아님', 'clock-unknown': '시각 확인 필요', stale: '오래된 예보', fresh: weatherOnDevice ? '키링에 저장됨' : '휴대폰에서 미리보기' }[status];
  badge.textContent = badgeText;
  badge.className = `weather-badge ${status === 'sample' ? 'sample' : status === 'fresh' ? '' : 'warning'}`;
  const kind = weatherKind(localWeather.current.code);
  icon($('current-icon'), kind);
  text('weather-location', localWeather.location.name);
  text('temperature', `${Math.round(localWeather.current.temperature * 10) / 10}°`);
  text('weather-description', WEATHER_LABELS[kind]);
  text('weather-source', localWeather.source === 'sample' ? '출처: 수업용 샘플 데이터' : '출처: Open-Meteo · 모델 기반');
  text('weather-updated', `받은 시각 ${kstTime(localWeather.fetchedAt, true)} (한국)`);
  text('weather-current-time', `현재 날씨 기준 ${kstTime(localWeather.current.time, true)}`);
  const warnings = {
    sample: '연습용으로 만든 예보예요. 실제 현재 날씨나 실제 예보가 아니에요.',
    'clock-unknown': '전원이 꺼진 뒤 키링은 현재 시각을 몰라요. 저장된 예보이며, 최신인지 확인할 수 없어요. 휴대폰 날짜를 확인하고 시각 맞추기를 눌러 주세요.',
    stale: '받은 지 3시간이 지났거나 예보 범위를 벗어났어요. 저장된 과거 자료이므로 지금 날씨로 생각하지 말고 새 예보를 받아 주세요.',
    fresh: weatherOnDevice ? '최근에 받은 예보예요. 인터넷이 끊겨도 볼 수 있지만, 시간이 지나면 오래된 예보라고 표시돼요.' : '아직 키링에 저장되지 않았어요. 날씨 파일을 내려받은 뒤 키링에 연결해서 불러와 주세요.',
  };
  text('weather-warning', warnings[status]);
  $('weather-warning').classList.toggle('fresh', status === 'fresh');
  const forecast = $('forecast'); forecast.replaceChildren();
  localWeather.hourly.forEach((point) => {
    const item = document.createElement('li');
    const time = document.createElement('time'); time.dateTime = new Date(point.time * 1000).toISOString(); time.textContent = kstTime(point.time);
    const glyph = document.createElement('span'); glyph.className = 'weather-icon'; glyph.setAttribute('role', 'img'); glyph.setAttribute('aria-label', WEATHER_LABELS[weatherKind(point.code)]); icon(glyph, weatherKind(point.code));
    const temperature = document.createElement('strong'); temperature.textContent = `${Math.round(point.temperature)}°`;
    item.append(time, glyph, temperature); forecast.append(item);
  });
  updatePreviewTitle(); drawMain();
}
async function storeWeather(weather) {
  localWeather = validateWeather(weather); weatherOnDevice = false; renderWeather();
  if (!connected) { setMessage('weather-action-state', '날씨를 준비했어요. 파일을 내려받고 키링에 연결한 뒤 불러와 주세요.'); return; }
  try {
    const timeResponse = await api('time', { epoch: Math.floor(Date.now() / 1000) });
    if (timeResponse.ok !== true) throw new Error('키링 시각을 맞추지 못했어요.');
    const response = await api('weather', localWeather);
    if (response.ok !== true) throw new Error('저장이 확인되지 않았어요.');
    await readState(false);
    setMessage('weather-action-state', device.simulated ? '개발용 모의 기기에 저장했어요. 실제 키링에는 적용되지 않아요.' : '날씨를 키링에 저장했어요. 인터넷이 끊겨도 이 예보를 볼 수 있어요.');
  } catch (error) {
    weatherOnDevice = false; renderWeather();
    setMessage('weather-action-state', `날씨는 준비했지만 키링에 저장하지 못했어요. ${error.message} 파일로 보관해 다시 불러와 주세요.`, true);
  }
}
$('fetch-weather').addEventListener('click', async () => {
  if (busy || weatherBusy) return;
  weatherBusy = true; updateButtonLocks(); setMessage('weather-action-state', 'Open-Meteo에서 실제 날씨를 받고 있어요…');
  const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), 12000);
  try {
    const location = CITIES[$('city').value];
    const params = new URLSearchParams({ latitude: String(location.latitude), longitude: String(location.longitude), current: 'temperature_2m,weather_code', hourly: 'temperature_2m,weather_code', forecast_days: '2', timeformat: 'unixtime', timezone: 'GMT', temperature_unit: 'celsius' });
    const response = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`, { signal: controller.signal });
    if (!response.ok) throw new Error(`날씨 서비스 응답 ${response.status}`);
    const normalized = normalizeOpenMeteo(await response.json(), location);
    await storeWeather(normalized);
  } catch (error) {
    setMessage('weather-action-state', `날씨를 받지 못했어요. 키링 Wi-Fi에는 인터넷이 없을 수 있어요. 인터넷 연결 상태에서 미리 받은 날씨 파일을 불러와 주세요. (${error.name === 'AbortError' ? '응답 시간 초과' : error.message})`, true);
  } finally { clearTimeout(timeout); weatherBusy = false; updateButtonLocks(); }
});
$('download-weather').addEventListener('click', () => {
  if (!localWeather) return;
  const blob = new Blob([JSON.stringify(localWeather, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url;
  link.download = `keyring-${localWeather.source === 'sample' ? 'SAMPLE' : 'weather'}-${new Date(localWeather.fetchedAt * 1000).toISOString().slice(0, 10)}.json`;
  document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 2000);
  setMessage('weather-action-state', '날씨 파일을 내려받았어요. 키링 Wi-Fi에 연결한 뒤 이 파일을 불러와 주세요.');
});
$('weather-file').addEventListener('change', async (event) => {
  const file = event.target.files?.[0]; if (!file || busy || weatherBusy) return;
  weatherBusy = true; updateButtonLocks();
  try {
    if (file.size > 10000) throw new Error('파일이 너무 커요. 10KB 이하의 키링 날씨 파일을 골라 주세요.');
    const weather = validateWeather(JSON.parse(await file.text()));
    setMessage('weather-action-state', '날씨 파일을 확인했어요. 키링에 저장하고 있어요…');
    await storeWeather(weather);
  } catch (error) { setMessage('weather-action-state', `파일을 읽지 못했어요. ${error.message}`, true); }
  finally { event.target.value = ''; weatherBusy = false; updateButtonLocks(); }
});
$('sample-weather').addEventListener('click', async () => {
  if (busy || weatherBusy) return;
  weatherBusy = true; updateButtonLocks();
  setMessage('weather-action-state', '연습용 날씨를 준비하고 있어요. 실제 날씨가 아니에요.');
  try {
    await storeWeather(makeSample());
    if (weatherOnDevice) setMessage('weather-action-state', device.simulated ? '개발용 모의 기기에 저장했어요. 연습용 샘플이며 실제 키링이나 실제 날씨가 아니에요.' : '연습용 샘플을 저장했어요. 실제 날씨와 예보가 아니에요.');
  } finally { weatherBusy = false; updateButtonLocks(); }
});
$('sync-time').addEventListener('click', async () => {
  if (!connected || busy || weatherBusy) return;
  busy = true; updateButtonLocks();
  try {
    const response = await api('time', { epoch: Math.floor(Date.now() / 1000) });
    if (response.ok !== true) throw new Error('시각 맞추기가 확인되지 않았어요.');
    await readState(false); setMessage('weather-action-state', '휴대폰 시각으로 키링 시계를 맞췄어요. 오래된 예보는 새로 받아 주세요.');
  } catch (error) { setMessage('weather-action-state', `시각을 맞추지 못했어요. ${error.message}`, true); }
  finally { busy = false; updateButtonLocks(); }
});

async function init() {
  updateAnimationButton(); updateControls();
  try {
    const { initializeBlocks } = await import('./blocks-editor.mjs');
    blocksStudio = await initializeBlocks({ getDevice: () => connected ? device : null, getWeather: () => localWeather, api, onPreview: showProgramPreview, onStatus: showProgramStatus });
  } catch (error) {
    text('program-status', `코딩 도구를 불러오지 못했어요. 새로고침해 주세요. (${error.message})`);
    $('program-status').classList.add('error');
    $('program-run').disabled = true;
  }
  const spriteRequest = fetch('/sprites.json').then((response) => { if (!response.ok) throw new Error('sprites'); return response.json(); }).then((data) => {
    if (data.width !== 128 || data.height !== 64 || data.frames !== 32 || !data.data) throw new Error('atlas');
    atlas = data; drawAll(); runAnimation();
  }).catch(() => { $('atlas-error').hidden = false; });
  await Promise.allSettled([spriteRequest, connect()]);
}
init();
setInterval(() => { if (!document.hidden && localWeather) renderWeather(); }, 60000);

document.addEventListener('visibilitychange', () => { if (!document.hidden && localWeather) renderWeather(); });
