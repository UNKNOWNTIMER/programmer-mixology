// Real Windows debug EXE + WebView2 + Rust/SQLite acceptance and documentation images.
// Run after building product/target/debug/pixel-mix.exe and the bundled frontend.
// Set PLAYWRIGHT_MODULE to an existing Playwright module if it is not on NODE_PATH.
// No browser-only replacement, production data, model, LAN, clipboard, or installer changes.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const crypto = require('node:crypto');
const { spawn, execFileSync } = require('node:child_process');
const { setTimeout: sleep } = require('node:timers/promises');

const root = path.resolve(__dirname, '../../..');
const product = path.join(root, 'product');
const version = JSON.parse(fs.readFileSync(path.join(product, 'apps/client/package.json'), 'utf8')).version;
const executable = path.join(product, 'target/debug/pixel-mix.exe');
const evidence = path.join(product, 'evidence', `public-release-${version}`);
const dataDir = path.join(evidence, 'native-data');
const media = path.join(root, 'docs/media');
const results = [], errors = [], geometry = [], screenshots = [];
const runId = new Date().toISOString().replace(/[:.]/g, '-');
let browser, page, child, exited, call, catalog, verified = false, closedWithButton = false;
let failure, port, exitResult, initial, marks, pe, finalDiagnostics;

function playwright() {
  const candidates = [process.env.PLAYWRIGHT_MODULE, process.env.PIXEL_PLAYWRIGHT,
    'playwright', path.resolve(path.dirname(process.execPath), '../node_modules/playwright')].filter(Boolean);
  for (const candidate of candidates) {
    try { return require(candidate); } catch (error) { if (error.code !== 'MODULE_NOT_FOUND') throw error; }
  }
  throw Error('Playwright was not found. Set PLAYWRIGHT_MODULE to an existing module path.');
}
function real(file) { return fs.realpathSync(file).toLowerCase(); }
function sha(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }
async function until(check, message, timeout = 15000) {
  const deadline = Date.now() + timeout;
  let last;
  while (Date.now() < deadline) {
    try { const result = await check(); if (result) return result; } catch (error) { last = error; }
    await sleep(100);
  }
  throw Error(message + (last ? ': ' + last : ''));
}
async function test(name, action) {
  const started = performance.now();
  try { await action(); results.push({ name, pass: true, ms: Math.round(performance.now() - started) }); console.log('PASS', name); }
  catch (error) { results.push({ name, pass: false, error: String(error) }); throw error; }
}
async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolve));
  const selected = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return selected;
}
async function ready() {
  await page.locator('main[data-startup-phase="ready"]').waitFor({ timeout: 45000 });
  await page.waitForFunction(() => !document.querySelector('[data-motion-active="true"]'));
  await page.waitForFunction(() => document.fonts.status === 'loaded');
  await sleep(600);
}
async function workbenchFocus() {
  await page.keyboard.press('Escape');
  await page.mouse.move(4, 4);
  await page.evaluate(() => { window.getSelection()?.removeAllRanges(); if (document.activeElement instanceof HTMLElement) document.activeElement.blur(); });
  await sleep(400);
}
async function screenshot(name) {
  assert(verified, 'Screenshots require a verified isolated native runtime');
  const filename = path.join(media, name);
  await page.screenshot({ path: filename, animations: 'allow' });
  screenshots.push({ path: `docs/media/${name}`, sha256: sha(filename) });
}
async function assertTitle(language) {
  const expected = language === 'en' ? 'Programmer Mixology' : '程序员调酒台';
  await until(async () => await page.title() === expected, 'Document title did not follow the language');
  assert.equal(await page.locator('.pixel-titlebar .app-title').innerText(), expected);
  await until(async () => await call('plugin:window|title', { label: 'main' }) === expected, 'Native window title did not follow the language');
}
async function assertWorkbench(language) {
  await assertTitle(language);
  const state = await call('ui_state_get');
  assert.equal(state.target.taste_bps.reduce((a, b) => a + b, 0), 10000);
  assert(state.target.taste_bps.every(Number.isInteger));
  const layout = await page.evaluate(() => {
    const canvas = document.querySelector('.detailed-canvas canvas');
    const box = canvas.getBoundingClientRect();
    return {
      viewport: { width: innerWidth, height: innerHeight, deviceScale: devicePixelRatio },
      scroll: { width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight },
      modules: document.querySelectorAll('.workspace > .panel').length,
      font: getComputedStyle(document.querySelector('.app')).fontSize,
      fontFamily: getComputedStyle(document.querySelector('.app')).fontFamily,
      pixelFontLoaded: document.fonts.check('15px PixelMix'),
      taste: [...document.querySelectorAll('.taste-number')].map(input => Number(input.value)),
      sensory: [...document.querySelectorAll('.sensory-axis > output')].map(output => output.textContent),
      art: { width: box.width, height: box.height, actualWidth: canvas.width, actualHeight: canvas.height },
      overlays: document.querySelectorAll('.modal-backdrop,.error-banner,.boot-mosaic,.recipe-drawer').length,
      language: document.documentElement.lang,
    };
  });
  geometry.push({ language, ...layout });
  assert.equal(layout.modules, 7);
  assert.equal(layout.font, '15px');
  assert.match(layout.fontFamily, /PixelMix/);
  assert(layout.pixelFontLoaded);
  assert.equal(layout.taste.length, 5);
  assert(layout.taste.every(Number.isInteger));
  assert.equal(layout.taste.reduce((a, b) => a + b, 0), 100);
  assert.equal(layout.overlays, 0);
  assert(layout.art.width > 180 && layout.art.height > 180);
  assert(layout.art.actualWidth > 0 && layout.art.actualHeight > 0);
  assert(layout.scroll.width <= layout.viewport.width && layout.scroll.height <= layout.viewport.height);
}
async function fixture(recipeId) {
  // Choose a real bundled recipe and its actual stored prediction, never synthetic recipe facts.
  assert(verified, 'Refuse test-state writes before diagnostics isolation check');
  await workbenchFocus();
  await sleep(600); // Let the 350 ms UI writer settle before the guarded test fixture.
  const recipe = catalog.recipes.find(item => item.id === recipeId);
  const profile = catalog.profiles.find(item => item.recipe_id === recipeId);
  assert(recipe && profile, `Bundled screenshot recipe/profile missing: ${recipeId}`);
  const state = await call('ui_state_get');
  const next = { ...state, selected: recipeId, locked: [], target: {
    taste_bps: [...profile.taste_preference_bps], sensory_0_10: [...profile.sensory_0_10],
  } };
  await call('ui_state_set', { value: next });
  await page.reload();
  await ready();
  assert.equal((await call('ui_state_get')).selected, recipeId);
  await workbenchFocus();
}
async function openSettings() {
  await page.getByRole('button', { name: /^(打开设置|Open settings)$/ }).click();
  await page.locator('.settings-tabs').waitFor();
}
async function language(value) {
  await openSettings();
  await page.locator('.settings-tabs').getByRole('button', { name: /^(常规|General)$/ }).click();
  await page.locator('.settings-body select').first().selectOption(value);
  await until(async () => (await call('ui_state_get')).settings.language === value, 'Language was not saved to SQLite');
  await assertTitle(value);
  await workbenchFocus();
}

(async () => {
  assert.equal(process.platform, 'win32', 'This check requires the actual Windows debug application');
  assert(fs.existsSync(executable), 'Build the debug EXE first; a release EXE cannot redirect its data');
  pe = JSON.parse(execFileSync('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command',
    "[Console]::OutputEncoding=[Text.UTF8Encoding]::new();$i=Get-Item -LiteralPath $env:PM_TEST_EXECUTABLE;@{version=$i.VersionInfo.ProductVersion;product=$i.VersionInfo.ProductName}|ConvertTo-Json -Compress"],
  { encoding: 'utf8', windowsHide: true, env: { ...process.env, PM_TEST_EXECUTABLE: executable } }).trim());
  assert.equal(pe.version, version, 'The executable is stale; rebuild the requested release version first');
  assert.equal(pe.product, 'Programmer Mixology');
  const { chromium } = playwright();
  fs.mkdirSync(evidence, { recursive: true });
  fs.mkdirSync(media, { recursive: true });
  if (fs.existsSync(dataDir)) assert.equal(fs.readdirSync(dataDir).length, 0,
    'Use a fresh native-data directory. Preserve any prior test data separately before another run.');
  fs.mkdirSync(dataDir, { recursive: true });
  assert(!fs.lstatSync(dataDir).isSymbolicLink(), 'Isolated data directory must not be a junction');
  assert(real(dataDir).startsWith(real(evidence) + path.sep));
  fs.writeFileSync(path.join(dataDir, '.public-release-smoke'), JSON.stringify({ version, runId }));
  port = await freePort();
  const cdp = `http://127.0.0.1:${port}`;
  const runtimeLog = fs.openSync(path.join(evidence, `native-runtime-${runId}.log`), 'a');
  child = spawn(executable, [], {
    cwd: product, windowsHide: true, stdio: ['ignore', runtimeLog, runtimeLog],
    env: { ...process.env, PIXEL_MIX_TEST_DATA_DIR: dataDir,
      WEBVIEW2_USER_DATA_FOLDER: path.join(dataDir, 'WebView2'),
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port} --remote-debugging-address=127.0.0.1` },
  });
  fs.closeSync(runtimeLog);
  exited = new Promise(resolve => child.once('exit', (code, signal) => resolve({ code, signal })));
  child.once('error', error => { failure = String(error); });
  await until(async () => {
    if (child.exitCode !== null) throw Error(`Native process exited early: ${child.exitCode}`);
    const response = await fetch(`${cdp}/json/version`, { signal: AbortSignal.timeout(1500) });
    return response.ok;
  }, 'Isolated WebView2 did not expose its loopback test endpoint', 45000);
  browser = await chromium.connectOverCDP(cdp);
  page = await until(() => browser.contexts().flatMap(context => context.pages()).find(candidate => {
    try { const url = new URL(candidate.url()); return ['tauri.localhost', 'tauri.local'].includes(url.hostname) && !url.searchParams.has('view'); }
    catch { return false; }
  }), 'The native main WebView did not appear', 45000);
  page.setDefaultTimeout(15000);
  page.on('pageerror', error => errors.push(error.message));
  await page.waitForFunction(() => !!window.__TAURI_INTERNALS__);
  call = (command, args = {}) => page.evaluate(({ command, args }) => window.__TAURI_INTERNALS__.invoke(command, args), { command, args });
  const diagnostics = await call('diagnostics');
  assert.equal(real(diagnostics.data_dir), real(dataDir), 'Refuse to operate on any non-test database');
  verified = true;
  await ready();
  catalog = await call('catalog');
  initial = await call('ui_state_get');

  await test('Native 1.2.0 identity, isolated SQLite, defaults and real 396-recipe catalog', async () => {
    assert.equal(diagnostics.version, version);
    assert.equal(diagnostics.platform, 'windows');
    assert.equal(diagnostics.startup_error, null);
    assert.equal(diagnostics.network.running, false);
    assert.equal(diagnostics.model.running, false);
    assert.equal(diagnostics.automatic_model_download, false);
    assert.equal(catalog.recipes.length, 396);
    const group = catalog.dlc_groups.find(group => group.id === 'xiaodong-notes-v1');
    assert(group);
    assert.equal(group.recipe_ids.length, 96);
    assert(group.recipe_ids.every(id => catalog.recipes.some(recipe => recipe.id === id)));
    const library = await call('recipe_library_get');
    assert(!(library.disabled_groups || []).includes(group.id));
    assert.equal(initial.settings.fontScale, 1.25);
    assert.equal(initial.settings.reducedMotion, false);
    assert.equal(initial.settings.startupAnimation, true);
    assert.equal(initial.settings.language, 'en');
    await assertTitle('en');
  });
  await test('Logo holds for 0.4 seconds and all seven native modules complete entry animation', async () => {
    marks = await page.evaluate(() => performance.getEntriesByType('mark').filter(mark => mark.name.startsWith('timer:')).map(mark => ({ name: mark.name, at: mark.startTime, detail: mark.detail })));
    const logo = marks.find(mark => mark.name === 'timer:logo-visible');
    const reveal = marks.find(mark => mark.name === 'timer:workbench-reveal');
    assert(logo && reveal && logo.detail.motion === true);
    assert(reveal.at - logo.at >= 390);
    assert.equal(marks.filter(mark => mark.name.startsWith('timer:module-start:')).length, 7);
    assert.equal(marks.filter(mark => mark.name.startsWith('timer:module-end:')).length, 7);
  });
  await test('Fresh installation defaults to a complete English workbench before any language change', async () => {
    await workbenchFocus();
    await assertWorkbench('en');
    assert.equal(await page.locator('.engine-actions .square-action').first().innerText(), 'Settings');
    assert.equal((await call('ui_state_get')).settings.language, 'en');
  });
  await test('Chinese fixed-size workbench, pixel font and integer taste total; real DLC artwork', async () => {
    await language('zh');
    await fixture('dlc_xd_sunrise_1972');
    await assertWorkbench('zh');
    await screenshot('workbench-zh.png');
  });
  await test('Chinese About panel shows 1.2.0, developer and the actual project link', async () => {
    await openSettings();
    await page.locator('.settings-tabs').getByRole('button', { name: '关于', exact: true }).click();
    const about = page.locator('.about-panel');
    assert.equal(await about.locator('h3').innerText(), '程序员调酒台');
    assert.match(await about.innerText(), /V1\.2\.0/);
    assert.match(await about.innerText(), /UNKNOWNTIMER/);
    assert.equal(await about.locator('a').getAttribute('href'), 'https://github.com/UNKNOWNTIMER/programmer-mixology');
    await page.mouse.move(4, 4);
    await screenshot('about.png');
    await workbenchFocus();
  });
  await test('English UI and native title follow real language setting; no workbench overflow', async () => {
    await language('en');
    await fixture('iba_dry_martini');
    await assertWorkbench('en');
    await screenshot('workbench-en.png');
    await openSettings();
    await page.locator('.settings-tabs').getByRole('button', { name: 'About', exact: true }).click();
    assert.equal(await page.locator('.about-panel h3').innerText(), 'Programmer Mixology');
    assert.match(await page.locator('.about-panel').innerText(), /V1\.2\.0/);
    await workbenchFocus();
  });
  await test('Default-enabled Xiaodong DLC exposes all 96 recipes in the native library', async () => {
    await language('zh');
    await page.getByRole('button', { name: '打开经典酒谱库', exact: true }).click();
    await page.getByTestId('library-tab-custom').click();
    const group = page.getByTestId('library-dlc-group').filter({ has: page.getByText('小董调酒笔记', { exact: true }) });
    assert.equal(await group.getAttribute('data-enabled'), 'true');
    assert.equal(await group.getByTestId('library-dlc-toggle').getAttribute('aria-pressed'), 'true');
    assert.equal(await group.locator('.library-row').count(), 96);
    assert.equal(await group.locator('.library-select:disabled').count(), 0);
    await page.mouse.move(4, 4);
    await screenshot('catalog-dlc.png');
    await workbenchFocus();
  });
  await test('A missing legacy language becomes English without changing recipes or other preferences', async () => {
    assert(verified);
    await workbenchFocus();
    await sleep(600);
    const before = await call('ui_state_get');
    assert.equal(before.settings.language, 'zh');
    const legacy = structuredClone(before);
    delete legacy.settings.language;
    await call('ui_state_set', { value: legacy });
    await page.reload();
    await ready();
    await assertTitle('en');
    const restored = await call('ui_state_get');
    assert.equal(restored.settings.language, 'en');
    delete restored.settings.language;
    assert.deepEqual(restored, legacy);
    await language('zh');
    await page.reload();
    await ready();
    await assertTitle('zh');
    assert.equal((await call('ui_state_get')).settings.language, 'zh');
  });
  await test('Native close button exits the exact isolated process normally', async () => {
    finalDiagnostics = await call('diagnostics');
    assert.equal(real(finalDiagnostics.data_dir), real(dataDir));
    assert.equal(finalDiagnostics.model.running, false);
    assert.equal(finalDiagnostics.network.running, false);
    assert.deepEqual(errors, []);
    await page.locator('.pixel-titlebar').getByRole('button', { name: '关闭窗口', exact: true }).click();
    closedWithButton = true;
    exitResult = await Promise.race([exited, sleep(15000).then(() => null)]);
    assert(exitResult, 'The test process did not exit after the actual close button');
    assert.equal(exitResult.code, 0);
    await until(async () => { try { await fetch(`${cdp}/json/version`, { signal: AbortSignal.timeout(500) }); return false; } catch { return true; } }, 'Test CDP listener remained open after close');
  });
})().catch(error => { failure = String(error.stack || error); console.error(error); process.exitCode = 1; }).finally(async () => {
  // Cleanup uses only the verified isolated UI. Never kill arbitrary application processes.
  if (verified && page && child && child.exitCode === null && !closedWithButton) {
    try {
      await workbenchFocus();
      await page.locator('.pixel-titlebar').getByRole('button', { name: /^(关闭窗口|Close window)$/ }).click();
      closedWithButton = true;
      exitResult = await Promise.race([exited, sleep(10000).then(() => null)]);
    } catch (error) { failure = `${failure || ''}\nCleanup: ${error}`; }
  }
  if (browser) await browser.close().catch(() => {});
  if (child && child.exitCode === null) { process.exitCode = 1; failure = `${failure || ''}\nTest process ${child.pid} remains running; inspect the isolated process before retrying.`; }
  fs.mkdirSync(evidence, { recursive: true });
  fs.writeFileSync(path.join(evidence, `native-smoke-${runId}.json`), JSON.stringify({
    version, runId, executableSha256: fs.existsSync(executable) ? sha(executable) : null, pe,
    scope: 'Real Windows debug EXE, WebView2, native IPC and isolated SQLite. Screenshots are actual application output. No production-data or installer acceptance claim.',
    pid: child?.pid, port, verified, closedWithButton, exitResult, results, errors, failure, geometry, screenshots, marks,
    catalogCount: catalog?.recipes.length, dlcCount: catalog?.dlc_groups?.[0]?.recipe_ids.length,
  }, null, 2) + '\n');
  console.log(`${results.filter(result => result.pass).length}/${results.length} checks passed`);
});
