import { renderWeatherFrame } from './oled-weather.mjs';
import { validateWeather, normalizeOpenMeteo, makeSample, weatherStatus, weatherKind, WEATHER_LABELS, kstTime } from './weather.mjs';

// Keep the saved device IDs compatible; each now selects eyes, never a body.
const CHARACTERS = [ ['rabbit', '말랑눈'], ['cat', '초롱눈'], ['bear', '웃음눈'], ['turtle', '콩알눈'], ['monster', '네모눈'] ];
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
// Match the firmware's roundf for negative half-degrees as well.
const roundTemperature = (value) => value < 0 ? -Math.round(-value) : Math.round(value);
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
let activeTab = 'customize';
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
  const character = CHARACTERS.find(([value]) => value === shown.character)?.[1] || '말랑눈';
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
  $('preview-run-dot').classList.toggle('running', name === 'blocks' && !!programPreview?.running);
  text('preview-run-state', name === 'customize' ? '표정 미리보기' : name === 'weather' ? '날씨 미리보기' : $('program-status').textContent);
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
  if (activeTab === 'blocks') {
    $('preview-run-dot').classList.toggle('running', !!state.running);
    text('preview-run-state', state.running ? '코드 실행 중 · 화면에서 먼저 확인해요' : state.stopped ? '실행을 멈췄어요. 다시 바꿔 볼까요?' : '실행 완료 · 마지막 모습을 보여 줘요');
  }
  updatePreviewTitle(); drawMain();
}
function showProgramStatus(message, kind = '') {
  if (activeTab !== 'blocks') return;
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
  if (!connected) saveMessage('키링 연결 후 저장할 수 있어요.');
  else if (device.storage === false) saveMessage('키링의 저장 공간을 열지 못했어요. 선생님께 알려 주세요.', 'error');
  else if (sameSettings(selection, lastSaved)) saveMessage('저장됨', 'success');
  else saveMessage('');
}

document.querySelectorAll('fieldset').forEach((fieldset) => fieldset.addEventListener('change', (event) => {
  const { name, value } = event.target;
  if (!(name in selection)) return;
  blocksStudio?.stop({ localOnly: true });
  programPreview = null; selection[name] = value; phase = 0; updateControls();
  $('display-hint').hidden = !!localWeather || selection.view === 'character';
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
  const lit = [255, 255, 255];
  const dark = [5, 11, 18];
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
  const cycle = (performance.now() - previewStartedAt) % 24000;
  if (shown.view === 'weather' || (shown.view === 'auto' && cycle >= 12000)) { drawWeatherScreen(); return; }
  const frames = atlas.data[`${shown.character}:${shown.emotion}`];
  if (frames) drawFrame($('preview'), frames[phase % atlas.frames]);
}

function drawWeatherScreen() {
  const clock = weatherOnDevice ? { trusted: device?.clock?.trusted, now: typeof device?.clock?.now === 'number' ? device.clock.now + Math.floor((performance.now() - deviceClockReadAt) / 1000) : null } : { trusted: true, now: Math.floor(Date.now() / 1000) };
  const status = weatherStatus(localWeather, clock.trusted, clock.now);
  const elapsed = performance.now() - previewStartedAt;
  const cycle = elapsed % 24000;
  const shown = displayedSettings();
  const page = shown.view === 'auto' ? (cycle >= 20000 ? 1 + Math.floor(elapsed / 24000) % 24 : 0) : (elapsed % 12000 >= 8000 ? 1 + Math.floor(elapsed / 12000) % 24 : 0);
  const buffer = renderWeatherFrame({ weather: localWeather, status, page, phase });
  drawFrame($('preview'), btoa(String.fromCharCode(...buffer)));
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
      try {
        const error = await response.json();
        const messages = {
          storage_write_failed: '키링에 저장하지 못했어요. 전원을 확인하고 다시 시도해 주세요.',
          invalid_weather: '날씨 파일을 읽지 못했어요. 키링용 날씨 파일을 다시 골라 주세요.',
          weather_from_future: '날씨를 받은 시각이 미래로 되어 있어요. 휴대폰 날짜와 시간을 확인해 주세요.',
          invalid_time: '휴대폰 날짜와 시간을 확인해 주세요.',
          invalid_settings: '눈 모양과 표정을 다시 골라 주세요.',
          invalid_program: '블록을 확인하고 다시 저장해 주세요.',
          body_too_large: '파일이 너무 커요. 작은 키링 파일을 골라 주세요.',
        };
        if (messages[error.error]) message = messages[error.error];
      } catch { /* A development static server can send an HTML 404. */ }
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
      if (device.weather && device.weather.source !== 'sample') setMessage('weather-action-state', '');
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
    saveMessage('저장 완료', 'success');
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
    await readState(true); saveMessage('행복한 말랑눈으로 다시 시작해요. 저장된 날씨도 지웠어요.', 'success');
    setMessage('weather-action-state', '저장된 날씨를 지웠어요. 새 날씨를 담을 수 있어요.');
  } catch (error) { saveMessage(`초기화하지 못했어요. ${error.message}`, 'error'); }
  finally { busy = false; updateButtonLocks(); }
});

const ICON_PATHS = {
  sun: '<circle cx="24" cy="24" r="12" fill="#ffe180"/><path d="M24 3v4m0 34v4M3 24h4m34 0h4M9 9l3 3m24 24 3 3m0-30-3 3M12 36l-3 3"/><g fill="currentColor" stroke="none"><circle cx="20" cy="23" r="1.5"/><circle cx="28" cy="23" r="1.5"/></g><path d="M20 28q4 5 8 0"/>',
  cloud: '<path d="M13 35a9 9 0 0 1-1-18 12 12 0 0 1 23-1 10 10 0 1 1 1 19Z" fill="#e9efff"/><g fill="currentColor" stroke="none"><circle cx="19" cy="25" r="1.5"/><circle cx="29" cy="25" r="1.5"/></g><path d="M20 29q4 4 8 0"/>',
  rain: '<path d="M12 29a7 7 0 0 1 0-14 10 10 0 0 1 19-2 8 8 0 1 1 4 16Z" fill="#e9efff"/><g fill="currentColor" stroke="none"><circle cx="19" cy="20" r="1.5"/><circle cx="28" cy="20" r="1.5"/></g><path d="M20 24q3.5 3 7 0m-12 10-2 6m13-6-2 6m13-6-2 6"/>',
  snow: '<path d="M12 27a7 7 0 0 1 0-14 10 10 0 0 1 19-2 8 8 0 1 1 4 16Z" fill="#e9efff"/><g fill="currentColor" stroke="none"><circle cx="19" cy="18" r="1.5"/><circle cx="28" cy="18" r="1.5"/></g><path d="M20 22q3.5 3 7 0M17 33v10m-4-8 8 6m0-6-8 6m21-8v10m-4-8 8 6m0-6-8 6"/>',
};
function icon(container, kind) {
  container.innerHTML = `<svg viewBox="0 0 48 48" aria-hidden="true">${ICON_PATHS[kind] || ICON_PATHS.cloud}</svg>`;
}
function renderWeather() {
  $('weather-content').hidden = !localWeather;
  $('weather-empty').hidden = !!localWeather;
  $('display-hint').hidden = !!localWeather || selection.view === 'character';
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
  text('temperature', `${roundTemperature(localWeather.current.temperature)}°`);
  text('humidity', Number.isInteger(localWeather.current.humidity) ? `${localWeather.current.humidity}%` : '--%');
  $('humidity').setAttribute('aria-label', Number.isInteger(localWeather.current.humidity) ? `습도 ${localWeather.current.humidity}%` : '습도 정보 없음');
  text('weather-description', WEATHER_LABELS[kind]);
  text('weather-source', localWeather.source === 'sample' ? '출처: 수업용 샘플 데이터' : '출처: Open-Meteo · 모델 기반');
  text('weather-updated', `받은 시각 ${kstTime(localWeather.fetchedAt, true)} (한국)`);
  text('weather-current-time', `현재 날씨 기준 ${kstTime(localWeather.current.time, true)}`);
  const warnings = {
    sample: '',
    'clock-unknown': '최신인지 확인할 수 없어요. 시각을 맞춰 주세요.',
    stale: '새 날씨를 받아 주세요.',
    fresh: '',
  };
  text('weather-warning', warnings[status]);
  $('weather-warning').hidden = !warnings[status];
  $('weather-warning').classList.toggle('fresh', status === 'fresh');
  const forecast = $('forecast'); forecast.replaceChildren();
  localWeather.hourly.forEach((point) => {
    const item = document.createElement('li');
    const time = document.createElement('time'); time.dateTime = new Date(point.time * 1000).toISOString(); time.textContent = kstTime(point.time);
    const glyph = document.createElement('span'); glyph.className = 'weather-icon'; glyph.setAttribute('role', 'img'); glyph.setAttribute('aria-label', WEATHER_LABELS[weatherKind(point.code)]); icon(glyph, weatherKind(point.code));
    const temperature = document.createElement('strong'); temperature.textContent = `${roundTemperature(point.temperature)}°`;
    const humidity = document.createElement('span'); humidity.className = 'forecast-humidity'; humidity.textContent = Number.isInteger(point.humidity) ? `${point.humidity}%` : '--%';
    humidity.setAttribute('aria-label', Number.isInteger(point.humidity) ? `습도 ${point.humidity}%` : '습도 정보 없음');
    item.append(time, glyph, temperature, humidity); forecast.append(item);
  });
  updatePreviewTitle(); drawMain();
}
async function storeWeather(weather) {
  localWeather = validateWeather(weather); weatherOnDevice = false; renderWeather();
  if (!connected) { setMessage('weather-action-state', '키링으로 옮기려면 파일을 저장해 주세요.'); return; }
  try {
    const timeResponse = await api('time', { epoch: Math.floor(Date.now() / 1000) });
    if (timeResponse.ok !== true) throw new Error('키링 시각을 맞추지 못했어요.');
    const response = await api('weather', localWeather);
    if (response.ok !== true) throw new Error('저장이 확인되지 않았어요.');
    await readState(false);
    setMessage('weather-action-state', device.simulated ? '개발용 모의 기기에 저장했어요. 실제 키링에는 적용되지 않아요.' : '날씨 저장 완료');
  } catch (error) {
    weatherOnDevice = false; renderWeather();
    setMessage('weather-action-state', `날씨는 준비했지만 키링에 저장하지 못했어요. ${error.message} 파일로 보관해 다시 불러와 주세요.`, true);
  }
}
$('fetch-weather').addEventListener('click', async () => {
  if (busy || weatherBusy) return;
  weatherBusy = true; updateButtonLocks(); setMessage('weather-action-state', '날씨를 받고 있어요…');
  const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), 12000);
  try {
    const location = CITIES[$('city').value];
    const params = new URLSearchParams({ latitude: String(location.latitude), longitude: String(location.longitude), current: 'temperature_2m,relative_humidity_2m,weather_code', hourly: 'temperature_2m,relative_humidity_2m,weather_code', forecast_days: '2', timeformat: 'unixtime', timezone: 'GMT', temperature_unit: 'celsius' });
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
  setMessage('weather-action-state', '파일 저장 완료');
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
    if (weatherOnDevice) setMessage('weather-action-state', device.simulated ? '개발용 모의 기기에 저장했어요. 연습용 샘플이며 실제 키링이나 실제 날씨가 아니에요.' : '연습용 날씨 저장 완료');
  } finally { weatherBusy = false; updateButtonLocks(); }
});
$('sync-time').addEventListener('click', async () => {
  if (!connected || busy || weatherBusy) return;
  busy = true; updateButtonLocks();
  try {
    const response = await api('time', { epoch: Math.floor(Date.now() / 1000) });
    if (response.ok !== true) throw new Error('시각 맞추기가 확인되지 않았어요.');
    await readState(false); setMessage('weather-action-state', '시각을 맞췄어요.');
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
