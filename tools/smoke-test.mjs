/**
 * Headless smoke test: loads the game, clicks Race, waits through the light
 * sequence, holds throttle, and screenshots along the way. Reports console
 * errors and the car's speed/lap state.
 *
 * Usage: node tools/smoke-test.mjs [url] [outPrefix]
 */
import { chromium } from 'playwright';

const url = process.argv[2] ?? 'http://localhost:5173';
const prefix = process.argv[3] ?? '/tmp/monaco';

const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });

const errors = [];
page.on('console', (msg) => {
  if (msg.type() === 'error') errors.push(msg.text());
});
page.on('pageerror', (err) => errors.push(`PAGEERROR: ${err.message}`));

await page.goto(url);
await page.waitForTimeout(1500);
await page.screenshot({ path: `${prefix}-1-menu.png` });

await page.click('#startBtn');
// wait for start screen to vanish (init complete)
await page.waitForSelector('#startScreen.hidden', { timeout: 60000, state: 'attached' });
await page.waitForTimeout(2500); // mid light sequence
await page.screenshot({ path: `${prefix}-2-lights.png` });

// wait for lights out (gantry hidden again): up to 5+3+1 s
await page.waitForSelector('#startLights.hidden', { timeout: 15000, state: 'attached' });

// hold throttle for 5 s
await page.keyboard.down('KeyW');
await page.waitForTimeout(2500);
await page.screenshot({ path: `${prefix}-3-accel.png` });
await page.waitForTimeout(2500);
await page.screenshot({ path: `${prefix}-4-fast.png` });

const speed1 = await page.textContent('#speed');

// brake + steer
await page.keyboard.up('KeyW');
await page.keyboard.down('KeyS');
await page.waitForTimeout(1500);
await page.screenshot({ path: `${prefix}-5-brake.png` });
await page.keyboard.up('KeyS');
await page.keyboard.down('KeyA');
await page.keyboard.down('KeyW');
await page.waitForTimeout(1000);
await page.screenshot({ path: `${prefix}-6-steer.png` });

const speed2 = await page.textContent('#speed');
const gear = await page.textContent('#gear');
const lap = await page.textContent('#lapCurrent');

console.log(JSON.stringify({ speedAfterAccel: speed1, speedLater: speed2, gear, lap, errors: errors.slice(0, 12) }, null, 2));
await browser.close();
