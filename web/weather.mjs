/** Weather contract shared by device uploads, exported files, and the web UI. */
export const WMO_CODES = new Set([0, 1, 2, 3, 45, 48, 51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 71, 73, 75, 77, 80, 81, 82, 85, 86, 95, 96, 99]);
const MIN_TIME = 1704067200;
const MAX_TIME = 4102444800;
const isNumber = (value) => typeof value === 'number' && Number.isFinite(value);
const validTime = (value) => Number.isInteger(value) && value >= MIN_TIME && value < MAX_TIME;
function requireValue(condition, message) { if (!condition) throw new Error(message); }
function validatePoint(point, name) {
  requireValue(point && validTime(point.time), `${name} 시각이 올바르지 않아요.`);
  requireValue(isNumber(point.temperature) && point.temperature >= -90 && point.temperature <= 65, `${name} 온도가 올바르지 않아요.`);
  requireValue(Number.isInteger(point.code) && WMO_CODES.has(point.code), `${name} 날씨 코드가 올바르지 않아요.`);
  return { time: point.time, temperature: point.temperature, code: point.code };
}

/** Returns a clean object; rejects strings disguised as numbers and malformed forecasts. */
export function validateWeather(input) {
  requireValue(input && input.schema === 1, '이 키링에서 읽을 수 없는 날씨 파일이에요.');
  requireValue(input.source === 'open-meteo' || input.source === 'sample', '날씨 출처가 올바르지 않아요.');
  requireValue(validTime(input.fetchedAt), '업데이트 시각이 올바르지 않아요.');
  const location = input.location;
  requireValue(location && typeof location.name === 'string' && location.name.trim().length > 0 && new TextEncoder().encode(location.name).length <= 96 && !/[\u0000-\u001f\u007f]/u.test(location.name), '지역 이름은 한글 32자 이내로 입력해 주세요.');
  requireValue(isNumber(location.latitude) && Math.abs(location.latitude) <= 90 && isNumber(location.longitude) && Math.abs(location.longitude) <= 180, '지역 좌표가 올바르지 않아요.');
  const current = validatePoint(input.current, '현재 날씨');
  requireValue(current.time <= input.fetchedAt + 300 && current.time >= input.fetchedAt - 3600, '현재 날씨와 업데이트 시각이 맞지 않아요.');
  requireValue(Array.isArray(input.hourly) && input.hourly.length === 24, '한 시간 간격의 예보 24개가 필요해요.');
  const hourly = input.hourly.map((point, index) => validatePoint(point, `${index + 1}번째 예보`));
  requireValue(Math.abs(hourly[0].time - input.fetchedAt) <= 3600, '첫 예보는 업데이트 시각과 한 시간 이내여야 해요.');
  for (let index = 1; index < hourly.length; index += 1) {
    requireValue(hourly[index].time === hourly[index - 1].time + 3600, '예보가 한 시간 간격으로 이어져야 해요.');
  }
  return { schema: 1, source: input.source, location: { name: location.name.trim(), latitude: location.latitude, longitude: location.longitude }, fetchedAt: input.fetchedAt, current, hourly };
}

export function normalizeOpenMeteo(response, location, now = Math.floor(Date.now() / 1000)) {
  requireValue(response && response.current && response.hourly, '날씨 서비스 응답에 필요한 정보가 없어요.');
  requireValue(response.current_units?.temperature_2m === '°C' && response.hourly_units?.temperature_2m === '°C', '섭씨 온도 응답만 사용할 수 있어요.');
  const hourly = response.hourly;
  requireValue(Array.isArray(hourly.time) && Array.isArray(hourly.temperature_2m) && Array.isArray(hourly.weather_code), '시간별 예보 형식이 올바르지 않아요.');
  requireValue(hourly.time.length === hourly.temperature_2m.length && hourly.time.length === hourly.weather_code.length, '시간별 예보 개수가 맞지 않아요.');
  const start = hourly.time.indexOf((Math.floor(now / 3600) + 1) * 3600);
  requireValue(start >= 0 && start + 24 <= hourly.time.length, '앞으로 24시간 예보가 아직 없어요. 잠시 후 다시 받아 주세요.');
  return validateWeather({
    schema: 1, source: 'open-meteo', location, fetchedAt: now,
    current: { time: response.current.time, temperature: response.current.temperature_2m, code: response.current.weather_code },
    hourly: hourly.time.slice(start, start + 24).map((time, index) => ({ time, temperature: hourly.temperature_2m[start + index], code: hourly.weather_code[start + index] })),
  });
}

export function weatherStatus(weather, trusted, now = Math.floor(Date.now() / 1000)) {
  if (!weather) return 'missing';
  if (weather.source === 'sample') return 'sample';
  if (!trusted || !validTime(now)) return 'clock-unknown';
  if (now < weather.fetchedAt - 300 || now - weather.fetchedAt > 10800 || now >= weather.hourly[23].time + 3600 || now + 3600 < weather.hourly[0].time) return 'stale';
  return 'fresh';
}

export function makeSample(now = Math.floor(Date.now() / 1000)) {
  const first = (Math.floor(now / 3600) + 1) * 3600;
  const codes = [0, 0, 1, 2, 3, 61, 61, 3, 2, 1, 0, 0, 3, 3, 71, 71, 3, 2, 1, 0, 0, 0, 1, 2];
  return validateWeather({ schema: 1, source: 'sample', fetchedAt: now,
    location: { name: '연습용 마을', latitude: 37.5665, longitude: 126.978 },
    current: { time: now, temperature: 22, code: 0 },
    hourly: codes.map((code, index) => ({ time: first + index * 3600, temperature: Math.round((20 + Math.sin(index / 3) * 4) * 10) / 10, code })),
  });
}

export function weatherKind(code) {
  if ([71, 73, 75, 77, 85, 86].includes(code)) return 'snow';
  if ([51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82, 95, 96, 99].includes(code)) return 'rain';
  if ([2, 3, 45, 48].includes(code)) return 'cloud';
  return 'sun';
}
export const WEATHER_LABELS = { sun: '맑음', cloud: '흐림', rain: '비', snow: '눈' };
export function kstTime(epoch, detailed = false) {
  return new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', year: detailed ? 'numeric' : undefined, month: detailed ? 'numeric' : undefined, day: detailed ? 'numeric' : undefined, hour: '2-digit', minute: detailed ? '2-digit' : undefined, hour12: false }).format(new Date(epoch * 1000));
}
