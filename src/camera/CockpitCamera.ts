import { Quaternion, Scene, TransformNode, UniversalCamera, Vector3 } from '@babylonjs/core';
import { Vehicle } from '../car/Vehicle';

const HEAD_POS = new Vector3(0, 0.78, 0.18); // driver eye, relative to chassis center
const G_LATERAL = 0.008;  // m per m/s^2
const G_PITCH = 0.003;    // rad per m/s^2
const ROT_SMOOTH = 0.2;   // slerp factor per frame at 60 fps

/** First-person cockpit camera: parented head node with rotational low-pass + subtle G effects. */
export class CockpitCamera {
  readonly camera: UniversalCamera;
  private headRot = Quaternion.Identity();
  private head: TransformNode;

  constructor(scene: Scene, private vehicle: Vehicle) {
    this.head = new TransformNode('head', scene);
    this.head.rotationQuaternion = Quaternion.Identity();

    this.camera = new UniversalCamera('cockpit', Vector3.Zero(), scene);
    this.camera.parent = this.head;
    this.camera.fov = 1.15;
    this.camera.minZ = 0.08;
    this.camera.maxZ = 4500;
    this.camera.inputs.clear(); // no user camera control
  }

  update(dt: number): void {
    const root = this.vehicle.root;
    const target = root.rotationQuaternion ?? Quaternion.Identity();
    const k = 1 - Math.pow(1 - ROT_SMOOTH, dt * 60);
    Quaternion.SlerpToRef(this.headRot, target, k, this.headRot);
    this.head.rotationQuaternion!.copyFrom(this.headRot);

    // position rigidly follows the chassis (low-pass only on rotation to avoid swimming)
    const m = root.getWorldMatrix();
    Vector3.TransformCoordinatesToRef(HEAD_POS, m, this.head.position);

    // subtle G effects in camera-local space: smoothed accel through a saturating
    // response, faded out entirely while accel is noisy (wall grinding) — clean
    // cornering/braking leans the view, impacts can't slam it
    const calm = Math.max(0, Math.min(1, 1 - (this.vehicle.gNoise - 5) / 10));
    const lat = 15 * Math.tanh(this.vehicle.latAccelSmooth / 14) * calm;
    const lon = 15 * Math.tanh(this.vehicle.longAccelSmooth / 14) * calm;
    this.camera.position.set(-lat * G_LATERAL, 0, 0);
    this.camera.rotation.set(lon * G_PITCH, 0, lat * 0.003);
  }

  snap(): void {
    const target = this.vehicle.root.rotationQuaternion ?? Quaternion.Identity();
    this.headRot.copyFrom(target);
    this.head.rotationQuaternion!.copyFrom(target);
  }
}
