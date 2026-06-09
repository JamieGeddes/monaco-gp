/** Game-flow test: light sequence gating, pause freeze, resume, restart. */
import { chromium } from 'playwright';

const base = process.argv[2] ?? 'http://localhost:5173';
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const fail = (msg) => { console.log(`FAIL: ${msg}`); process.exitCode = 1; };
const ok = (msg) => console.log(`ok: ${msg}`);

await page.goto(`${base}/?debug`);
await page.click('#startBtn');
await page.waitForSelector('#startScreen.hidden', { timeout: 60000, state: 'attached' });

// 1. throttle gated during lights: hold W during the sequence, car must not move
await page.keyboard.down('KeyW');
await page.waitForTimeout(3500); // mid-sequence
let c = await page.evaluate(() => window.__car.state());
if (c.v > 2) fail(`car moved during light sequence (v=${c.v})`); else ok('throttle gated until lights out');

// lights-out timing: 0.8 + 5x1.0 + (1..3) + ~0 -> between ~6.8 and ~8.8 s total
await page.waitForSelector('#startLights.hidden', { timeout: 15000, state: 'attached' });
await page.waitForTimeout(1200);
c = await page.evaluate(() => window.__car.state());
if (c.v < 10) fail(`car did not accelerate after lights out (v=${c.v})`); else ok(`accelerates after lights out (v=${c.v})`);

// 2. pause freezes physics and lap clock
await page.keyboard.press('Escape');
await page.waitForTimeout(300);
const pauseVisible = await page.evaluate(() => !document.getElementById('pauseScreen').classList.contains('hidden'));
if (!pauseVisible) fail('pause screen not shown'); else ok('pause screen shown');
const v1 = (await page.evaluate(() => window.__car.state())).v;
const lap1 = (await page.evaluate(() => window.__car.state())).lap;
await page.waitForTimeout(1500);
c = await page.evaluate(() => window.__car.state());
if (Math.abs(c.v - v1) > 1) fail(`physics not frozen in pause (v ${v1} -> ${c.v})`); else ok('physics frozen in pause');
if (c.lap !== lap1) fail(`lap clock ran during pause (${lap1} -> ${c.lap})`); else ok('lap clock frozen in pause');

// 3. resume
await page.keyboard.press('Escape');
await page.waitForTimeout(1000);
c = await page.evaluate(() => window.__car.state());
ok(`resumed (v=${c.v})`);

// 4. restart returns to grid + re-runs lights
await page.keyboard.press('KeyR');
await page.waitForTimeout(1500);
const lightsVisible = await page.evaluate(() => !document.getElementById('startLights').classList.contains('hidden'));
if (!lightsVisible) fail('lights not re-shown after restart'); else ok('restart re-runs light sequence');
c = await page.evaluate(() => window.__car.state());
if (c.s > 3320 - 25 || c.s < 5) ok(`car back at grid (s=${c.s})`); else fail(`car not at grid (s=${c.s})`);
if (c.lap !== null) fail('lap timer not reset on restart'); else ok('lap timer reset on restart');

console.log('flow test done');
await browser.close();
