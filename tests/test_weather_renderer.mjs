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
function fixture(code, temperature, received, measured) {
  return { fetchedAt: received, current: { code, temperature, time: measured },
    hourly: Array.from({ length: 24 }, (_, index) => ({ time: (Math.floor(received / 3600) + index + 1) * 3600,
      temperature: -10.5 + index * 2.5, code: codes[index % 6] })) };
}
function compare(status, page, phase, code, temperature, received = 1792753860, measured = received - 900) {
  const weather = status ? fixture(code, temperature, received, measured) : null;
  const native = execFileSync(executable, [status, page, phase, code, temperature, received, measured].map(String));
  const browser = renderWeatherFrame({ weather, status: statuses[status], page, phase });
  assert.equal(browser.length, 1024);
  assert.deepEqual(Buffer.from(browser), native);
  return browser;
}

test('every visible OLED label has baked Korean glyphs and no English placeholder', () => {
  const phrases = [...Object.values(OLED_WEATHER_LABELS), '맑음', '흐림', '비', '눈', '번개', '안개', '지금', '예보', '시', '받음', '날씨를 담아 주세요'];
  for (const phrase of phrases) {
    assert.doesNotMatch(phrase, /[a-z]/i);
    for (const char of phrase) if (char !== ' ') assert.ok(WEATHER_GLYPHS[char], `missing glyph ${char}`);
  }
  assert.equal(new Set(Object.values(OLED_WEATHER_LABELS)).size, 5);
});

for (let status = 0; status < statuses.length; status += 1) {
  test(`native/browser OLED pixel parity: ${statuses[status]}`, () => {
    for (const page of [0, 1, 2, 3, 4]) for (const phase of [0, 8, 14, 24]) compare(status, page, phase, 0, 23.5);
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
test('Korean received-date footer is stable across all 24 forecast hours', () => {
  const frames = [0, 1, 2, 3, 4].map((page) => compare(4, page, 0, 61, 19.9));
  const footer = (frame) => Array.from({ length: 128 }, (_, x) => frame[x + 6 * 128] & 0xf8).concat(Array.from(frame.subarray(7 * 128)));
  frames.slice(1).forEach((frame) => assert.deepEqual(footer(frame), footer(frames[0])));
});
test('KST dates survive leap-day and year rollover identically', () => {
  for (const received of [Date.UTC(2024, 1, 29, 15, 1) / 1000, Date.UTC(2026, 11, 31, 16, 5) / 1000,
    Date.UTC(2099, 11, 31, 14, 59) / 1000]) for (const page of [0, 4]) compare(4, page, 8, 73, -2.5, received);
});
