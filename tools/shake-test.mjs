/**
 * Camera shake measurement: samples the camera's G-effect offsets at the grid
 * (car at rest) and during a deliberate wall scrape. Reports per-sample deltas —
 * the metric that shows up as visible vibration.
 */
import { chromium } from 'playwright';

const base = process.argv[2] ?? 'http://localhost:5173';
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (err) => console.log('PAGEERROR', err.message));

await page.goto(`${base}/?debug`);
await page.click('#startBtn');
await page.waitForSelector('#startScreen.hidden', { timeout: 60000, state: 'attached' });
await page.waitForTimeout(2500); // mid light sequence, car at rest on grid

async function sample(label, n, gapMs) {
  const xs = [], pitches = [], lats = [];
  for (let i = 0; i < n; i++) {
    await page.waitForTimeout(gapMs);
    const c = await page.evaluate(() => window.__car.state());
    xs.push(c.camX); pitches.push(c.camPitch); lats.push(c.latAccel);
  }
  const deltas = xs.slice(1).map((v, i) => Math.abs(v - xs[i]));
  const pDeltas = pitches.slice(1).map((v, i) => Math.abs(v - pitches[i]));
  const maxD = Math.max(...deltas), maxP = Math.max(...pDeltas);
  const maxLat = Math.max(...lats.map(Math.abs));
  console.log(`${label}: camX maxDelta=${(maxD * 1000).toFixed(2)}mm  pitch maxDelta=${(maxP * 1000).toFixed(2)}mrad  |latAccel|max=${maxLat.toFixed(2)}`);
  return { maxD, maxP };
}

await sample('GRID (at rest)   ', 30, 60);

await page.waitForSelector('#startLights.hidden', { timeout: 15000, state: 'attached' });
await page.keyboard.down('KeyW');
await page.waitForTimeout(3000);
await page.keyboard.down('KeyD'); // drive into the right wall
await page.waitForTimeout(900);
await page.keyboard.up('KeyD');
await sample('WALL SCRAPE      ', 30, 60);

await browser.close();
