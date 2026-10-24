const { test, expect } = require('@playwright/test');

test.beforeEach(async ({ request }) => {
  await request.post('/api/reset', { data: {} });
});

async function ready(page, tab = 'customize') {
  await page.goto('/');
  await expect(page.locator('#connection-text')).toHaveText('개발용 모의 기기');
  await expect(page.locator('#atlas-error')).toBeHidden();
  await expect.poll(() => page.locator('#preview').evaluate(c => {
    const data = c.getContext('2d').getImageData(0, 0, 128, 64).data;
    return data.some((v, i) => i % 4 === 0 && v === 255);
  })).toBeTruthy();
  if (tab) await page.locator(`#tab-${tab}`).click();
}

test('opens with face styles and shows the same OLED polarity in the choices', async ({ page }) => {
  await ready(page, null);
  await expect(page.locator('#tab-customize')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#characters .choice strong')).toHaveText(['말랑눈', '초롱눈', '웃음눈', '콩알눈', '네모눈']);
  await expect(page.locator('#preview-name')).toHaveText('행복한 말랑눈');
  await page.locator('#characters .choice:has(input[value=monster])').click();
  await page.locator('#emotions .choice:has(input[value=love])').click();
  await expect(page.locator('#preview-name')).toHaveText('사랑에 빠진 네모눈');
  const palettes = await page.locator('#characters canvas, #emotions canvas').evaluateAll(canvases => canvases.map(c => {
    const pixels = c.getContext('2d').getImageData(0, 0, 128, 64).data;
    const colors = new Set();
    for (let i = 0; i < pixels.length; i += 4) colors.add(Array.from(pixels.slice(i, i + 4)).join(','));
    return [...colors].sort();
  }));
  for (const palette of palettes) expect(palette).toEqual(['255,255,255,255', '5,11,18,255']);
});

test('all 30 previews exactly match firmware framebuffer pixels', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await ready(page);
  await expect(page.locator('#simulation-note')).toContainText('실제 키링이 아니에요');
  if (await page.locator('#animation-toggle').getAttribute('aria-pressed') === 'true')
    await page.locator('#animation-toggle').click();
  const atlas = await page.request.get('/sprites.json').then(r => r.json());
  for (const character of atlas.characters) for (const emotion of atlas.emotions) {
    await page.locator(`#characters .choice:has(input[value=${character}])`).click();
    await page.locator(`#emotions .choice:has(input[value=${emotion}])`).click();
    const frame = await page.locator('#preview').evaluate(c => {
      const pixels = c.getContext('2d').getImageData(0, 0, 128, 64).data;
      const packed = new Uint8Array(1024);
      const colors = new Set();
      for (let y = 0; y < 64; y++) for (let x = 0; x < 128; x++) {
        const offset = (y * 128 + x) * 4;
        colors.add(Array.from(pixels.slice(offset, offset + 4)).join(','));
        if (pixels[offset] >= 128) packed[x + (y >> 3) * 128] |= 1 << (y & 7);
      }
      return { encoded: btoa(String.fromCharCode(...packed)), colors: [...colors].sort() };
    });
    expect(atlas.data[`${character}:${emotion}`]).toContain(frame.encoded);
    expect(frame.colors).toEqual(['255,255,255,255', '5,11,18,255']);
  }
  expect(errors).toEqual([]);
});

test('apply acknowledges saved settings and restores after reload', async ({ page, request }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await ready(page);
  await page.locator('#characters .choice:has(input[value=turtle])').click();
  await page.locator('#emotions .choice:has(input[value=love])').click();
  await page.locator('.view-option:has(input[value=auto])').click();
  await page.locator('#apply').click();
  await expect(page.locator('#save-state')).toContainText('저장 완료');
  const state = await request.get('/api/state').then(r => r.json());
  expect([state.character, state.emotion, state.view]).toEqual(['turtle', 'love', 'auto']);
  await page.reload();
  await expect(page.locator('#preview-name')).toHaveText('사랑에 빠진 콩알눈');
  await expect(page.locator('#apply')).toBeDisabled();
});

test('save failure is visible and does not claim success', async ({ page, request }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await ready(page);
  await page.route('**/api/settings', route => route.fulfill({ status: 503,
    contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'storage_write_failed' }) }));
  await page.locator('#characters .choice:has(input[value=cat])').click();
  await page.locator('#apply').click();
  await expect(page.locator('#save-state')).toContainText('저장하지 못했어요');
  expect((await request.get('/api/state').then(r => r.json())).character).toBe('rabbit');
  await expect(page.locator('#apply')).toBeEnabled();
});

test('sample remains explicit; reset clears cached forecast and settings', async ({ page, request }) => {
  await ready(page, 'weather');
  await page.locator('#sample-weather').click();
  await expect(page.locator('#weather-action-state')).toContainText('모의 기기에 저장');
  await expect(page.locator('#weather-badge')).toContainText('실제 날씨 아님');
  await expect(page.locator('#forecast li')).toHaveCount(24);
  expect((await request.get('/api/state').then(r => r.json())).weather.source).toBe('sample');
  await page.locator('#reset').click();
  await expect(page.locator('#reset-dialog')).toBeVisible();
  await page.locator('#confirm-reset').click();
  await expect(page.locator('#weather-badge')).toContainText('저장된 날씨 없음');
  expect((await request.get('/api/state').then(r => r.json())).weather).toBeNull();
});

test('invalid imported forecast preserves previous cached forecast', async ({ page, request }) => {
  await ready(page, 'weather');
  await page.locator('#sample-weather').click();
  await expect(page.locator('#forecast li')).toHaveCount(24);
  const original = await request.get('/api/state').then(r => r.json());
  await page.locator('#weather-file').setInputFiles({ name: 'broken.json', mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ schema: 1, source: 'open-meteo', hourly: [] })) });
  await expect(page.locator('#weather-action-state')).toContainText('파일을 읽지 못했어요');
  expect((await request.get('/api/state').then(r => r.json())).weather).toEqual(original.weather);
});

test('offline editor can preview and reports real API failure without fake weather', async ({ page }) => {
  await page.route('**/api/**', route => route.fulfill({ status: 404,
    contentType: 'application/json', body: JSON.stringify({ ok: false }) }));
  await page.route('https://api.open-meteo.com/**', route => route.abort('internetdisconnected'));
  await page.goto('/');
  await expect(page.locator('#connection-text')).toHaveText('미리보기 모드');
  await expect(page.locator('#apply-mobile')).toBeDisabled();
  await page.locator('#tab-customize').click();
  await page.locator('#characters .choice:has(input[value=bear])').click();
  await expect(page.locator('#preview-name')).toHaveText('행복한 웃음눈');
  await page.locator('#tab-weather').click();
  await page.locator('#fetch-weather').click();
  await expect(page.locator('#weather-action-state')).toContainText('날씨를 받지 못했어요');
  await expect(page.locator('#weather-content')).toBeHidden();
  await page.locator('#sample-weather').click();
  await expect(page.locator('#weather-badge')).toContainText('연습용');
  await expect(page.locator('#download-weather')).toBeEnabled();
});

test('narrow mobile layout stays within viewport and respects reduced motion', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await ready(page);
  await expect(page.locator('#animation-toggle')).toHaveAttribute('aria-pressed', 'false');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
});

async function seedRealFixture(request) {
  // Deliberately constructed fixture, not an observed live API result.
  const now = Math.floor(Date.now() / 1000);
  const weather = { schema: 1, source: 'open-meteo', fetchedAt: now,
    location: { name: '서울', latitude: 37.57, longitude: 126.98 },
    current: { time: now, temperature: 18.5, code: 0 },
    hourly: Array.from({ length: 24 }, (_, i) => ({ time: Math.floor(now / 3600) * 3600 + i * 3600, temperature: 18, code: 3 })) };
  await request.post('/api/time', { data: { epoch: now } });
  expect((await request.post('/api/weather', { data: weather })).ok()).toBeTruthy();
}

test('cold boot with failed phone time sync labels cached weather unknown', async ({ page, request }) => {
  await seedRealFixture(request);
  await request.post('/api/debug/reboot', { data: {} });
  await page.route('**/api/time', route => route.fulfill({ status: 503,
    contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'test_clock_failure' }) }));
  await ready(page, 'weather');
  await expect(page.locator('#weather-badge')).toHaveText('시각 확인 필요');
  await expect(page.locator('#weather-warning')).toContainText('최신인지 확인할 수 없어요');
  await expect(page.locator('#forecast li')).toHaveCount(24);
});

test('open page ages cached weather past three hours without overwriting unsaved selection', async ({ page, request }) => {
  await seedRealFixture(request);
  await page.clock.install();
  await ready(page);
  await expect(page.locator('#weather-badge')).toHaveText('키링에 저장됨');
  await page.locator('#characters .choice:has(input[value=monster])').click();
  await page.locator('#tab-weather').click();
  await page.clock.fastForward(10802000);
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await expect(page.locator('#weather-badge')).toHaveText('오래된 예보');
  await expect(page.locator('#characters input[value=monster]')).toBeChecked();
});

test('mobile bottom action saves without returning to the preview', async ({ page, request }) => {
  await ready(page);
  await page.locator('#characters .choice:has(input[value=cat])').click();
  await page.locator('#emotions .choice:has(input[value=angry])').click();
  await expect(page.locator('#apply-mobile')).toBeVisible();
  await page.locator('#apply-mobile').click();
  await expect(page.locator('#save-state-mobile')).toContainText('저장 완료');
  const state = await request.get('/api/state').then(r => r.json());
  expect([state.character, state.emotion]).toEqual(['cat', 'angry']);
});
