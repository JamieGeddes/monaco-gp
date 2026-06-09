import { Vector3 } from '@babylonjs/core';
import trackJson from '../data/monaco.json';

export interface TrackPoint {
  x: number; y: number; z: number;
  nx: number; nz: number; // left normal (unit, horizontal)
  wl: number; wr: number; // half-widths
  s: number;
}

export interface SfLine { ax: number; az: number; bx: number; bz: number; fx: number; fz: number }
export interface GridPose { x: number; y: number; z: number; heading: number }

/** Parsed monaco.json plus interpolation/progress helpers. */
export class TrackData {
  readonly points: TrackPoint[];
  readonly length: number;
  readonly spacing: number;
  readonly tunnel: [number, number];
  readonly kerbs: [number, number][];
  readonly sf: SfLine;
  readonly grid: GridPose;
  readonly landmarks: Record<string, number>;
  /** |curvature| (1/m) per point, lightly smoothed — used by the debug autopilot. */
  readonly curvature: number[];

  constructor() {
    const j = trackJson as unknown as {
      length: number; spacing: number; points: number[][];
      tunnel: [number, number]; kerbs: [number, number][];
      sf: SfLine; grid: GridPose; landmarks: Record<string, number>;
    };
    this.length = j.length;
    this.spacing = j.spacing;
    this.points = j.points.map((p, i) => ({
      x: p[0], y: p[1], z: p[2], nx: p[3], nz: p[4], wl: p[5], wr: p[6], s: i * j.spacing,
    }));
    this.tunnel = j.tunnel;
    this.kerbs = j.kerbs;
    this.sf = j.sf;
    this.grid = j.grid;
    this.landmarks = j.landmarks;

    const n = this.points.length;
    const raw = this.points.map((_, i) => {
      const a = this.at(i - 1), b = this.at(i), c = this.at(i + 1);
      const v1x = b.x - a.x, v1z = b.z - a.z, v2x = c.x - b.x, v2z = c.z - b.z;
      const ang = Math.atan2(v1x * v2z - v1z * v2x, v1x * v2x + v1z * v2z);
      return Math.abs(ang) / this.spacing;
    });
    this.curvature = raw.map((_, i) => {
      let sum = 0;
      for (let k = -3; k <= 3; k++) sum += raw[((i + k) % n + n) % n];
      return sum / 7;
    });
  }

  /** Max |curvature| over the window [s, s+dist]. */
  maxCurvature(s: number, dist: number): number {
    const i0 = Math.floor(s / this.spacing);
    const steps = Math.ceil(dist / this.spacing);
    let m = 0;
    for (let k = 0; k <= steps; k++) m = Math.max(m, this.curvature[(i0 + k) % this.count]);
    return m;
  }

  get count(): number { return this.points.length; }

  at(i: number): TrackPoint { return this.points[((i % this.count) + this.count) % this.count]; }

  /** Interpolated centerline pose at arclength s. */
  pointAt(s: number): { pos: Vector3; nx: number; nz: number; wl: number; wr: number } {
    const ss = ((s % this.length) + this.length) % this.length;
    const f = ss / this.spacing;
    const i0 = Math.floor(f), t = f - i0;
    const a = this.at(i0), b = this.at(i0 + 1);
    const nx = a.nx + (b.nx - a.nx) * t, nz = a.nz + (b.nz - a.nz) * t;
    const nl = Math.hypot(nx, nz) || 1;
    return {
      pos: new Vector3(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, a.z + (b.z - a.z) * t),
      nx: nx / nl, nz: nz / nl,
      wl: a.wl + (b.wl - a.wl) * t,
      wr: a.wr + (b.wr - a.wr) * t,
    };
  }

  /** True if arclength s lies within wrapped range [s0, s1]. */
  inRange(s: number, s0: number, s1: number): boolean {
    const ss = ((s % this.length) + this.length) % this.length;
    return s0 <= s1 ? ss >= s0 && ss <= s1 : ss >= s0 || ss <= s1;
  }
}

/** Tracks the car's arclength position incrementally (cheap nearest-point search around last index). */
export class TrackProgress {
  private idx: number;
  constructor(private track: TrackData, startS: number) {
    this.idx = Math.round(startS / track.spacing) % track.count;
  }
  update(x: number, z: number): number {
    const n = this.track.count;
    let best = Infinity, bestI = this.idx;
    for (let d = -40; d <= 40; d++) {
      const i = (((this.idx + d) % n) + n) % n;
      const p = this.track.points[i];
      const dd = (p.x - x) ** 2 + (p.z - z) ** 2;
      if (dd < best) { best = dd; bestI = i; }
    }
    this.idx = bestI;
    return bestI * this.track.spacing;
  }
  reset(s: number): void {
    this.idx = Math.round(s / this.track.spacing) % this.track.count;
  }
}
