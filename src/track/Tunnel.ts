import { Color3, DynamicTexture, Mesh, Scene, StandardMaterial, VertexData } from '@babylonjs/core';
import { TrackData } from './TrackData';

const ARCH_HEIGHT = 5.2;
const WALL_TOP = 3.4;
const MARGIN = 1.6; // walls beyond road edge

/**
 * Tunnel tube over the flagged range: vertical side walls up to WALL_TOP, elliptical
 * arch ceiling, an emissive lighting strip along the ceiling, and portal faces.
 * Lighting transition itself is handled per-frame in Game via scene light intensities.
 */
export function buildTunnel(scene: Scene, track: TrackData): void {
  const [s0, s1] = track.tunnel;
  const i0 = Math.round(s0 / track.spacing);
  const len = Math.round(((((s1 - s0) % track.length) + track.length) % track.length) / track.spacing);

  // interior cross-section profile, parameterized 0..1 from left wall base to right wall base
  const PROFILE = 13;
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  for (let k = 0; k <= len; k++) {
    const p = track.at(i0 + k);
    const wl = p.wl + MARGIN, wr = p.wr + MARGIN;
    for (let j = 0; j < PROFILE; j++) {
      const t = j / (PROFILE - 1);
      let px: number, py: number, pz: number;
      if (j === 0) { // left wall base
        px = p.x + p.nx * wl; py = p.y; pz = p.z + p.nz * wl;
      } else if (j === 1) { // left wall top
        px = p.x + p.nx * wl; py = p.y + WALL_TOP; pz = p.z + p.nz * wl;
      } else if (j === PROFILE - 2) { // right wall top
        px = p.x - p.nx * wr; py = p.y + WALL_TOP; pz = p.z - p.nz * wr;
      } else if (j === PROFILE - 1) { // right wall base
        px = p.x - p.nx * wr; py = p.y; pz = p.z - p.nz * wr;
      } else { // arch between wall tops: half ellipse
        const a = ((j - 1) / (PROFILE - 3)) * Math.PI; // 0..pi from left to right
        const lateral = Math.cos(a); // 1 -> -1
        const lift = Math.sin(a) * (ARCH_HEIGHT - WALL_TOP);
        const w = lateral > 0 ? wl * lateral : wr * lateral;
        px = p.x + p.nx * w; py = p.y + WALL_TOP + lift; pz = p.z + p.nz * w;
      }
      positions.push(px, py, pz);
      uvs.push(t * 6, (k * track.spacing) / 6);
    }
  }
  for (let k = 0; k < len; k++) {
    for (let j = 0; j < PROFILE - 1; j++) {
      const a = k * PROFILE + j, b = a + 1, c = a + PROFILE, d = c + 1;
      indices.push(a, b, c, b, d, c); // inward-facing
    }
  }

  const mesh = new Mesh('tunnel', scene);
  const vd = new VertexData();
  vd.positions = positions;
  vd.indices = indices;
  vd.uvs = uvs;
  const normals: number[] = [];
  VertexData.ComputeNormals(positions, indices, normals);
  vd.normals = normals;
  vd.applyToMesh(mesh);

  const tex = new DynamicTexture('tunnelTex', 256, scene, true);
  const ctx = tex.getContext() as CanvasRenderingContext2D;
  ctx.fillStyle = '#5c5650';
  ctx.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 2000; i++) {
    const v = 70 + Math.random() * 40;
    ctx.fillStyle = `rgba(${v},${v - 4},${v - 10},0.35)`;
    ctx.fillRect(Math.random() * 256, Math.random() * 256, 2, 2);
  }
  ctx.strokeStyle = 'rgba(30,28,26,0.55)';
  for (let x = 0; x < 256; x += 64) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, 256); ctx.stroke(); }
  tex.update();
  const mat = new StandardMaterial('tunnelMat', scene);
  mat.diffuseTexture = tex;
  mat.specularColor = new Color3(0.05, 0.05, 0.05);
  // sodium-lamp warmth so the interior reads even with scene lights dimmed
  mat.emissiveColor = new Color3(0.5, 0.38, 0.22);
  mat.backFaceCulling = false; // interior must read from inside at any angle
  mesh.material = mat;
  mesh.freezeWorldMatrix();

  // emissive ceiling light strip
  const lp: number[] = [];
  const li: number[] = [];
  for (let k = 0; k <= len; k++) {
    const p = track.at(i0 + k);
    lp.push(
      p.x + p.nx * 0.7, p.y + ARCH_HEIGHT - 0.45, p.z + p.nz * 0.7,
      p.x - p.nx * 0.7, p.y + ARCH_HEIGHT - 0.45, p.z - p.nz * 0.7,
    );
  }
  for (let k = 0; k < len; k++) {
    const a = k * 2, b = a + 1, c = a + 2, d = a + 3;
    li.push(a, b, c, b, d, c);
  }
  const strip = new Mesh('tunnelLights', scene);
  const lvd = new VertexData();
  lvd.positions = lp;
  lvd.indices = li;
  const ln: number[] = [];
  VertexData.ComputeNormals(lp, li, ln);
  lvd.normals = ln;
  lvd.applyToMesh(strip);
  const lmat = new StandardMaterial('tunnelLightMat', scene);
  lmat.emissiveColor = new Color3(1.0, 0.78, 0.45);
  lmat.disableLighting = true;
  lmat.backFaceCulling = false; // strip is seen from below
  strip.material = lmat;
  strip.freezeWorldMatrix();
}
