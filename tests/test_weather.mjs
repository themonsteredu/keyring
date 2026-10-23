import test from 'node:test';
import assert from 'node:assert/strict';
import { validateWeather, normalizeOpenMeteo, makeSample, weatherStatus, weatherKind, kstTime } from '../web/weather.mjs';
const NOW = 1792711800;
const clone = (value) => JSON.parse(JSON.stringify(value));
function actual() { const value = makeSample(NOW); value.source = 'open-meteo'; return value; }

test('sample has 24 consecutive hours and never claims to be real weather', () => {
  const data = makeSample(NOW);
  assert.equal(data.hourly.length, 24);
  assert.equal(data.hourly[23].time - data.hourly[0].time, 23 * 3600);
  assert.equal(weatherStatus(data, true, NOW), 'sample');
  assert.equal(weatherStatus(data, false, NOW), 'sample');
});
test('cached real weather requires a trusted boot clock and expires at 3 hours', () => {
  const data = actual();
  assert.equal(weatherStatus(null, false, NOW), 'missing');
  assert.equal(weatherStatus(data, false, NOW), 'clock-unknown');
  assert.equal(weatherStatus(data, true, NOW), 'fresh');
  assert.equal(weatherStatus(data, true, NOW + 10800), 'fresh');
  assert.equal(weatherStatus(data, true, NOW + 10801), 'stale');
  assert.equal(weatherStatus(data, true, NOW - 301), 'stale');
});
test('validation rejects invalid source, numeric coercion, code, and incomplete or unordered forecast', () => {
  const cases = [
    (data) => { data.schema = 2; },
    (data) => { data.source = 'live'; },
    (data) => { data.fetchedAt = String(NOW); },
    (data) => { data.location.latitude = 91; },
    (data) => { data.location.name = 'bad\nname'; },
    (data) => { data.current.temperature = null; },
    (data) => { data.current.code = 4; },
    (data) => { data.hourly.pop(); },
    (data) => { data.hourly[1].time += 60; },
    (data) => { data.hourly[0].time -= 3600; },
    (data) => { data.hourly[23].temperature = 71; },
    (data) => { data.current.time -= 3601; },
  ];
  for (const change of cases) { const data = actual(); change(data); assert.throws(() => validateWeather(data)); }
});
test('validation sanitizes shape without mutating input', () => {
  const data = actual(); data.extra = 'ignored'; data.location.name = ' 서울 ';
  const result = validateWeather(data);
  assert.equal(result.location.name, '서울');
  assert.equal(data.location.name, ' 서울 ');
  assert.equal(result.extra, undefined);
  result.hourly[0].temperature = -5;
  assert.notEqual(data.hourly[0].temperature, -5);
});
test('normalizer selects the next 24 hourly forecasts without elapsed time slots', () => {
  const start = Math.floor(NOW / 3600) * 3600 - 12 * 3600;
  const input = { current: { time: NOW - 300, temperature_2m: 19.5, weather_code: 1 }, current_units: { temperature_2m: '°C' }, hourly_units: { temperature_2m: '°C' }, hourly: { time: [], temperature_2m: [], weather_code: [] } };
  for (let i = 0; i < 48; i += 1) { input.hourly.time.push(start + i * 3600); input.hourly.temperature_2m.push(18 + i / 10); input.hourly.weather_code.push(0); }
  const result = normalizeOpenMeteo(input, { name: '서울', latitude: 37.5665, longitude: 126.978 }, NOW);
  assert.equal(result.source, 'open-meteo');
  assert.equal(result.hourly[0].time, (Math.floor(NOW / 3600) + 1) * 3600);
  assert.equal(result.hourly[0].temperature, 19.3);
  assert.equal(result.hourly.length, 24);
  const badUnit = clone(input); badUnit.current_units.temperature_2m = '°F';
  assert.throws(() => normalizeOpenMeteo(badUnit, result.location, NOW));
  const short = clone(input); short.hourly.time.length = 20;
  assert.throws(() => normalizeOpenMeteo(short, result.location, NOW));
});
test('weather glyph classes and explicit Korean timezone are stable', () => {
  assert.equal(weatherKind(0), 'sun'); assert.equal(weatherKind(3), 'cloud');
  assert.equal(weatherKind(95), 'rain'); assert.equal(weatherKind(85), 'snow');
  assert.match(kstTime(1704067200, true), /09:00/);
});

test('imports accept device-supported hourly offsets while preserving the original update time', () => {
  const data = actual();
  data.hourly.forEach((point) => { point.time += 1800; });
  const result = validateWeather(data);
  assert.equal(result.fetchedAt, NOW);
  assert.equal(result.hourly[0].time, data.hourly[0].time);
});
test('forecasts outside current coverage cannot be labeled fresh', () => {
  const data = actual();
  const now = NOW;
  data.hourly.forEach((point) => { point.time += 7200; });
  assert.equal(weatherStatus(data, true, now), 'stale');
  const future = actual(); future.fetchedAt = now + 301;
  assert.equal(weatherStatus(future, true, now), 'stale');
});
