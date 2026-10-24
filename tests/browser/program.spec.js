const { test, expect } = require('@playwright/test');
const fs = require('node:fs');

const example = { schema: 1, enabled: true, loop: false, blocks: [
  { type: 'character', value: 'bear' }, { type: 'emotion', value: 'happy' },
  { type: 'wait', ms: 300 }, { type: 'emotion', value: 'love' },
] };

test.beforeEach(async ({ request }) => { await request.post('/api/reset', { data: {} }); });
async function ready(page) {
  await page.goto('/');
  await page.locator('#tab-blocks').click();
  await expect(page.locator('#blockly-workspace .blocklySvg').first()).toBeVisible();
  await expect.poll(() => page.evaluate(async () => {
    const { getActiveStudio } = await import('/blocks-editor.mjs');
    return Boolean(getActiveStudio());
  })).toBeTruthy();
}
async function program(page) {
  return page.evaluate(async () => (await import('/blocks-editor.mjs')).getActiveStudio().getProgram());
}
async function load(page, source = example) {
  await page.locator('#program-import').setInputFiles({ name: 'my-keyring.json', mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(source)) });
  await expect(page.locator('#program-status')).toContainText('프로그램 파일을 블록으로 불러왔어요');
}

test('actual Blockly toolbox creates draggable blocks and disconnected code cannot run', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await ready(page);
  await expect(page.locator('#tab-blocks')).toHaveAttribute('aria-selected', 'true');
  const count = await page.evaluate(async () => (await import('/blocks-editor.mjs')).getActiveStudio().workspace.getAllBlocks(false).length);
  await page.locator('.blocklyToolboxCategory').filter({ hasText: /^눈·표정$/ }).click();
  const source = await page.locator('.blocklyFlyout .blocklyDraggable').first().boundingBox();
  const target = await page.locator('#blockly-workspace').boundingBox();
  expect(source).not.toBeNull();
  await page.mouse.move(source.x + 50, source.y + 20);
  await page.mouse.down();
  await page.mouse.move(target.x + target.width - 170, target.y + 90, { steps: 24 });
  await page.mouse.up();
  await expect.poll(() => page.evaluate(async () => (await import('/blocks-editor.mjs')).getActiveStudio().workspace.getAllBlocks(false).length)).toBe(count + 1);
  await page.locator('#program-run').click();
  await expect(page.locator('#program-status')).toContainText('떨어진 블록');
});

test('nested JSON becomes editable blocks and local preview runs then restores saved base', async ({ page }) => {
  await ready(page);
  await load(page);
  expect(await program(page)).toEqual(example);
  await page.locator('#program-run').click();
  await page.locator('#tab-weather').click();
  await expect(page.locator('#program-status')).toContainText('미리 실행이 끝났어요');
  await expect(page.locator('#preview-name')).toHaveText('우리 동네 날씨');
  await expect(page.locator('#preview-run-state')).toHaveText('날씨 미리보기');
  await page.locator('#tab-customize').click();
  await expect(page.locator('#preview-name')).toHaveText('행복한 말랑눈');
  await expect(page.locator('#preview-run-state')).toHaveText('표정 미리보기');
  await page.locator('#tab-blocks').click();
  await expect(page.locator('#preview-name')).toHaveText('사랑에 빠진 웃음눈');
  await expect(page.locator('#preview-run-state')).toContainText('미리 실행이 끝났어요');
  await page.locator('#program-stop').click();
  await expect(page.locator('#preview-name')).toHaveText('행복한 말랑눈');
  await expect(page.locator('#program-status')).toContainText('실행을 멈췄어요');
});

test('a delayed animation-frame timestamp cannot prematurely stop a new preview', async ({ page }) => {
  await page.addInitScript(() => {
    const original = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = callback => original(timestamp => callback(Math.max(0, timestamp - 1000)));
  });
  await ready(page); await load(page);
  await page.locator('#program-run').click();
  await expect(page.locator('#preview-name')).toHaveText('사랑에 빠진 웃음눈');
});

test('device program save reads back exact AST, survives reboot, and stop persists', async ({ page, request }) => {
  await ready(page);
  await load(page);
  await expect(page.locator('#program-save')).toBeEnabled();
  await page.locator('#program-save').click();
  await expect(page.locator('#program-status')).toContainText('키링에 프로그램을 저장하고 실행했어요');
  let state = await request.get('/api/state').then(r => r.json());
  expect(state.program).toEqual(example);
  await request.post('/api/debug/reboot', { data: {} });
  state = await request.get('/api/state').then(r => r.json());
  expect(state.program.enabled).toBe(true);
  expect(state.programRunning).toBe(true);
  expect(state.clock.trusted).toBe(false);
  await page.locator('#program-stop').click();
  await expect(page.locator('#program-status')).toContainText('실행을 멈췄어요');
  state = await request.get('/api/state').then(r => r.json());
  expect(state.program.enabled).toBe(false);
  expect(state.programRunning).toBe(false);
  await page.reload();
  await expect.poll(() => program(page)).toEqual({ ...example, enabled: true });
  expect((await request.get('/api/state').then(r => r.json())).programRunning).toBe(false);
});

test('program save failures do not claim success or replace stored code', async ({ page, request }) => {
  await ready(page); await load(page);
  await page.route('**/api/program', route => route.fulfill({ status: 503, contentType: 'application/json',
    body: JSON.stringify({ ok: false, error: 'storage_write_failed' }) }));
  await page.locator('#program-save').click();
  await expect(page.locator('#program-status')).toContainText('확인하지 못했어요');
  expect((await request.get('/api/state').then(r => r.json())).program).toBeNull();
});

test('invalid program imports retain the existing workspace', async ({ page }) => {
  await ready(page); const before = await program(page);
  await page.locator('#program-import').setInputFiles({ name: 'bad.json', mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ ...example, blocks: [{ type: 'eval', value: 'alert(1)' }] })) });
  await expect(page.locator('#program-status')).toContainText('파일을 불러오지 못했어요');
  expect(await program(page)).toEqual(before);
});

test('online editor runs and exports without a device; cached data is not invented', async ({ page }) => {
  await page.route('**/api/**', route => route.fulfill({ status: 404, contentType: 'application/json', body: '{}' }));
  await ready(page);
  await expect(page.locator('#program-save')).toBeDisabled();
  await load(page); await page.locator('#program-run').click();
  await expect(page.locator('#preview-name')).toHaveText('사랑에 빠진 웃음눈');
  const download = page.waitForEvent('download'); await page.locator('#program-export').click();
  const file = await download;
  expect(file.suggestedFilename()).toBe('keyring-program.json');
  expect(JSON.parse(fs.readFileSync(await file.path(), 'utf8'))).toEqual(example);
  await page.locator('#tab-weather').click();
  await expect(page.locator('#weather-content')).toBeHidden();
});

test('Blockly works with production CSP and all required code is self hosted', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  const csp = JSON.parse(fs.readFileSync('vercel.json', 'utf8')).headers[0].headers.find(h => h.key === 'Content-Security-Policy').value;
  await page.route('**/*', async route => {
    if (route.request().isNavigationRequest()) {
      const response = await route.fetch();
      return route.fulfill({ response, headers: { ...response.headers(), 'Content-Security-Policy': csp } });
    }
    return route.continue();
  });
  await ready(page);
  await page.locator('#program-run').click();
  await expect(page.locator('#program-status')).toContainText('실행 중');
  expect(await page.evaluate(() => [...document.scripts].every(s => !s.src || new URL(s.src).origin === location.origin))).toBe(true);
  expect(errors).toEqual([]);
});

test('mobile studio fits viewport and legacy firmware has a clear upgrade path', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.route('**/api/state', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({
    character: 'rabbit', emotion: 'happy', view: 'character', oled: true, storage: true,
    clock: { trusted: true, now: Math.floor(Date.now() / 1000) }, weather: null, weatherStatus: 'missing',
  }) }));
  await ready(page);
  await expect(page.locator('#program-save')).toBeDisabled();
  await expect(page.locator('#program-status')).toContainText('새 펌웨어');
  await expect(page.locator('#program-run')).toBeEnabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const toolbox = await page.locator('.blocklyToolbox').boundingBox();
  expect(toolbox.width).toBeGreaterThan(toolbox.height);
});

test('mobile block editing keeps the OLED result and run button in view', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await ready(page);
  await page.locator('#blockly-workspace').scrollIntoViewIfNeeded();
  const visible = async selector => page.locator(selector).evaluate(element => {
    const r = element.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && r.top >= 0 && r.bottom <= innerHeight && r.left >= 0 && r.right <= innerWidth;
  });
  await expect.poll(() => visible('#preview')).toBe(true);
  await expect.poll(() => visible('#program-run')).toBe(true);
  await page.locator('#program-run').click();
  await expect(page.locator('#program-status')).toContainText('실행 중');
  await expect.poll(() => visible('#preview')).toBe(true);
  await expect.poll(() => visible('#program-run')).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
