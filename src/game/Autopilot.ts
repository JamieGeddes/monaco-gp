import { Vector3 } from '@babylonjs/core';
import { Vehicle } from '../car/Vehicle';
import { TrackData } from '../track/TrackData';

const LAT_ACCEL = 15;    // m/s^2 cornering budget
const BRAKE_ACCEL = 20;  // m/s^2 braking budget
const SCAN_AHEAD = 320;  // m
const SCAN_STEP = 8;     // m

/**
 * Debug-mode autopilot: pure-pursuit steering toward a speed-scaled lookahead
 * point plus curvature-limited speed planning. Drives through the same control
 * inputs as the player, so it exercises the full physics for lap validation.
 */
export class Autopilot {
  private steerState = 0;

  constructor(private track: TrackData, private vehicle: Vehicle) {}

  /** Returns control values; caller applies them to the vehicle. */
  update(s: number, dt: number): { steer: number; throttle: number; brake: number } {
    const v = Math.max(this.vehicle.speed, 0);

    // --- steering: chase a lookahead point on the centerline
    const look = Math.min(Math.max(v * 0.5, 7), 40);
    const target = this.track.pointAt(s + look).pos;
    const pos = this.vehicle.root.position;
    const fwd = Vector3.TransformNormal(Vector3.Forward(), this.vehicle.root.getWorldMatrix());
    const dx = target.x - pos.x, dz = target.z - pos.z;
    const err = Math.atan2(
      fwd.x * dz - fwd.z * dx, // sin of angle (positive = target to the left)
      fwd.x * dx + fwd.z * dz,
    );
    const steerTarget = Math.max(-1, Math.min(1, -err * 2.4));
    const rate = 4.0 * dt;
    this.steerState += Math.max(-rate, Math.min(rate, steerTarget - this.steerState));

    // --- speed planning: slowest constraint within braking range
    let vTarget = Infinity;
    for (let d = 0; d <= SCAN_AHEAD; d += SCAN_STEP) {
      const k = this.track.maxCurvature(s + d, SCAN_STEP);
      const vCorner = Math.sqrt(LAT_ACCEL / Math.max(k, 1e-5));
      const vHere = Math.sqrt(vCorner * vCorner + 2 * BRAKE_ACCEL * d);
      vTarget = Math.min(vTarget, vHere);
    }

    let throttle = 0, brake = 0;
    if (v < vTarget - 1.5) throttle = 1;
    else if (v > vTarget + 1.5) brake = Math.min((v - vTarget) / 6, 1);

    return { steer: this.steerState, throttle, brake };
  }

  reset(): void { this.steerState = 0; }
}
