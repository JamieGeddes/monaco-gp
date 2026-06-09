/** Dense telemetry: sample car vs road height every 150 ms while accelerating. */
import { chromium } from 'playwright';

const url = (process.argv[2] ?? 'http://localhost:5173') + '/?debug';
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (err) => console.log('PAGEERROR', err.message));
page.on('console', (msg) => {
  if (msg.type() === 'error' || msg.type() === 'warning') console.log(`CONSOLE[${msg.type()}]`, msg.text().slice(0, 200));
});

await page.goto(url);
await page.click('#startBtn');
await page.waitForSelector('#startScreen.hidden', { timeout: 60000, state: 'attached' });

// sample during the light sequence too (car should settle on the grid)
for (let i = 0; i < 5; i++) {
  await page.waitForTimeout(400);
  const s = await page.evaluate(() => window.__car.state());
  console.log(`GRID  carY=${s.carY.toFixed(2)} roadY=${s.roadY.toFixed(2)} gnd=${s.grounded}`);
}
await page.waitForSelector('#startLights.hidden', { timeout: 15000, state: 'attached' });

await page.keyboard.down('KeyW');
for (let i = 0; i < 30; i++) {
  await page.waitForTimeout(150);
  const s = await page.evaluate(() => window.__car.state());
  console.log(
    `s=${String(s.s).padStart(5)} carY=${s.carY.toFixed(2).padStart(7)} roadY=${s.roadY.toFixed(2).padStart(6)} ` +
    `gap=${(s.carY - s.roadY).toFixed(2).padStart(6)} v=${String(s.v).padStart(6)} gnd=${s.grounded} comp=[${s.wheels.join(',')}]`,
  );
}
await browser.close();
