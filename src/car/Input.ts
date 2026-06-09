/** Keyboard state with rate-limited shaping so digital keys drive an analog car. */
export class Input {
  // shaped values
  throttle = 0;       // 0..1
  brake = 0;          // 0..1
  steer = 0;          // -1..1 (positive = right)

  private keys = new Set<string>();
  onPause: (() => void) | null = null;
  onRestart: (() => void) | null = null;
  onAnyKey: (() => void) | null = null;

  constructor() {
    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.onAnyKey?.();
      if (e.code === 'Escape') { this.onPause?.(); return; }
      if (e.code === 'KeyR') { this.onRestart?.(); return; }
      this.keys.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
  }

  get throttleHeld(): boolean { return this.keys.has('KeyW') || this.keys.has('ArrowUp'); }
  get brakeHeld(): boolean { return this.keys.has('KeyS') || this.keys.has('ArrowDown'); }

  /** dt in seconds; speed in m/s for speed-sensitive steering rate. */
  update(dt: number): void {
    const tTarget = this.throttleHeld ? 1 : 0;
    const bTarget = this.brakeHeld ? 1 : 0;
    const ramp = (cur: number, target: number, rise: number, fall: number) => {
      if (target > cur) return Math.min(target, cur + rise * dt);
      return Math.max(target, cur - fall * dt);
    };
    this.throttle = ramp(this.throttle, tTarget, 5, 8);
    this.brake = ramp(this.brake, bTarget, 5, 8);

    const left = this.keys.has('KeyA') || this.keys.has('ArrowLeft');
    const right = this.keys.has('KeyD') || this.keys.has('ArrowRight');
    const sTarget = (right ? 1 : 0) - (left ? 1 : 0);
    if (sTarget !== 0) {
      const rate = Math.sign(sTarget) === Math.sign(this.steer) || this.steer === 0 ? 3.0 : 7.5;
      this.steer = Math.max(-1, Math.min(1, this.steer + sTarget * rate * dt));
    } else {
      // recenter
      const d = 4.5 * dt;
      this.steer = Math.abs(this.steer) <= d ? 0 : this.steer - Math.sign(this.steer) * d;
    }
  }

  reset(): void {
    this.throttle = 0;
    this.brake = 0;
    this.steer = 0;
  }
}
