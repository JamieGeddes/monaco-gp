/** Debug run: top-down camera, hold throttle, screenshot every second + telemetry. */
import { chromium } from 'playwright';

const url = (process.argv[2] ?? 'http://localhost:5173') + '/?debug';
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (err) => errors.push(err.message));

await page.goto(url);
await page.click('#startBtn');
await page.waitForSelector('#startScreen.hidden', { timeout: 60000, state: 'attached' });
await page.waitForSelector('#startLights.hidden', { timeout: 15000, state: 'attached' });

await page.keyboard.press('KeyC'); // top-down camera
await page.keyboard.down('KeyW');
for (let i = 1; i <= 6; i++) {
  await page.waitForTimeout(1000);
  await page.screenshot({ path: `/tmp/topdown-${i}.png` });
  const telemetry = await page.textContent('#fps');
  console.log(`t=${i}s  ${telemetry}`);
}
if (errors.length) console.log('ERRORS:', errors.slice(0, 5));
await browser.close();
