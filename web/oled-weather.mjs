import { WEATHER_GLYPHS } from './weather-glyphs.mjs';

// Pixel-for-pixel companion to firmware/Keyring/weather_renderer.h. This does
// not use browser fonts: Korean text and digits are the actual OLED bitmaps.
export const OLED_WEATHER_LABELS = Object.freeze({ missing: '날씨 없음', sample: '연습 날씨', 'clock-unknown': '시각 확인', stale: '지난 예보', fresh: '최근 날씨' });
const ICON_LABELS = { sun: '맑음', cloud: '흐림', rain: '비', snow: '눈', storm: '번개', fog: '안개' };

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
  function boldLine(x0, y0, x1, y1, on = true) { line(x0, y0, x1, y1, on); line(x0, y0 + 1, x1, y1 + 1, on); }
  function smile(cx, cy, blink) {
    if (blink) { rectangle(cx - 7, cy - 2, 4, 2, false); rectangle(cx + 4, cy - 2, 4, 2, false); }
    else { ellipse(cx - 5, cy - 1, 1, 2, false); ellipse(cx + 6, cy - 1, 1, 2, false); }
    line(cx - 3, cy + 3, cx - 1, cy + 5, false); line(cx - 1, cy + 5, cx + 2, cy + 5, false); line(cx + 2, cy + 5, cx + 4, cy + 3, false);
  }
  function icon(x, y, kind, small) {
    if (small) {
      if (kind === 'sun') {
        ellipse(x + 6, y + 5, 4, 4); line(x + 6, y - 1, x + 6, y); line(x + 6, y + 10, x + 6, y + 11);
        line(x, y + 5, x + 1, y + 5); line(x + 11, y + 5, x + 12, y + 5);
        pixel(x + 4, y + 4, false); pixel(x + 8, y + 4, false); line(x + 5, y + 7, x + 7, y + 7, false);
        return;
      }
      ellipse(x + 4, y + 4, 3, 3); ellipse(x + 8, y + 3, 3, 3); rectangle(x + 1, y + 4, 11, 3);
      pixel(x + 4, y + 4, false); pixel(x + 8, y + 4, false);
      if (kind === 'rain') { line(x + 4, y + 9, x + 3, y + 10); line(x + 9, y + 9, x + 8, y + 10); }
      else if (kind === 'snow') { pixel(x + 4, y + 9); pixel(x + 8, y + 10); pixel(x + 7, y + 8); }
      else if (kind === 'storm') { line(x + 7, y + 8, x + 5, y + 10); line(x + 5, y + 10, x + 7, y + 10); pixel(x + 6, y + 11); }
      else if (kind === 'fog') { line(x + 1, y + 9, x + 10, y + 9); line(x + 3, y + 11, x + 12, y + 11); }
      return;
    }
    const blink = phase === 14 || phase === 15;
    if (kind === 'sun') {
      ellipse(x + 24, y + 17, 11, 11); boldLine(x + 24, y + 1, x + 24, y + 3); boldLine(x + 24, y + 31, x + 24, y + 33);
      boldLine(x + 8, y + 17, x + 10, y + 17); boldLine(x + 38, y + 17, x + 40, y + 17);
      const tilt = Math.floor(phase / 8) % 2;
      boldLine(x + 12, y + 5 + tilt, x + 14, y + 7 + tilt); boldLine(x + 34, y + 27 - tilt, x + 36, y + 29 - tilt);
      boldLine(x + 12, y + 29 - tilt, x + 14, y + 27 - tilt); boldLine(x + 34, y + 7 + tilt, x + 36, y + 5 + tilt);
      smile(x + 24, y + 17, blink); return;
    }
    const cy = y + Math.floor(phase / 8) % 2;
    ellipse(x + 13, cy + 15, 8, 8); ellipse(x + 23, cy + 10, 10, 10); ellipse(x + 33, cy + 15, 9, 8); rectangle(x + 12, cy + 15, 23, 10);
    smile(x + 23, cy + 15, blink);
    if (kind === 'rain') {
      const fall = Math.floor(phase / 4) % 3;
      for (let drop = 0; drop < 3; drop += 1) boldLine(x + 13 + drop * 11, y + 27 + fall, x + 11 + drop * 11, y + 30 + fall);
    } else if (kind === 'snow') {
      for (let flake = 0; flake < 2; flake += 1) {
        const cx = x + 15 + flake * 17; const fy = y + 29 + Math.floor(phase / 8) % 2;
        line(cx - 3, fy, cx + 3, fy); line(cx, fy - 3, cx, fy + 3);
        pixel(cx - 2, fy - 2); pixel(cx + 2, fy + 2); pixel(cx + 2, fy - 2); pixel(cx - 2, fy + 2);
      }
    } else if (kind === 'storm') { triangle(x + 24, y + 25, x + 18, y + 30, x + 26, y + 30); triangle(x + 20, y + 29, x + 28, y + 29, x + 21, y + 35); }
    else if (kind === 'fog') { boldLine(x + 7, y + 29, x + 36, y + 29); boldLine(x + 13, y + 34, x + 42, y + 34); }
  }

  if (!weather) { text('날씨 없음', 40, 0); icon(39, 14, 'cloud', false); text('날씨를 담아 주세요', 16, 51); return buffer; }
  page %= 5;
  text(OLED_WEATHER_LABELS[status] || OLED_WEATHER_LABELS.missing, 0, 0);
  if (page) { text('예보', 78, 0); text(`${page}/4`, 108, 0); } else text('날씨', 106, 0);
  const received = kstDate(weather.fetchedAt);
  text('받음', 0, 51); text(`${pad(received.month)}/${pad(received.day)} ${pad(received.hour)}:${pad(received.minute)}`, 25, 51);
  if (!page) {
    const kind = weatherIcon(weather.current.code); icon(0, 14, kind, false);
    const tenths = round(Math.fround(Math.fround(weather.current.temperature) * 10)); const magnitude = Math.abs(tenths);
    const end = text(`${tenths < 0 ? '-' : ''}${Math.floor(magnitude / 10)}.${magnitude % 10}`, 54, 14, 2); text('°', end, 15);
    text(ICON_LABELS[kind], 55, 35);
    const measured = kstDate(weather.current.time); text(`${pad(measured.hour)}:${pad(measured.minute)}`, 87, 36);
    return buffer;
  }
  weather.hourly.slice((page - 1) * 6, page * 6).forEach((point, cell) => {
    const x = cell % 2 * 64; const y = 14 + Math.floor(cell / 2) * 12;
    const when = kstDate(point.time); text(pad(when.hour), x, y); text('시', x + 12, y);
    const end = text(String(round(Math.fround(point.temperature))), x + 25, y); text('°', end, y); icon(x + 50, y, weatherIcon(point.code), true);
  });
  return buffer;
}
