import { LIMITER_RPM } from '../car/Drivetrain';
import { formatLapTime, LapTimer } from '../game/LapTimer';

/** DOM-overlay HUD: lap times (top right), gear / RPM bar / speed (bottom center). */
export class Hud {
  private hud = document.getElementById('hud')!;
  private lapCurrent = document.getElementById('lapCurrent')!;
  private lapLast = document.getElementById('lapLast')!;
  private lapBest = document.getElementById('lapBest')!;
  private gearEl = document.getElementById('gear')!;
  private speedEl = document.getElementById('speed')!;
  private rpmFill = document.getElementById('rpmFill')!;
  private rpmBar = document.getElementById('rpmBar')!;

  private lastGear = '';
  private lastSpeed = -1;
  private lastRpmPct = -1;
  private lastCurrent = '';
  private lastLast = '';
  private lastBest = '';

  show(visible: boolean): void {
    this.hud.classList.toggle('hidden', !visible);
  }

  update(gear: string, rpm: number, speedKmh: number, laps: LapTimer): void {
    if (gear !== this.lastGear) { this.gearEl.textContent = gear; this.lastGear = gear; }

    const speed = Math.round(speedKmh);
    if (speed !== this.lastSpeed) { this.speedEl.textContent = String(speed); this.lastSpeed = speed; }

    const pct = Math.round(Math.min(rpm / LIMITER_RPM, 1) * 100);
    if (pct !== this.lastRpmPct) {
      (this.rpmFill as HTMLElement).style.width = `${pct}%`;
      this.rpmBar.classList.toggle('limiter', pct >= 97);
      this.lastRpmPct = pct;
    }

    const cur = formatLapTime(laps.currentMs !== null ? Math.floor(laps.currentMs / 10) * 10 : null);
    if (cur !== this.lastCurrent) { this.lapCurrent.textContent = cur === '–:––.–––' ? '0:00.000' : cur; this.lastCurrent = cur; }
    const last = formatLapTime(laps.lastMs);
    if (last !== this.lastLast) { this.lapLast.textContent = last; this.lastLast = last; }
    const best = formatLapTime(laps.bestMs);
    if (best !== this.lastBest) { this.lapBest.textContent = best; this.lastBest = best; }
  }
}
