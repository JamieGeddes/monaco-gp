/** Audio test: engine synth must run, track RPM (f0 rises with revs), and mute on pause. */
import { chromium } from 'playwright';

const base = process.argv[2] ?? 'http://localhost:5173';
const browser = await chromium.launch({
  channel: 'chrome', headless: true,
  args: ['--use-angle=metal', '--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const fail = (msg) => { console.log(`FAIL: ${msg}`); process.exitCode = 1; };
const ok = (msg) => console.log(`ok: ${msg}`);

await page.goto(`${base}/?debug`);
await page.click('#startBtn');
await page.waitForSelector('#startScreen.hidden', { timeout: 60000, state: 'attached' });

let a = (await page.evaluate(() => window.__car.state())).audio;
if (!a) { fail('no audio object'); process.exit(1); }
if (a.state !== 'running') fail(`AudioContext not running: ${a.state}`); else ok('AudioContext running');

await page.waitForSelector('#startLights.hidden', { timeout: 15000, state: 'attached' });
await page.waitForTimeout(500);
const idle = (await page.evaluate(() => window.__car.state())).audio;
ok(`idle: f0=${idle.f0} Hz, master=${idle.master}, lowpass=${idle.lowpass}`);
if (idle.master < 0.3) fail('master gain too low while racing');

await page.keyboard.down('KeyW');
await page.waitForTimeout(2500);
const revving = (await page.evaluate(() => window.__car.state())).audio;
ok(`revving: f0=${revving.f0} Hz, lowpass=${revving.lowpass}`);
if (revving.f0 < idle.f0 + 80) fail(`f0 did not rise with RPM (${idle.f0} -> ${revving.f0})`);
else ok('engine pitch tracks RPM');
if (revving.lowpass < idle.lowpass + 1000) fail('lowpass did not open with throttle');
else ok('timbre opens with throttle');

await page.keyboard.up('KeyW');
await page.keyboard.press('Escape');
await page.waitForTimeout(500);
const paused = (await page.evaluate(() => window.__car.state())).audio;
if (paused.master > 0.05) fail(`not muted in pause (master=${paused.master})`); else ok('muted in pause');

console.log('audio test done');
await browser.close();
