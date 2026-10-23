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
  const character = CHARACTERS.find(([value]) => value === selection.character)?.[1] || '토끼';
  const emotion = EMOTIONS.find(([value]) => value === selection.emotion)?.[2] || '행복한';
  text('preview-name', `${emotion} ${character}`);
  $('preview').setAttribute('aria-label', `${emotion} ${character}, 실제 OLED와 같은 128×64 픽셀 미리보기`);
  updateSaveControls();
  drawAll();
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
  selection[name] = value; phase = 0; updateControls();
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
  const frames = atlas.data[`${selection.character}:${selection.emotion}`];
  if (frames) drawFrame($('preview'), frames[phase % atlas.frames]);
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
    connected = false; device = null; showConnection();
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
  if (!localWeather) { badge.className = 'weather-badge neutral'; badge.textContent = '저장된 날씨 없음'; return; }
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
  const spriteRequest = fetch('/sprites.json').then((response) => { if (!response.ok) throw new Error('sprites'); return response.json(); }).then((data) => {
    if (data.width !== 128 || data.height !== 64 || data.frames !== 32 || !data.data) throw new Error('atlas');
    atlas = data; drawAll(); runAnimation();
  }).catch(() => { $('atlas-error').hidden = false; });
  await Promise.allSettled([spriteRequest, connect()]);
}
init();
setInterval(() => { if (!document.hidden && localWeather) renderWeather(); }, 60000);

document.addEventListener('visibilitychange', () => { if (!document.hidden && localWeather) renderWeather(); });
