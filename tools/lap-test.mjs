/**
 * Full-lap validation: autopilot drives the circuit; logs s/speed/grounded every
 * second, screenshots at landmarks, reports lap times. Fails loudly if the car
 * stops making progress (stuck/crashed/escaped).
 */
import { chromium } from 'playwright';

const base = process.argv[2] ?? 'http://localhost:5173';
const laps = Number(process.argv[3] ?? 1);
const cockpitView = process.argv.includes('--cockpit');

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (err) => console.log('PAGEERROR', err.message));

await page.goto(`${base}/?debug&auto`);
await page.click('#startBtn');
await page.waitForSelector('#startScreen.hidden', { timeout: 60000, state: 'attached' });
await page.waitForSelector('#startLights.hidden', { timeout: 15000, state: 'attached' });
if (!cockpitView) await page.keyboard.press('KeyC'); // top-down

// landmark s-values for screenshots (from build output)
const shots = [
  [256, 'steDevote'], [944, 'casino'], [1302, 'hairpin'], [1800, 'tunnel'],
  [2134, 'chicane'], [2572, 'piscine'], [2962, 'rascasse'],
];
const taken = new Set();

let lastS = -1, stuckCount = 0, lapsDone = 0, prevLastLap = null, maxT = 60 + laps * 130;
for (let t = 0; t < maxT; t++) {
  await page.waitForTimeout(1000);
  const c = await page.evaluate(() => window.__car.state());
  console.log(
    `t=${String(t).padStart(3)} s=${String(c.s).padStart(5)} v=${String(c.v).padStart(6)} gnd=${c.grounded} ` +
    `fps=${c.fps} lap=${c.lap === null ? '--' : (c.lap / 1000).toFixed(1)} last=${c.lastLap === null ? '--' : (c.lastLap / 1000).toFixed(2)}`,
  );
  for (const [s, name] of shots) {
    if (!taken.has(name) && Math.abs(c.s - s) < 60) {
      taken.add(name);
      await page.screenshot({ path: `/tmp/lap-${name}.png` });
    }
  }
  if (c.lastLap !== null && c.lastLap !== prevLastLap) {
    prevLastLap = c.lastLap;
    lapsDone++;
    console.log(`LAP ${lapsDone} COMPLETE: ${(c.lastLap / 1000).toFixed(3)}s (best ${(c.bestLap / 1000).toFixed(3)})`);
    if (lapsDone >= laps) break;
  }
  if (Math.abs(c.s - lastS) < 3 && c.v < 5) {
    if (++stuckCount > 6) { console.log('STUCK — aborting'); await page.screenshot({ path: '/tmp/lap-stuck.png' }); break; }
  } else stuckCount = 0;
  lastS = c.s;
}
const final = await page.evaluate(() => window.__car.state());
console.log('RESULT', JSON.stringify({ lastLap: final.lastLap, bestLap: final.bestLap }));
await browser.close();
