import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { renderWeatherFrame, OLED_WEATHER_LABELS } from '../web/oled-weather.mjs';
import { WEATHER_GLYPHS } from '../web/weather-glyphs.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const executable = fileURLToPath(new URL('../.build/native/export_weather_frame', import.meta.url));
mkdirSync(new URL('../.build/native/', import.meta.url), { recursive: true });
execFileSync(process.env.CXX || 'g++', ['-std=c++11', '-O1', '-Wall', '-Wextra', '-Werror',
  '-fsanitize=address,undefined', '-fno-omit-frame-pointer', 'tools/export_weather_frame.cpp', '-o', executable], { cwd: root });
const statuses = ['missing', 'sample', 'clock-unknown', 'stale', 'fresh'];
const codes = [0, 3, 61, 73, 95, 45];
function fixture(code, temperature, received, measured, humidity = 58) {
  return { fetchedAt: received, current: { code, temperature, time: measured, humidity },
    hourly: Array.from({ length: 24 }, (_, index) => ({ time: (Math.floor(received / 3600) + index + 1) * 3600,
      temperature: -10.5 + index * 2.5, code: codes[index % 6], humidity: (index * 7) % 101 })) };
}
function compare(status, page, phase, code, temperature, received = 1792753860, measured = received - 900, humidity = 58) {
  const weather = status ? fixture(code, temperature, received, measured, humidity) : null;
  const native = execFileSync(executable, [status, page, phase, code, temperature, received, measured, humidity].map(String));
  const browser = renderWeatherFrame({ weather, status: statuses[status], page, phase });
  assert.equal(browser.length, 1024);
  assert.deepEqual(Buffer.from(browser), native);
  return browser;
}

test('every visible OLED label has baked Korean glyphs and no English placeholder', () => {
  const phrases = [...Object.values(OLED_WEATHER_LABELS), '시', '%'];
  for (const phrase of phrases) {
    assert.doesNotMatch(phrase, /[a-z]/i);
    for (const char of phrase) if (char !== ' ') assert.ok(WEATHER_GLYPHS[char], `missing glyph ${char}`);
  }
  assert.equal(new Set(Object.values(OLED_WEATHER_LABELS)).size, 5);
});

for (let status = 0; status < statuses.length; status += 1) {
  test(`native/browser OLED pixel parity: ${statuses[status]}`, () => {
    for (let page = 0; page <= 24; page += 1) for (const phase of [0, 14]) compare(status, page, phase, 0, 23.5);
  });
}
for (const code of codes) {
  test(`cute icon/blink/current-temperature parity: weather code ${code}`, () => {
    for (const phase of [0, 8, 14, 15, 31]) for (const degrees of [-90, -10.25, -0.05, 0, 22.25, 65])
      compare(4, 0, phase, code, degrees);
  });
}
test('Korean status badges remain distinct while a saved forecast stays visible', () => {
  const frames = statuses.slice(1).map((_, index) => compare(index + 1, 0, 0, 3, 20));
  const topRows = (buffer) => Buffer.from(buffer).subarray(0, 256).toString('base64');
  assert.equal(new Set(frames.map(topRows)).size, 4);
});
function pixel(frame, x, y) { return Boolean(frame[x + (y >> 3) * 128] & (1 << (y & 7))); }
function region(frame, x0, y0, width, height) {
  return Array.from({ length: height }, (_, dy) => Array.from({ length: width }, (_, dx) => pixel(frame, x0 + dx, y0 + dy))).flat();
}
test('fresh current weather has no prose header or timestamp footer', () => {
  const frame = compare(4, 0, 0, 61, 19.9);
  assert.ok(region(frame, 0, 0, 128, 13).every(value => !value));
  assert.ok(region(frame, 0, 60, 128, 4).every(value => !value));
  const later = compare(4, 0, 0, 61, 19.9, 1792840260);
  assert.deepEqual(later, frame, 'received date belongs in web details, not the normal OLED');
});
test('all 24 forecasts retain distinct time and the same compact icon layout', () => {
  const frames = Array.from({ length: 24 }, (_, index) => compare(4, index + 1, 0, 61, 19.9));
  assert.equal(new Set(frames.map(frame => JSON.stringify(region(frame, 69, 0, 58, 12)))).size, 24);
  for (const frame of frames) assert.ok(region(frame, 0, 60, 128, 4).every(value => !value));
});
test('0–100 percent humidity fits, changes only its readout, and legacy unknown is distinct', () => {
  const frames = [-1, 0, 1, 58, 99, 100].map(humidity => compare(4, 0, 0, 0, 24, 1792753860, 1792752960, humidity));
  assert.equal(new Set(frames.map(frame => Buffer.from(frame).toString('base64'))).size, 6);
  for (const frame of frames) {
    assert.deepEqual(region(frame, 0, 0, 128, 40), region(frames[0], 0, 0, 128, 40));
    assert.ok(region(frame, 127, 0, 1, 64).every(value => !value));
  }
  const legacy = fixture(0, 24, 1792753860, 1792752960);
  delete legacy.current.humidity;
  assert.deepEqual(renderWeatherFrame({ weather: legacy, status: 'fresh' }), frames[0]);
});
test('negative extremes and highest humidity stay inside the OLED border', () => {
  for (const code of codes) for (const degrees of [-90, -10.5, -0.5, 0, 65]) {
    const frame = compare(4, 0, 8, code, degrees, 1792753860, 1792752960, 100);
    for (const x of [0, 127]) assert.ok(region(frame, x, 0, 1, 64).every(value => !value));
    assert.ok(region(frame, 0, 63, 128, 1).every(value => !value));
  }
});
test('KST dates survive leap-day and year rollover identically', () => {
  for (const received of [Date.UTC(2024, 1, 29, 15, 1) / 1000, Date.UTC(2026, 11, 31, 16, 5) / 1000,
    Date.UTC(2099, 11, 31, 14, 59) / 1000]) for (const page of [0, 1, 24]) compare(4, page, 8, 73, -2.5, received);
});
