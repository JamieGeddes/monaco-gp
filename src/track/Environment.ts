import {
  Color3, Color4, DirectionalLight, DynamicTexture, HemisphericLight, Matrix, Mesh,
  MeshBuilder, Quaternion, Scene, StandardMaterial, Vector3,
} from '@babylonjs/core';
import { upFacingVertexData } from './TrackBuilder';
import { TrackData } from './TrackData';

/** Deterministic PRNG so the city looks the same every run. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface EnvLights { sun: DirectionalLight; ambient: HemisphericLight }

export function buildEnvironment(scene: Scene, track: TrackData): EnvLights {
  // --- lighting
  const sun = new DirectionalLight('sun', new Vector3(-0.45, -0.75, 0.3).normalize(), scene);
  sun.intensity = 1.25;
  sun.diffuse = new Color3(1.0, 0.96, 0.88);
  const ambient = new HemisphericLight('ambient', new Vector3(0, 1, 0), scene);
  ambient.intensity = 0.55;
  ambient.diffuse = new Color3(0.75, 0.82, 0.95);
  ambient.groundColor = new Color3(0.35, 0.33, 0.3);

  scene.clearColor = new Color4(0.62, 0.76, 0.92, 1);
  scene.fogMode = Scene.FOGMODE_EXP2;
  scene.fogDensity = 0.0012;
  scene.fogColor = new Color3(0.7, 0.79, 0.9);

  buildSky(scene);
  buildAprons(scene, track);
  buildWater(scene);
  buildBuildings(scene, track);
  buildFairmontBlock(scene, track);
  buildYachts(scene, track);
  buildHillBackdrop(scene, track);
  return { sun, ambient };
}

function buildSky(scene: Scene): void {
  const sky = MeshBuilder.CreateSphere('sky', { diameter: 7000, segments: 8, sideOrientation: Mesh.BACKSIDE }, scene);
  const tex = new DynamicTexture('skyTex', { width: 64, height: 256 }, scene, false);
  const ctx = tex.getContext() as CanvasRenderingContext2D;
  const grad = ctx.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, '#2d6bc8');
  grad.addColorStop(0.45, '#7fb2e8');
  grad.addColorStop(0.62, '#cfe3f5');
  grad.addColorStop(1, '#e8eef2');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 64, 256);
  tex.update();
  const mat = new StandardMaterial('skyMat', scene);
  mat.diffuseTexture = tex;
  mat.emissiveTexture = tex;
  mat.disableLighting = true;
  mat.fogEnabled = false;
  sky.material = mat;
  sky.applyFog = false;
  sky.infiniteDistance = true;
  sky.renderingGroupId = 0;
}

/** Terrain skirts following the road on both sides so the track doesn't float. */
function buildAprons(scene: Scene, track: TrackData): void {
  const n = track.count;
  const mat = new StandardMaterial('apronMat', scene);
  mat.diffuseColor = new Color3(0.45, 0.44, 0.42);
  mat.specularColor = Color3.Black();

  for (const side of [1, -1]) {
    const positions: number[] = [];
    const indices: number[] = [];
    for (let i = 0; i <= n; i++) {
      const p = track.at(i);
      const w = (side > 0 ? p.wl : p.wr) + 0.5;
      positions.push(
        p.x + side * p.nx * w, p.y - 0.02, p.z + side * p.nz * w,
        p.x + side * p.nx * (w + 45), p.y - 2.2, p.z + side * p.nz * (w + 45),
      );
    }
    for (let i = 0; i < n; i++) {
      const a = i * 2, b = a + 1, c = a + 2, d = a + 3;
      indices.push(a, b, c, c, b, d);
    }
    const mesh = new Mesh(side > 0 ? 'apronL' : 'apronR', scene);
    upFacingVertexData(positions, indices).applyToMesh(mesh);
    mesh.material = mat;
    mesh.freezeWorldMatrix();
  }
}

function buildWater(scene: Scene): void {
  const water = MeshBuilder.CreateGround('water', { width: 6000, height: 6000 }, scene);
  water.position.y = -2.6;
  const mat = new StandardMaterial('waterMat', scene);
  mat.diffuseColor = new Color3(0.08, 0.25, 0.42);
  mat.specularColor = new Color3(0.7, 0.75, 0.8);
  mat.specularPower = 96;
  mat.alpha = 0.96;
  water.material = mat;
  water.freezeWorldMatrix();
}

function facadeTexture(scene: Scene, rng: () => number, tint: [number, number, number]): DynamicTexture {
  const tex = new DynamicTexture(`facade${Math.floor(rng() * 1e6)}`, { width: 128, height: 256 }, scene, true);
  const ctx = tex.getContext() as CanvasRenderingContext2D;
  ctx.fillStyle = `rgb(${tint[0]},${tint[1]},${tint[2]})`;
  ctx.fillRect(0, 0, 128, 256);
  // window grid
  for (let y = 8; y < 248; y += 18) {
    for (let x = 6; x < 120; x += 16) {
      const lit = rng() < 0.08;
      const shade = 40 + rng() * 50;
      ctx.fillStyle = lit ? 'rgb(255,228,150)' : `rgb(${shade},${shade + 8},${shade + 18})`;
      ctx.fillRect(x, y, 10, 12);
      ctx.fillStyle = 'rgba(255,255,255,0.25)';
      ctx.fillRect(x, y, 10, 2);
    }
  }
  tex.update();
  return tex;
}

/**
 * Procedural Monte-Carlo: extruded boxes along both sides of the street sections.
 * Skips the tunnel range (Fairmont block covers it) and the harbor side of the
 * port sections (chicane→antonyNoghes left, pit straight right).
 */
function buildBuildings(scene: Scene, track: TrackData): void {
  const rng = mulberry32(1929);
  const palettes: [number, number, number][] = [
    [226, 214, 192], [232, 220, 188], [214, 196, 170], [228, 206, 178], [206, 192, 176],
  ];
  const mats = palettes.map((tint, i) => {
    const m = new StandardMaterial(`bldg${i}`, scene);
    m.diffuseTexture = facadeTexture(scene, rng, tint);
    m.specularColor = Color3.Black();
    return m;
  });
  const groups: Mesh[][] = palettes.map(() => []);

  const L = track.length;
  const lm = track.landmarks;
  const harborLeft: [number, number] = [lm.chicane - 60, lm.antonyNoghes];
  const harborRight: [number, number] = [lm.antonyNoghes, lm.steDevote - 120];

  // coarse track samples for clearance testing (parallel sections, e.g. pit
  // straight vs Piscine, would otherwise receive each other's buildings)
  const samples: { x: number; z: number }[] = [];
  for (let i = 0; i < track.count; i += 4) samples.push(track.at(i));
  const clearOfTrack = (x: number, z: number, radius: number) => {
    const r2 = radius * radius;
    for (const q of samples) {
      if ((q.x - x) ** 2 + (q.z - z) ** 2 < r2) return false;
    }
    return true;
  };

  const step = 16; // meters between buildings
  for (let s = 0; s < L; s += step) {
    for (const side of [1, -1]) {
      if (track.inRange(s, track.tunnel[0] - 30, track.tunnel[1] + 10)) continue;
      if (side > 0 && track.inRange(s, harborLeft[0], harborLeft[1])) continue;
      if (side < 0 && track.inRange(s, harborRight[0], harborRight[1])) continue;
      if (rng() < 0.18) continue; // gaps

      const p = track.pointAt(s);
      const w = (side > 0 ? p.wl : p.wr);
      const setback = 9 + rng() * 7;
      const width = 12 + rng() * 8;
      const depth = 10 + rng() * 10;
      // taller cluster around Casino, mid-rise elsewhere
      const nearCasino = track.inRange(s, lm.massenet - 150, lm.mirabeau);
      const height = (nearCasino ? 18 : 9) + rng() * (nearCasino ? 22 : 16);

      const cx = p.pos.x + side * p.nx * (w + setback + depth / 2);
      const cz = p.pos.z + side * p.nz * (w + setback + depth / 2);
      if (!clearOfTrack(cx, cz, Math.hypot(width, depth) / 2 + 7)) continue;
      const box = MeshBuilder.CreateBox('b', { width, depth, height }, scene);
      box.position.set(cx, p.pos.y + height / 2 - 1.5, cz);
      box.rotation.y = Math.atan2(side * p.nx, side * p.nz);
      // scale window grid with size
      const uScale = Math.max(1, Math.round(width / 9));
      const vScale = Math.max(1, Math.round(height / 14));
      const uvs = box.getVerticesData('uv')!;
      const scaled = new Float32Array(uvs.length);
      for (let k = 0; k < uvs.length; k += 2) { scaled[k] = uvs[k] * uScale; scaled[k + 1] = uvs[k + 1] * vScale; }
      box.setVerticesData('uv', scaled);
      groups[Math.floor(rng() * mats.length)].push(box);
    }
  }

  groups.forEach((meshes, i) => {
    if (!meshes.length) return;
    const merged = Mesh.MergeMeshes(meshes, true, true);
    if (merged) {
      merged.material = mats[i];
      merged.freezeWorldMatrix();
    }
  });
}

/** The hotel block sitting on top of the tunnel. */
function buildFairmontBlock(scene: Scene, track: TrackData): void {
  const [s0, s1] = track.tunnel;
  const segs: Mesh[] = [];
  const span = ((s1 - s0) % track.length + track.length) % track.length;
  for (let off = 0; off < span; off += 36) {
    const p = track.pointAt(s0 + off + 18);
    const box = MeshBuilder.CreateBox('fairmont', { width: 34, depth: 40, height: 13 }, scene);
    box.position.set(p.pos.x, p.pos.y + 5.4 + 6.5, p.pos.z);
    box.rotation.y = Math.atan2(p.nx, p.nz);
    segs.push(box);
  }
  const merged = Mesh.MergeMeshes(segs, true, true);
  if (merged) {
    const mat = new StandardMaterial('fairmontMat', scene);
    mat.diffuseColor = new Color3(0.93, 0.89, 0.8);
    mat.specularColor = Color3.Black();
    merged.material = mat;
    merged.freezeWorldMatrix();
  }
}

/** White hulls moored in the harbor between the two port-side track sections. */
function buildYachts(scene: Scene, track: TrackData): void {
  const rng = mulberry32(7);
  const lm = track.landmarks;
  const hull = MeshBuilder.CreateBox('yachtHull', { width: 5, height: 2.2, depth: 14 }, scene);
  const cabin = MeshBuilder.CreateBox('yachtCabin', { width: 3.2, height: 1.6, depth: 6 }, scene);
  cabin.position.y = 1.9;
  cabin.position.z = -1;
  const yacht = Mesh.MergeMeshes([hull, cabin], true, true)!;
  const mat = new StandardMaterial('yachtMat', scene);
  mat.diffuseColor = new Color3(0.95, 0.96, 0.97);
  mat.specularColor = new Color3(0.3, 0.3, 0.3);
  yacht.material = mat;

  const matrices: number[] = [];
  for (let s = lm.tabac; s < lm.rascasse - 40; s += 26) {
    const p = track.pointAt(s);
    const count = 1 + Math.floor(rng() * 2);
    for (let k = 0; k < count; k++) {
      const dist = 26 + rng() * 70;
      const mm = Matrix.Compose(
        Vector3.One(),
        Quaternion.FromEulerAngles(0, rng() * Math.PI * 2, 0),
        new Vector3(p.pos.x + p.nx * dist, -1.4, p.pos.z + p.nz * dist),
      );
      matrices.push(...mm.asArray());
    }
  }
  yacht.thinInstanceSetBuffer('matrix', new Float32Array(matrices), 16, true);
  yacht.freezeWorldMatrix();
}

/** Low-poly hillside ridge rising far behind the inland side. */
function buildHillBackdrop(scene: Scene, track: TrackData): void {
  const lm = track.landmarks;
  const rng = mulberry32(42);
  const segs: Mesh[] = [];
  for (let s = lm.steDevote - 250; s < lm.mirabeau + 150; s += 110) {
    const p = track.pointAt(s);
    const h = 60 + rng() * 80;
    const box = MeshBuilder.CreateBox('hill', { width: 220 + rng() * 80, depth: 180, height: h }, scene);
    box.position.set(p.pos.x + p.nx * 330, p.pos.y + h / 2 - 25, p.pos.z + p.nz * 330);
    box.rotation.y = rng() * Math.PI;
    segs.push(box);
  }
  const merged = Mesh.MergeMeshes(segs, true, true);
  if (merged) {
    const mat = new StandardMaterial('hillMat', scene);
    mat.diffuseColor = new Color3(0.45, 0.52, 0.4);
    mat.specularColor = Color3.Black();
    merged.material = mat;
    merged.freezeWorldMatrix();
  }
}
