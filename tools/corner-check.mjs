/** Verify G-effects remain active in clean cornering (autopilot through Ste Devote–hairpin). */
import { chromium } from 'playwright';
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await page.goto('http://localhost:5173/?debug&auto');
await page.click('#startBtn');
await page.waitForSelector('#startScreen.hidden', { timeout: 60000, state: 'attached' });
await page.waitForSelector('#startLights.hidden', { timeout: 15000, state: 'attached' });
let maxLean = 0, samples = 0, crossed = false;
for (let i = 0; i < 500; i++) {
  await page.waitForTimeout(100);
  const c = await page.evaluate(() => window.__car.state());
  if (!crossed) { if (c.s < 150) crossed = true; continue; }
  if (c.s > 1600) break;
  if (c.s > 200) { maxLean = Math.max(maxLean, Math.abs(c.camX)); samples++; }
}
console.log(`corner section samples=${samples}, max |camX lean|=${(maxLean * 1000).toFixed(1)}mm`);
console.log(maxLean > 0.02 ? 'ok: G-effect lean active in corners' : 'FAIL: G-effects appear dead');
await browser.close();
