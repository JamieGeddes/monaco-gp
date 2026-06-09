import { SfLine } from '../track/TrackData';

/**
 * Lap timing via direction-aware 2D segment-crossing of the start/finish line.
 * The clock starts on the FIRST forward crossing and resets to zero on each
 * subsequent one. Reverse crossings disarm so wiggling across can't farm laps.
 */
export class LapTimer {
  currentMs: number | null = null; // null until first crossing
  lastMs: number | null = null;
  bestMs: number | null = null;

  private prevX = 0;
  private prevZ = 0;
  private hasPrev = false;
  private armed = 0; // <0 after a reverse crossing

  constructor(private sf: SfLine) {}

  reset(): void {
    this.currentMs = null;
    this.lastMs = null;
    this.bestMs = null;
    this.hasPrev = false;
    this.armed = 0;
  }

  /** Advance the running clock (call only while racing, with unpaused dt). */
  tick(dtMs: number): void {
    if (this.currentMs !== null) this.currentMs += dtMs;
  }

  /** Check for an SF crossing between the previous and current car position. */
  update(x: number, z: number): void {
    if (!this.hasPrev) {
      this.prevX = x; this.prevZ = z; this.hasPrev = true;
      return;
    }
    const { ax, az, bx, bz, fx, fz } = this.sf;
    const o = (px: number, pz: number, qx: number, qz: number, rx: number, rz: number) =>
      (qx - px) * (rz - pz) - (qz - pz) * (rx - px);
    const o1 = o(this.prevX, this.prevZ, x, z, ax, az);
    const o2 = o(this.prevX, this.prevZ, x, z, bx, bz);
    const o3 = o(ax, az, bx, bz, this.prevX, this.prevZ);
    const o4 = o(ax, az, bx, bz, x, z);

    if (o1 * o2 < 0 && o3 * o4 < 0) {
      const forward = (x - this.prevX) * fx + (z - this.prevZ) * fz > 0;
      if (!forward) {
        this.armed--;
      } else if (this.armed < 0) {
        this.armed++;
      } else {
        // sub-frame correction: fraction of the motion segment before the line
        const frac = Math.abs(o3) / (Math.abs(o3) + Math.abs(o4) || 1);
        const overshootMs = 0; // resolution: caller ticks before update; frac refines below
        if (this.currentMs === null) {
          this.currentMs = 0;
        } else {
          // time spent past the line this frame belongs to the new lap
          const dtPortion = this.lastFrameDtMs * (1 - frac);
          const lap = this.currentMs - dtPortion + overshootMs;
          this.lastMs = lap;
          if (this.bestMs === null || lap < this.bestMs) this.bestMs = lap;
          this.currentMs = dtPortion;
        }
      }
    }
    this.prevX = x;
    this.prevZ = z;
  }

  private lastFrameDtMs = 16.7;
  setFrameDt(dtMs: number): void { this.lastFrameDtMs = dtMs; }
}

export function formatLapTime(ms: number | null): string {
  if (ms === null) return '–:––.–––';
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const milli = Math.floor(ms % 1000);
  return `${m}:${String(s).padStart(2, '0')}.${String(milli).padStart(3, '0')}`;
}
