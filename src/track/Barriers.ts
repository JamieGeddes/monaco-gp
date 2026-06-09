import {
  Color3, DynamicTexture, Matrix, Mesh, MeshBuilder, PhysicsBody, PhysicsMotionType,
  PhysicsShapeBox, PhysicsShapeContainer, Quaternion, Scene, StandardMaterial, TransformNode,
  Vector3, VertexData,
} from '@babylonjs/core';
import { FILTER_CAR, FILTER_TRACK } from '../physics/havok';
import { TrackData } from './TrackData';

const WALL_OFFSET = 0.5;   // beyond road edge
const WALL_HEIGHT = 1.0;
const TUNNEL_WALL_HEIGHT = 1.4;
const SEG_POINTS = 2;      // collider box per 2 points (4 m)

function armcoTexture(scene: Scene): DynamicTexture {
  const tex = new DynamicTexture('armco', { width: 256, height: 64 }, scene, true);
  const ctx = tex.getContext() as CanvasRenderingContext2D;
  const grad = ctx.createLinearGradient(0, 0, 0, 64);
  grad.addColorStop(0, '#9aa0a6');
  grad.addColorStop(0.25, '#cdd2d6');
  grad.addColorStop(0.4, '#888e94');
  grad.addColorStop(0.55, '#c4c9cd');
  grad.addColorStop(0.75, '#7e848a');
  grad.addColorStop(1, '#6a7076');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 256, 64);
  ctx.fillStyle = 'rgba(40,44,48,0.5)';
  ctx.fillRect(0, 30, 256, 3);
  tex.update();
  return tex;
}

/**
 * Continuous barrier walls on both sides for the full lap: visual quad strips plus a
 * chain of overlapping box colliders (robust against high-speed contacts, no gaps).
 */
export function buildBarriers(scene: Scene, track: TrackData): void {
  const n = track.count;
  const mat = new StandardMaterial('armcoMat', scene);
  mat.diffuseTexture = armcoTexture(scene);
  mat.specularColor = new Color3(0.25, 0.25, 0.27);

  const colliderRoot = new TransformNode('barrierColliders', scene);
  const body = new PhysicsBody(colliderRoot, PhysicsMotionType.STATIC, false, scene);
  const container = new PhysicsShapeContainer(scene);

  for (const side of [1, -1]) {
    const positions: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];

    const baseAt = (i: number) => {
      const p = track.at(i);
      const w = (side > 0 ? p.wl : p.wr) + WALL_OFFSET;
      const h = track.inRange(p.s, track.tunnel[0], track.tunnel[1]) ? TUNNEL_WALL_HEIGHT : WALL_HEIGHT;
      return { x: p.x + side * p.nx * w, y: p.y, z: p.z + side * p.nz * w, h };
    };

    for (let i = 0; i <= n; i++) {
      const b = baseAt(i);
      positions.push(b.x, b.y - 0.4, b.z, b.x, b.y + b.h, b.z);
      const v = (i * track.spacing) / 4;
      uvs.push(v, 0, v, 1);
    }
    for (let i = 0; i < n; i++) {
      const a = i * 2, b = i * 2 + 1, c = i * 2 + 2, d = i * 2 + 3;
      // wind so the visible face points toward the track on both sides
      if (side > 0) indices.push(a, b, c, c, b, d);
      else indices.push(a, c, b, b, c, d);
    }

    const mesh = new Mesh(side > 0 ? 'barrierL' : 'barrierR', scene);
    const vd = new VertexData();
    vd.positions = positions;
    vd.indices = indices;
    vd.uvs = uvs;
    const normals: number[] = [];
    VertexData.ComputeNormals(positions, indices, normals);
    vd.normals = normals;
    vd.applyToMesh(mesh);
    mesh.material = mat;
    mesh.freezeWorldMatrix();

    // collider boxes
    for (let i = 0; i < n; i += SEG_POINTS) {
      const a = baseAt(i);
      const b = baseAt(Math.min(i + SEG_POINTS, n));
      const cx = (a.x + b.x) / 2, cz = (a.z + b.z) / 2;
      const horizLen = Math.hypot(b.x - a.x, b.z - a.z);
      const yaw = Math.atan2(b.x - a.x, b.z - a.z);
      const yLo = Math.min(a.y, b.y) - 0.5;
      const yHi = Math.max(a.y, b.y) + Math.max(a.h, b.h);
      container.addChild(
        new PhysicsShapeBox(Vector3.Zero(), Quaternion.Identity(), new Vector3(0.4, yHi - yLo, horizLen * 1.15), scene),
        new Vector3(cx, (yLo + yHi) / 2, cz),
        Quaternion.FromEulerAngles(0, yaw, 0),
      );
    }
  }

  // slick, dead walls: scrub speed without grabbing or bouncing the chassis
  container.material = { friction: 0.12, restitution: 0 };
  container.filterMembershipMask = FILTER_TRACK;
  container.filterCollideMask = FILTER_CAR;
  body.shape = container;

  buildPosts(scene, track);
}

/** Thin instanced armco posts every ~4 m on both sides. */
function buildPosts(scene: Scene, track: TrackData): void {
  const post = MeshBuilder.CreateBox('post', { width: 0.12, height: 1.0, depth: 0.18 }, scene);
  const mat = new StandardMaterial('postMat', scene);
  mat.diffuseColor = new Color3(0.35, 0.37, 0.39);
  mat.specularColor = new Color3(0.1, 0.1, 0.1);
  post.material = mat;

  const matrices: number[] = [];
  const step = 2; // every 2 points = 4 m
  for (const side of [1, -1]) {
    for (let i = 0; i < track.count; i += step) {
      const p = track.at(i);
      if (track.inRange(p.s, track.tunnel[0], track.tunnel[1])) continue; // walls, not posts, in the tunnel
      const w = (side > 0 ? p.wl : p.wr) + WALL_OFFSET + 0.18;
      const m = Matrix.Compose(
        Vector3.One(),
        Quaternion.FromEulerAngles(0, Math.atan2(p.nx, p.nz), 0),
        new Vector3(p.x + side * p.nx * w, p.y + 0.4, p.z + side * p.nz * w),
      );
      matrices.push(...m.asArray());
    }
  }
  post.thinInstanceSetBuffer('matrix', new Float32Array(matrices), 16, true);
  post.freezeWorldMatrix();
}
