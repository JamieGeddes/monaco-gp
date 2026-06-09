/**
 * Offline track builder: converts the Monaco GeoJSON centerline + hand-authored
 * control points (data-src/) into src/data/monaco.json consumed at runtime.
 *
 * Run: npm run track
 * Also emits tools/track-preview.svg for visual validation against the real circuit map.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// ---------- types ----------
interface Vec2 { x: number; z: number }
interface LandmarkRef { at: string; ds?: number }

const SPACING = 2; // meters between output points
const SMOOTH_PASSES = 3;

// ---------- load inputs ----------
const geo = JSON.parse(readFileSync(join(ROOT, 'data-src/mc-1929.geojson'), 'utf8'));
const landmarksRaw: Record<string, { lon: number; lat: number }> = JSON.parse(
  readFileSync(join(ROOT, 'data-src/landmarks.json'), 'utf8'),
);
delete (landmarksRaw as Record<string, unknown>)._comment;
const elevationCfg = JSON.parse(readFileSync(join(ROOT, 'data-src/elevation-points.json'), 'utf8'));
const widthCfg = JSON.parse(readFileSync(join(ROOT, 'data-src/width-points.json'), 'utf8'));
const featuresCfg = JSON.parse(readFileSync(join(ROOT, 'data-src/features.json'), 'utf8'));

// ---------- projection (equirectangular at Monaco; cm-accurate over ~1 km) ----------
const LON0 = 7.4206;
const LAT0 = 43.7347;
const M_PER_DEG_LON = 111320 * Math.cos((LAT0 * Math.PI) / 180);
const M_PER_DEG_LAT = 110574;
const project = (lon: number, lat: number): Vec2 => ({
  x: (lon - LON0) * M_PER_DEG_LON,
  z: (lat - LAT0) * M_PER_DEG_LAT,
});

let raw: Vec2[] = (geo.features[0].geometry.coordinates as [number, number][]).map(([lon, lat]) =>
  project(lon, lat),
);
// drop duplicated closing point
const d2 = (a: Vec2, b: Vec2) => (a.x - b.x) ** 2 + (a.z - b.z) ** 2;
if (d2(raw[0], raw[raw.length - 1]) < 1) raw = raw.slice(0, -1);

// ---------- ensure clockwise = Monaco driving direction ----------
const signedArea = (pts: Vec2[]) => {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], q = pts[(i + 1) % pts.length];
    a += p.x * q.z - q.x * p.z;
  }
  return a / 2;
};
if (signedArea(raw) > 0) {
  raw.reverse();
  console.log('reversed centerline to clockwise (driving) direction');
}
if (signedArea(raw) > 0) throw new Error('failed to orient centerline clockwise');

// ---------- centripetal Catmull-Rom resample to dense polyline ----------
function catmullRomDense(pts: Vec2[], subdiv: number): Vec2[] {
  const n = pts.length;
  const out: Vec2[] = [];
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n], p1 = pts[i], p2 = pts[(i + 1) % n], p3 = pts[(i + 2) % n];
    const t0 = 0;
    const t1 = t0 + Math.sqrt(Math.hypot(p1.x - p0.x, p1.z - p0.z)) || t0 + 1e-6;
    const t2 = t1 + Math.sqrt(Math.hypot(p2.x - p1.x, p2.z - p1.z)) || t1 + 1e-6;
    const t3 = t2 + Math.sqrt(Math.hypot(p3.x - p2.x, p3.z - p2.z)) || t2 + 1e-6;
    const steps = Math.max(2, Math.ceil(Math.hypot(p2.x - p1.x, p2.z - p1.z) * subdiv));
    for (let j = 0; j < steps; j++) {
      const t = t1 + ((t2 - t1) * j) / steps;
      const lerp = (a: Vec2, b: Vec2, ta: number, tb: number): Vec2 => {
        const w = tb === ta ? 0 : (t - ta) / (tb - ta);
        return { x: a.x + (b.x - a.x) * w, z: a.z + (b.z - a.z) * w };
      };
      const a1 = lerp(p0, p1, t0, t1), a2 = lerp(p1, p2, t1, t2), a3 = lerp(p2, p3, t2, t3);
      const b1 = lerp(a1, a2, t0, t2), b2 = lerp(a2, a3, t1, t3);
      out.push(lerp(b1, b2, t1, t2));
    }
  }
  return out;
}

function resampleUniform(dense: Vec2[], spacing: number): Vec2[] {
  const n = dense.length;
  const cum: number[] = [0];
  for (let i = 1; i <= n; i++) {
    const p = dense[i - 1], q = dense[i % n];
    cum.push(cum[i - 1] + Math.hypot(q.x - p.x, q.z - p.z));
  }
  const total = cum[n];
  const count = Math.round(total / spacing);
  const out: Vec2[] = [];
  let seg = 0;
  for (let k = 0; k < count; k++) {
    const s = (k * total) / count;
    while (cum[seg + 1] < s) seg++;
    const p = dense[seg], q = dense[(seg + 1) % n];
    const w = (s - cum[seg]) / (cum[seg + 1] - cum[seg]);
    out.push({ x: p.x + (q.x - p.x) * w, z: p.z + (q.z - p.z) * w });
  }
  return out;
}

function smoothClosed(pts: Vec2[], passes: number): Vec2[] {
  let cur = pts;
  for (let p = 0; p < passes; p++) {
    const n = cur.length;
    cur = cur.map((_, i) => {
      const a = cur[(i - 1 + n) % n], b = cur[i], c = cur[(i + 1) % n];
      return { x: (a.x + 2 * b.x + c.x) / 4, z: (a.z + 2 * b.z + c.z) / 4 };
    });
  }
  return cur;
}

let center = resampleUniform(catmullRomDense(raw, 2), SPACING);
center = resampleUniform(smoothClosed(center, SMOOTH_PASSES), SPACING);
const N = center.length;
const LENGTH = N * SPACING;
console.log(`centerline: ${N} points, lap length ${LENGTH.toFixed(0)} m`);

// ---------- rotate so index 0 = start/finish ----------
const sfAnchor = project(landmarksRaw.sf.lon, landmarksRaw.sf.lat);
let sfIdx = 0, best = Infinity;
for (let i = 0; i < N; i++) {
  const dd = d2(center[i], sfAnchor);
  if (dd < best) { best = dd; sfIdx = i; }
}
center = [...center.slice(sfIdx), ...center.slice(0, sfIdx)];
console.log(`SF snapped (anchor distance ${Math.sqrt(best).toFixed(1)} m)`);

// ---------- landmark arclengths ----------
const landmarkS: Record<string, number> = {};
for (const [name, { lon, lat }] of Object.entries(landmarksRaw)) {
  const p = project(lon, lat);
  let bi = 0, bd = Infinity;
  for (let i = 0; i < N; i++) {
    const dd = d2(center[i], p);
    if (dd < bd) { bd = dd; bi = i; }
  }
  landmarkS[name] = bi * SPACING;
  console.log(`  ${name.padEnd(14)} s=${(bi * SPACING).toFixed(0).padStart(5)} m  (anchor off by ${Math.sqrt(bd).toFixed(0)} m)`);
}
const refS = (r: LandmarkRef): number => {
  const s = landmarkS[r.at];
  if (s === undefined) throw new Error(`unknown landmark '${r.at}'`);
  return ((s + (r.ds ?? 0)) % LENGTH + LENGTH) % LENGTH;
};

// landmark ordering sanity (driving order after SF) — checked at end, after SVG is written
function checkLandmarkOrder() {
  const order = ['steDevote', 'massenet', 'casino', 'mirabeau', 'hairpin', 'portier', 'chicane', 'tabac', 'piscineIn', 'rascasse', 'antonyNoghes'];
  for (let i = 1; i < order.length; i++) {
    if (landmarkS[order[i]] <= landmarkS[order[i - 1]]) {
      throw new Error(`landmark order broken: ${order[i - 1]} (${landmarkS[order[i - 1]]}) should precede ${order[i]} (${landmarkS[order[i]]})`);
    }
  }
}

// ---------- monotone cubic (Fritsch–Carlson), periodic via wrap padding ----------
function monotoneCubic(xsIn: number[], ysIn: number[], period: number): (x: number) => number {
  // pad one period on each side for smooth wrap
  const xs: number[] = [], ys: number[] = [];
  for (const off of [-period, 0, period]) {
    for (let i = 0; i < xsIn.length; i++) { xs.push(xsIn[i] + off); ys.push(ysIn[i]); }
  }
  const n = xs.length;
  const h: number[] = [], m: number[] = [];
  for (let i = 0; i < n - 1; i++) { h.push(xs[i + 1] - xs[i]); m.push((ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i])); }
  const t: number[] = [m[0]];
  for (let i = 1; i < n - 1; i++) {
    if (m[i - 1] * m[i] <= 0) t.push(0);
    else t.push((3 * (h[i - 1] + h[i])) / ((2 * h[i] + h[i - 1]) / m[i - 1] + (h[i] + 2 * h[i - 1]) / m[i]));
  }
  t.push(m[n - 2]);
  return (x: number) => {
    let xx = ((x % period) + period) % period;
    let lo = 0, hi = n - 2;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (xs[mid] <= xx) lo = mid; else hi = mid - 1; }
    const i = lo;
    const dx = xs[i + 1] - xs[i], u = (xx - xs[i]) / dx;
    const h00 = 2 * u ** 3 - 3 * u ** 2 + 1, h10 = u ** 3 - 2 * u ** 2 + u;
    const h01 = -2 * u ** 3 + 3 * u ** 2, h11 = u ** 3 - u ** 2;
    return h00 * ys[i] + h10 * dx * t[i] + h01 * ys[i + 1] + h11 * dx * t[i + 1];
  };
}

function buildInterp(points: Array<Record<string, unknown>>, key: string): (s: number) => number {
  const entries = points
    .map((p) => ({ s: refS(p as unknown as LandmarkRef), v: p[key] as number }))
    .sort((a, b) => a.s - b.s);
  return monotoneCubic(entries.map((e) => e.s), entries.map((e) => e.v), LENGTH);
}

const elevAt = buildInterp(elevationCfg.points, 'h');
const wlAt = buildInterp(widthCfg.points, 'wl');
const wrAt = buildInterp(widthCfg.points, 'wr');

// ---------- assemble output points ----------
const FLAT = process.argv.includes('--flat'); // M2 debugging: force elevation 0
interface OutPoint { x: number; y: number; z: number; nx: number; nz: number; wl: number; wr: number; s: number }
const pts: OutPoint[] = center.map((p, i) => {
  const prev = center[(i - 1 + N) % N], next = center[(i + 1) % N];
  let tx = next.x - prev.x, tz = next.z - prev.z;
  const tl = Math.hypot(tx, tz); tx /= tl; tz /= tl;
  const s = i * SPACING;
  return {
    x: p.x, y: FLAT ? 0 : elevAt(s), z: p.z,
    nx: -tz, nz: tx, // left normal in east/north frame
    wl: wlAt(s), wr: wrAt(s), s,
  };
});

// ---------- validation ----------
let minRadius = Infinity, minRadiusS = 0;
for (let i = 0; i < N; i++) {
  const a = center[(i - 1 + N) % N], b = center[i], c = center[(i + 1) % N];
  const ab = Math.hypot(b.x - a.x, b.z - a.z), bc = Math.hypot(c.x - b.x, c.z - b.z), ca = Math.hypot(a.x - c.x, a.z - c.z);
  const area2 = Math.abs((b.x - a.x) * (c.z - a.z) - (c.x - a.x) * (b.z - a.z));
  if (area2 > 1e-9) {
    const r = (ab * bc * ca) / (2 * area2);
    if (r < minRadius) { minRadius = r; minRadiusS = i * SPACING; }
  }
}
console.log(`min turn radius: ${minRadius.toFixed(1)} m at s=${minRadiusS} (hairpin s=${landmarkS.hairpin})`);
if (minRadius < 4.5) throw new Error('turn radius below 4.5 m — increase smoothing');

// self-intersection of centerline segments (skip neighbors)
for (let i = 0; i < N; i++) {
  for (let j = i + 3; j < N; j++) {
    if (i === 0 && j >= N - 3) continue;
    const a = center[i], b = center[(i + 1) % N], c = center[j], d = center[(j + 1) % N];
    const o = (p: Vec2, q: Vec2, r: Vec2) => (q.x - p.x) * (r.z - p.z) - (q.z - p.z) * (r.x - p.x);
    if (o(a, b, c) * o(a, b, d) < 0 && o(c, d, a) * o(c, d, b) < 0) {
      throw new Error(`centerline self-intersects between s=${i * SPACING} and s=${j * SPACING}`);
    }
  }
}

// proximity warning between distant-in-s sections (road overlap risk)
let minProx = Infinity, proxAt: [number, number] = [0, 0];
for (let i = 0; i < N; i++) {
  for (let j = i + 30; j < N; j++) {
    if (Math.min(j - i, N - (j - i)) < 30) continue;
    const dd = d2(center[i], center[j]);
    if (dd < minProx) { minProx = dd; proxAt = [i * SPACING, j * SPACING]; }
  }
}
console.log(`closest non-adjacent approach: ${Math.sqrt(minProx).toFixed(1)} m between s=${proxAt[0]} and s=${proxAt[1]}`);
if (Math.sqrt(minProx) < 9.5) console.warn('WARNING: sections closer than combined road width — check preview SVG');

const elevs = pts.map((p) => p.y);
const emin = Math.min(...elevs), emax = Math.max(...elevs);
console.log(`elevation range: ${emin.toFixed(1)} .. ${emax.toFixed(1)} m`);
if (!FLAT && (emin < -1 || emax > 45)) throw new Error('elevation out of bounds');
let maxGrade = 0;
for (let i = 0; i < N; i++) {
  const g = Math.abs(pts[(i + 1) % N].y - pts[i].y) / SPACING;
  maxGrade = Math.max(maxGrade, g);
}
console.log(`max grade: ${(maxGrade * 100).toFixed(1)} %`);
if (maxGrade > 0.16) throw new Error('grade exceeds 16% — smooth elevation control points');

// ---------- features ----------
const tunnel: [number, number] = [refS(featuresCfg.tunnel.from), refS(featuresCfg.tunnel.to)];
const kerbs: [number, number][] = featuresCfg.kerbs.map((k: { from: LandmarkRef; to: LandmarkRef }) => [refS(k.from), refS(k.to)]);

// SF line: from left edge to right edge at s=0, forward = tangent
const p0 = pts[0];
const sf = {
  ax: p0.x + p0.nx * (p0.wl + 1), az: p0.z + p0.nz * (p0.wl + 1),
  bx: p0.x - p0.nx * (p0.wr + 1), bz: p0.z - p0.nz * (p0.wr + 1),
  fx: p0.nz, fz: -p0.nx, // forward = left normal rotated -90° (tangent)
};

// grid: 15 m before SF
const gi = (N - Math.round(15 / SPACING)) % N;
const gp = pts[gi];
const grid = { x: gp.x, y: gp.y, z: gp.z, heading: Math.atan2(gp.nz, -gp.nx) };
// heading: tangent t = (nz, -nx)... wait, left normal n = rot90ccw(t) => t = rot90cw(n) = (nz, -nx)? verify below
// t from points directly:
{
  const q = pts[(gi + 1) % N];
  grid.heading = Math.atan2(q.x - gp.x, q.z - gp.z); // Babylon yaw: heading vec = (sin, 0, cos)
}

// ---------- write JSON ----------
const out = {
  length: LENGTH,
  spacing: SPACING,
  points: pts.map((p) => [p.x, p.y, p.z, p.nx, p.nz, p.wl, p.wr].map((v) => Math.round(v * 1000) / 1000)),
  tunnel, kerbs, sf, grid,
  landmarks: Object.fromEntries(Object.entries(landmarkS).map(([k, v]) => [k, v])),
};
writeFileSync(join(ROOT, 'src/data/monaco.json'), JSON.stringify(out));
console.log(`wrote src/data/monaco.json (${pts.length} points)`);

// ---------- SVG preview ----------
{
  const xs = pts.map((p) => p.x), zs = pts.map((p) => p.z);
  const minX = Math.min(...xs) - 30, maxX = Math.max(...xs) + 30;
  const minZ = Math.min(...zs) - 30, maxZ = Math.max(...zs) + 30;
  const W = 1000, H = (W * (maxZ - minZ)) / (maxX - minX);
  const X = (x: number) => ((x - minX) / (maxX - minX)) * W;
  const Z = (z: number) => H - ((z - minZ) / (maxZ - minZ)) * H; // north up
  const path = (edge: (p: OutPoint) => [number, number]) =>
    pts.map((p, i) => `${i ? 'L' : 'M'}${X(edge(p)[0]).toFixed(1)},${Z(edge(p)[1]).toFixed(1)}`).join('') + 'Z';
  const left = path((p) => [p.x + p.nx * p.wl, p.z + p.nz * p.wl]);
  const right = path((p) => [p.x - p.nx * p.wr, p.z - p.nz * p.wr]);
  const mid = path((p) => [p.x, p.z]);
  const labels = Object.entries(landmarkS)
    .map(([name, s]) => {
      const p = pts[Math.round(s / SPACING) % N];
      return `<circle cx="${X(p.x)}" cy="${Z(p.z)}" r="4" fill="#e33"/><text x="${X(p.x) + 7}" y="${Z(p.z) + 4}" font-size="13" fill="#222">${name} (${s})</text>`;
    })
    .join('');
  // tunnel highlight
  const ti0 = Math.round(tunnel[0] / SPACING), ti1 = Math.round(tunnel[1] / SPACING);
  const tunnelPts = [];
  for (let i = ti0; i !== ti1; i = (i + 1) % N) tunnelPts.push(pts[i]);
  const tunnelPath = tunnelPts.map((p, i) => `${i ? 'L' : 'M'}${X(p.x).toFixed(1)},${Z(p.z).toFixed(1)}`).join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H.toFixed(0)}" viewBox="0 0 ${W} ${H.toFixed(0)}">
  <rect width="100%" height="100%" fill="#f5f2ea"/>
  <path d="${left}" fill="none" stroke="#888" stroke-width="1.5"/>
  <path d="${right}" fill="none" stroke="#888" stroke-width="1.5"/>
  <path d="${mid}" fill="none" stroke="#bbb" stroke-width="0.8" stroke-dasharray="6 5"/>
  <path d="${tunnelPath}" fill="none" stroke="#fa0" stroke-width="5" opacity="0.5"/>
  <line x1="${X(sf.ax)}" y1="${Z(sf.az)}" x2="${X(sf.bx)}" y2="${Z(sf.bz)}" stroke="#c00" stroke-width="3"/>
  ${labels}
</svg>`;
  writeFileSync(join(ROOT, 'tools/track-preview.svg'), svg);
  console.log('wrote tools/track-preview.svg');
}

checkLandmarkOrder();
console.log('all checks passed');

