/** F1-style hybrid V6 drivetrain: torque curve, 8 gears, auto-shift, RPM model. */

const TORQUE_CURVE: [number, number][] = [
  [0, 250], [3800, 380], [7000, 480], [10500, 520], [12000, 460], [13000, 360],
];
export const IDLE_RPM = 3800;
export const LIMITER_RPM = 12500;
const SHIFT_UP_RPM = 12000;
const SHIFT_DOWN_RPM = 8500;
const SHIFT_CUT_MS = 80;
const MIN_SHIFT_GAP_MS = 280;

export const GEAR_RATIOS = [2.85, 2.28, 1.9, 1.62, 1.4, 1.23, 1.09, 0.96];
export const FINAL_DRIVE = 3.6;
export const WHEEL_RADIUS = 0.33;
const EFFICIENCY = 0.92;

function curveTorque(rpm: number): number {
  if (rpm <= TORQUE_CURVE[0][0]) return TORQUE_CURVE[0][1];
  for (let i = 1; i < TORQUE_CURVE.length; i++) {
    if (rpm <= TORQUE_CURVE[i][0]) {
      const [r0, t0] = TORQUE_CURVE[i - 1];
      const [r1, t1] = TORQUE_CURVE[i];
      return t0 + ((t1 - t0) * (rpm - r0)) / (r1 - r0);
    }
  }
  return TORQUE_CURVE[TORQUE_CURVE.length - 1][1];
}

export class Drivetrain {
  gear = 1;            // 1..8 (display); 0 = reverse handled by Vehicle
  rpm = IDLE_RPM;
  private shiftCutUntil = 0;
  private lastShiftAt = 0;
  private timeMs = 0;
  onShift: ((gear: number) => void) | null = null;

  /**
   * @param wheelSpeed rear wheel forward speed (m/s, signed)
   * @param throttle 0..1
   * @returns drive force (N) to apply at the rear axle contact patches (total)
   */
  update(dtMs: number, wheelSpeed: number, throttle: number): number {
    this.timeMs += dtMs;
    const ratio = GEAR_RATIOS[this.gear - 1] * FINAL_DRIVE;
    const wheelRpm = (Math.max(wheelSpeed, 0) / WHEEL_RADIUS) * (60 / (2 * Math.PI));
    let rpm = wheelRpm * ratio;

    // clutch-slip blend at launch so the engine revs from standstill
    if (wheelSpeed < 12 && this.gear === 1) {
      rpm = Math.max(rpm, IDLE_RPM + throttle * 5200);
    }
    rpm = Math.max(IDLE_RPM, Math.min(LIMITER_RPM + 200, rpm));
    this.rpm = rpm;

    // auto shift
    if (this.timeMs - this.lastShiftAt > MIN_SHIFT_GAP_MS) {
      if (rpm >= SHIFT_UP_RPM && this.gear < GEAR_RATIOS.length) this.shift(this.gear + 1);
      else if (rpm < SHIFT_DOWN_RPM && this.gear > 1) {
        // only downshift if the lower gear won't exceed the limiter
        const nextRpm = (rpm / ratio) * GEAR_RATIOS[this.gear - 2] * FINAL_DRIVE;
        if (nextRpm < SHIFT_UP_RPM - 400) this.shift(this.gear - 1);
      }
    }

    let torque = curveTorque(rpm) * throttle;
    if (rpm >= LIMITER_RPM) torque = 0;                      // limiter
    if (this.timeMs < this.shiftCutUntil) torque *= 0.1;     // shift torque cut
    return (torque * ratio * EFFICIENCY) / WHEEL_RADIUS;
  }

  private shift(to: number): void {
    this.gear = to;
    this.lastShiftAt = this.timeMs;
    this.shiftCutUntil = this.timeMs + SHIFT_CUT_MS;
    this.onShift?.(to);
  }

  reset(): void {
    this.gear = 1;
    this.rpm = IDLE_RPM;
    this.shiftCutUntil = 0;
    this.lastShiftAt = 0;
  }
}
