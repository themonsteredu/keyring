import { WEATHER_GLYPHS } from './weather-glyphs.mjs';

// Pixel-for-pixel companion to firmware/Keyring/weather_renderer.h. This does
// not use browser fonts: Korean text and digits are the actual OLED bitmaps.
export const OLED_WEATHER_LABELS = Object.freeze({ missing: '날씨 없음', sample: '연습 날씨', 'clock-unknown': '시각 확인', stale: '지난 예보', fresh: '최근 날씨' });

function weatherIcon(code) {
  if (code === 0 || code === 1) return 'sun';
  if (code === 2 || code === 3) return 'cloud';
  if (code === 45 || code === 48) return 'fog';
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'snow';
  return code >= 95 ? 'storm' : 'rain';
}
const round = (value) => value < 0 ? -Math.round(-value) : Math.round(value);
const pad = (value) => String(value).padStart(2, '0');
function kstDate(epoch) {
  const date = new Date((epoch + 9 * 3600) * 1000);
  return { month: date.getUTCMonth() + 1, day: date.getUTCDate(), hour: date.getUTCHours(), minute: date.getUTCMinutes() };
}

export function renderWeatherFrame({ weather = null, status = 'missing', page = 0, phase = 0 } = {}) {
  const buffer = new Uint8Array(1024);
  function pixel(x, y, on = true) {
    if (x < 0 || x >= 128 || y < 0 || y >= 64) return;
    const index = x + (y >> 3) * 128;
    const mask = 1 << (y & 7);
    if (on) buffer[index] |= mask; else buffer[index] &= ~mask;
  }
  function rectangle(x, y, width, height, on = true) {
    for (let row = 0; row < height; row += 1) for (let col = 0; col < width; col += 1) pixel(x + col, y + row, on);
  }
  function ellipse(cx, cy, rx, ry, on = true) {
    if (rx < 1 || ry < 1) { pixel(cx, cy, on); return; }
    const rr = rx * rx * ry * ry;
    for (let y = -ry; y <= ry; y += 1) for (let x = -rx; x <= rx; x += 1)
      if (x * x * ry * ry + y * y * rx * rx <= rr) pixel(cx + x, cy + y, on);
  }
  function line(x0, y0, x1, y1, on = true) {
    const dx = Math.abs(x1 - x0); const sx = x0 < x1 ? 1 : -1;
    const dy = -Math.abs(y1 - y0); const sy = y0 < y1 ? 1 : -1;
    let error = dx + dy;
    for (;;) {
      pixel(x0, y0, on); if (x0 === x1 && y0 === y1) break;
      const twice = 2 * error;
      if (twice >= dy) { error += dy; x0 += sx; }
      if (twice <= dx) { error += dx; y0 += sy; }
    }
  }
  function triangle(ax, ay, bx, by, cx, cy) {
    const minX = Math.max(0, Math.min(ax, bx, cx)); const maxX = Math.min(127, Math.max(ax, bx, cx));
    const minY = Math.max(0, Math.min(ay, by, cy)); const maxY = Math.min(63, Math.max(ay, by, cy));
    for (let y = minY; y <= maxY; y += 1) for (let x = minX; x <= maxX; x += 1) {
      const e0 = (x - ax) * (by - ay) - (y - ay) * (bx - ax);
      const e1 = (x - bx) * (cy - by) - (y - by) * (cx - bx);
      const e2 = (x - cx) * (ay - cy) - (y - cy) * (ax - cx);
      if ((e0 >= 0 && e1 >= 0 && e2 >= 0) || (e0 <= 0 && e1 <= 0 && e2 <= 0)) pixel(x, y);
    }
  }
  function text(value, x, y, scale = 1) {
    for (const char of String(value)) {
      if (char === ' ') { x += 4 * scale; continue; }
      const glyph = WEATHER_GLYPHS[char]; if (!glyph) continue;
      const code = char.codePointAt(0); const offset = code < 128 || code === 176 ? 2 : 0;
      for (let row = 0; row < 12; row += 1) for (let col = 0; col < glyph.width; col += 1)
        if (glyph.rows[row] & (1 << col)) rectangle(x + col * scale, y + (row + offset) * scale, scale, scale);
      x += (glyph.width + 1) * scale;
    }
    return x;
  }
  function stroke(x0, y0, x1, y1, thickness = 3, on = true) {
    for (let dy = 0; dy < thickness; dy += 1) for (let dx = 0; dx < thickness; dx += 1)
      line(x0 + dx, y0 + dy, x1 + dx, y1 + dy, on);
  }
  function smile(cx, cy, blink) {
    for (const eye of [-1, 1]) {
      const x = cx + eye * 7;
      if (blink) rectangle(x - 3, cy - 3, 7, 2, false);
      else {
        stroke(x - 3, cy - 2, x - 1, cy - 4, 2, false);
        stroke(x - 1, cy - 4, x + 1, cy - 4, 2, false);
        stroke(x + 1, cy - 4, x + 3, cy - 2, 2, false);
      }
    }
    stroke(cx - 4, cy + 3, cx - 2, cy + 5, 2, false);
    stroke(cx - 2, cy + 5, cx + 2, cy + 5, 2, false);
    stroke(cx + 2, cy + 5, cx + 4, cy + 3, 2, false);
  }
  function droplet(x, y) {
    triangle(x + 3, y, x, y + 6, x + 6, y + 6);
    ellipse(x + 3, y + 6, 3, 3);
  }
  function icon(x, y, kind) {
    const blink = phase === 14 || phase === 15;
    if (kind === 'sun') {
      ellipse(x + 25, y + 22, 14, 14);
      rectangle(x + 23, y, 5, 5); rectangle(x + 23, y + 40, 5, 5);
      rectangle(x + 3, y + 20, 5, 5); rectangle(x + 43, y + 20, 5, 5);
      const tilt = Math.floor(phase / 8) % 2;
      stroke(x + 9, y + 6 + tilt, x + 12, y + 9 + tilt);
      stroke(x + 36, y + 33 - tilt, x + 39, y + 36 - tilt);
      stroke(x + 9, y + 36 - tilt, x + 12, y + 33 - tilt);
      stroke(x + 36, y + 9 + tilt, x + 39, y + 6 + tilt);
      smile(x + 25, y + 22, blink); return;
    }
    const cy = y + Math.floor(phase / 8) % 2;
    ellipse(x + 12, cy + 20, 10, 10); ellipse(x + 24, cy + 13, 13, 13);
    ellipse(x + 37, cy + 20, 11, 10); rectangle(x + 11, cy + 20, 27, 12);
    smile(x + 25, cy + 21, blink);
    if (kind === 'rain') {
      const fall = Math.floor(phase / 8) % 2;
      for (let drop = 0; drop < 3; drop += 1) droplet(x + 9 + drop * 12, y + 34 + fall);
    } else if (kind === 'snow') {
      for (let flake = 0; flake < 2; flake += 1) {
        const cx = x + 15 + flake * 20; const fy = y + 39 + Math.floor(phase / 8) % 2;
        rectangle(cx - 4, fy - 1, 9, 3); rectangle(cx - 1, fy - 4, 3, 9);
        pixel(cx - 3, fy - 3); pixel(cx + 3, fy + 3); pixel(cx + 3, fy - 3); pixel(cx - 3, fy + 3);
      }
    } else if (kind === 'storm') {
      triangle(x + 25, y + 33, x + 17, y + 39, x + 28, y + 39);
      triangle(x + 21, y + 37, x + 31, y + 37, x + 23, y + 45);
    } else if (kind === 'fog') { rectangle(x + 5, y + 36, 32, 3); rectangle(x + 13, y + 42, 32, 3); }
  }

  if (!weather) { icon(38, 3, 'cloud'); text('날씨 없음', 40, 50); return buffer; }
  page %= 25;
  const point = page ? weather.hourly[page - 1] : weather.current;
  if (status !== 'fresh') text(OLED_WEATHER_LABELS[status] || OLED_WEATHER_LABELS.missing, 1, 0);
  if (page) {
    const when = kstDate(point.time);
    const end = text(`${pad(when.month)}/${pad(when.day)} ${pad(when.hour)}`, 69, 0);
    text('시', end, 0);
  }
  icon(2, 14, weatherIcon(point.code));
  const degrees = String(round(Math.fround(point.temperature)));
  const width = degrees.length * 18 + 5;
  const x = 64 + Math.trunc((62 - width) / 2);
  const end = text(degrees, x, 11, 3); text('°', end, 12, 2);
  const humidity = Number.isInteger(point.humidity) && point.humidity >= 0 ? `${point.humidity}%` : '--%';
  const humidityWidth = humidity.length * 12 - 2;
  const humidityX = 64 + Math.trunc((62 - (humidityWidth + 11)) / 2);
  droplet(humidityX, 45); text(humidity, humidityX + 11, 39, 2);
  return buffer;
}
