import {
  Color3, DynamicTexture, Mesh, PhysicsBody, PhysicsMotionType, PhysicsShapeMesh,
  Scene, StandardMaterial, VertexData,
} from '@babylonjs/core';
import { FILTER_CAR, FILTER_TRACK } from '../physics/havok';
import { TrackData } from './TrackData';

/**
 * Invisible physics-only mesh with BOTH triangle windings, so Havok raycasts
 * (which cull back faces) hit it from any direction regardless of how the
 * visual mesh is wound.
 */
export function doubleSidedPhysicsMesh(
  name: string, scene: Scene, positions: number[], indices: number[], friction: number,
): Mesh {
  const both = indices.slice();
  for (let i = 0; i < indices.length; i += 3) {
    both.push(indices[i], indices[i + 2], indices[i + 1]);
  }
  const mesh = new Mesh(name, scene);
  const vd = new VertexData();
  vd.positions = positions.slice();
  vd.indices = both;
  vd.applyToMesh(mesh);
  mesh.isVisible = false;
  mesh.freezeWorldMatrix();
  const shape = new PhysicsShapeMesh(mesh, scene);
  shape.material = { friction, restitution: 0 };
  shape.filterMembershipMask = FILTER_TRACK;
  shape.filterCollideMask = FILTER_CAR;
  const body = new PhysicsBody(mesh, PhysicsMotionType.STATIC, false, scene);
  body.shape = shape;
  return mesh;
}

/**
 * Computes normals and, if the surface ended up facing down on average,
 * flips triangle winding so ribbon-style meshes always face up.
 */
export function upFacingVertexData(positions: number[], indices: number[], uvs?: number[]): VertexData {
  // flip any triangle whose geometric normal points down (per-triangle, since a
  // single mesh may mix left/right-side strips with opposite winding)
  for (let i = 0; i < indices.length; i += 3) {
    const [ia, ib, ic] = [indices[i] * 3, indices[i + 1] * 3, indices[i + 2] * 3];
    const abx = positions[ib] - positions[ia], abz = positions[ib + 2] - positions[ia + 2];
    const acx = positions[ic] - positions[ia], acz = positions[ic + 2] - positions[ia + 2];
    // Babylon's ComputeNormals yields n = cross(a-b, c-b); its y for (a,b,c) is:
    const ny = abx * acz - abz * acx;
    if (ny < 0) {
      const t = indices[i + 1];
      indices[i + 1] = indices[i + 2];
      indices[i + 2] = t;
    }
  }
  const normals: number[] = [];
  VertexData.ComputeNormals(positions, indices, normals);
  const vd = new VertexData();
  vd.positions = positions;
  vd.indices = indices;
  vd.normals = normals;
  if (uvs) vd.uvs = uvs;
  return vd;
}

function asphaltTexture(scene: Scene): DynamicTexture {
  const size = 512;
  const tex = new DynamicTexture('asphalt', size, scene, true);
  const ctx = tex.getContext() as CanvasRenderingContext2D;
  ctx.fillStyle = '#46464b';
  ctx.fillRect(0, 0, size, size);
  // speckle noise
  for (let i = 0; i < 14000; i++) {
    const v = 50 + Math.random() * 45;
    ctx.fillStyle = `rgba(${v},${v},${v + 4},${0.25 + Math.random() * 0.4})`;
    ctx.fillRect(Math.random() * size, Math.random() * size, 1.5, 1.5);
  }
  // edge white lines (u near 0 and 1)
  ctx.fillStyle = '#d8d8d2';
  ctx.fillRect(6, 0, 7, size);
  ctx.fillRect(size - 13, 0, 7, size);
  // dashed centerline: tile covers 8 m of track; dash 3 m
  ctx.fillStyle = '#cfcfc8';
  ctx.fillRect(size / 2 - 3, 0, 6, size * (3 / 8));
  tex.update();
  tex.anisotropicFilteringLevel = 8;
  return tex;
}

/** Road ribbon mesh + static mesh collider. Returns the mesh (used as physics reference). */
export function buildRoad(scene: Scene, track: TrackData): Mesh {
  const n = track.count;
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  for (let i = 0; i <= n; i++) {
    const p = track.at(i);
    positions.push(
      p.x + p.nx * p.wl, p.y, p.z + p.nz * p.wl, // left edge
      p.x - p.nx * p.wr, p.y, p.z - p.nz * p.wr, // right edge
    );
    const v = (i * track.spacing) / 8; // texture tile every 8 m
    uvs.push(0, v, 1, v);
  }
  for (let i = 0; i < n; i++) {
    const a = i * 2, b = i * 2 + 1, c = i * 2 + 2, d = i * 2 + 3;
    indices.push(a, c, b, b, c, d);
  }

  const mesh = new Mesh('road', scene);
  upFacingVertexData(positions, indices, uvs).applyToMesh(mesh);

  const mat = new StandardMaterial('roadMat', scene);
  mat.diffuseTexture = asphaltTexture(scene);
  mat.specularColor = new Color3(0.08, 0.08, 0.09);
  mesh.material = mat;
  mesh.freezeWorldMatrix();

  doubleSidedPhysicsMesh('roadPhys', scene, positions, indices, 1.0);

  // start/finish line decal: thin checkered strip just above the road at s=0
  buildSfDecal(scene, track);

  return mesh;
}

function buildSfDecal(scene: Scene, track: TrackData): void {
  const p = track.pointAt(0);
  const q = track.pointAt(2.5);
  const positions: number[] = [];
  const uvs: number[] = [];
  for (const [pt, v] of [[p, 0], [q, 1]] as const) {
    positions.push(
      pt.pos.x + pt.nx * pt.wl, pt.pos.y + 0.03, pt.pos.z + pt.nz * pt.wl,
      pt.pos.x - pt.nx * pt.wr, pt.pos.y + 0.03, pt.pos.z - pt.nz * pt.wr,
    );
    uvs.push(0, v, 8, v);
  }
  const mesh = new Mesh('sfLine', scene);
  upFacingVertexData(positions, [0, 2, 1, 1, 2, 3], uvs).applyToMesh(mesh);

  const tex = new DynamicTexture('sfTex', 128, scene, false);
  const ctx = tex.getContext() as CanvasRenderingContext2D;
  for (let y = 0; y < 4; y++) {
    for (let x = 0; x < 4; x++) {
      ctx.fillStyle = (x + y) % 2 ? '#101010' : '#f2f2f2';
      ctx.fillRect(x * 32, y * 32, 32, 32);
    }
  }
  tex.update();
  const mat = new StandardMaterial('sfMat', scene);
  mat.diffuseTexture = tex;
  mat.specularColor = Color3.Black();
  mesh.material = mat;
  mesh.freezeWorldMatrix();
}

/** Striped kerb strips at flagged corner ranges, on the apex side (by curvature), plus physics. */
export function buildKerbs(scene: Scene, track: TrackData): Mesh | null {
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  for (const [s0, s1] of track.kerbs) {
    const i0 = Math.round(s0 / track.spacing);
    const len = Math.round((((s1 - s0) % track.length) + track.length) % track.length / track.spacing);
    // apex side from average curvature sign over the range: left turn (>0) => kerb on left
    let turn = 0;
    for (let k = 0; k < len; k++) {
      const a = track.at(i0 + k - 1), b = track.at(i0 + k), c = track.at(i0 + k + 1);
      turn += (b.x - a.x) * (c.z - b.z) - (b.z - a.z) * (c.x - b.x);
    }
    const side = turn > 0 ? 1 : -1; // 1 = left of centerline
    const base = positions.length / 3;
    for (let k = 0; k <= len; k++) {
      const p = track.at(i0 + k);
      const w = side > 0 ? p.wl : p.wr;
      const ex = p.x + side * p.nx * w, ez = p.z + side * p.nz * w; // road edge
      const ix = p.x + side * p.nx * (w - 1.2), iz = p.z + side * p.nz * (w - 1.2); // inner
      positions.push(ix, p.y + 0.005, iz, ex, p.y + 0.055, ez);
      const v = (k * track.spacing) / 4; // stripe period 4 m
      uvs.push(0, v, 1, v);
    }
    for (let k = 0; k < len; k++) {
      const a = base + k * 2, b = a + 1, c = a + 2, d = a + 3;
      indices.push(a, c, b, b, c, d);
    }
  }
  if (!positions.length) return null;

  const mesh = new Mesh('kerbs', scene);
  upFacingVertexData(positions, indices, uvs).applyToMesh(mesh);
  doubleSidedPhysicsMesh('kerbsPhys', scene, positions, indices, 0.9);

  const tex = new DynamicTexture('kerbTex', 128, scene, false);
  const ctx = tex.getContext() as CanvasRenderingContext2D;
  ctx.fillStyle = '#c8202a';
  ctx.fillRect(0, 0, 128, 64);
  ctx.fillStyle = '#e8e6e0';
  ctx.fillRect(0, 64, 128, 64);
  tex.update();
  const mat = new StandardMaterial('kerbMat', scene);
  mat.diffuseTexture = tex;
  mat.specularColor = new Color3(0.1, 0.1, 0.1);
  mesh.material = mat;
  mesh.freezeWorldMatrix();
  return mesh;
}
