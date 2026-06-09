import {
  HavokPlugin, Mesh, MeshBuilder, PhysicsBody, PhysicsMotionType, PhysicsRaycastResult,
  PhysicsShapeBox, Quaternion, Scene, Vector3,
} from '@babylonjs/core';
import { FILTER_CAR, FILTER_TRACK } from '../physics/havok';
import { Drivetrain } from './Drivetrain';

const MASS = 798;
const CHASSIS = { width: 1.9, height: 0.8, length: 5.0 };
const COM_LOCAL = new Vector3(0, -0.25, 0);
const SUSPENSION_REST = 0.3;
const WHEEL_RADIUS = 0.33;
const SPRING_K = 130000;   // N/m
const SPRING_C = 9000;     // N·s/m
const ARB_K = 60000;       // anti-roll bar N/m per meter of compression difference
const MAX_WHEEL_FORCE = 11000; // N, cap to avoid spring catapults in wall hits
const MU_ROAD = 1.9;
const CORNERING_STIFF = 14; // per rad, × Fz
const BRAKE_FORCE_FRONT = 5000; // N per wheel
const BRAKE_FORCE_REAR = 3300;
const ROLL_RESIST = 0.013;
const DOWNFORCE_COEF = 2.56;  // N per (m/s)^2 total
const DRAG_COEF = 0.85;       // N per (m/s)^2
const MAX_STEER_LOW = (16 * Math.PI) / 180;
const MAX_STEER_HIGH = (4.5 * Math.PI) / 180;
const REVERSE_FORCE = 2600;   // N per rear wheel
const REVERSE_MAX_SPEED = 5;  // m/s

export interface WheelState {
  local: Vector3;
  isFront: boolean;
  steerAngle: number;
  spinAngle: number;
  compression: number;
  prevCompression: number;
  onGround: boolean;
}

export class Vehicle {
  readonly root: Mesh;
  readonly body: PhysicsBody;
  readonly drivetrain = new Drivetrain();
  readonly wheels: WheelState[];

  // inputs (set per frame by Game)
  throttle = 0;
  brake = 0;
  steer = 0;

  // state for HUD/audio/camera
  speed = 0;          // forward m/s (signed)
  speedKmh = 0;
  latAccel = 0;       // m/s^2, for camera sway
  longAccel = 0;
  reversing = false;

  private brakeStillMs = 0;
  private raycastResult = new PhysicsRaycastResult();
  private prevVel = new Vector3();

  // scratch vectors (avoid per-frame allocation)
  private vel = new Vector3();
  private angVel = new Vector3();
  private upVec = new Vector3();
  private tmpA = new Vector3();
  private tmpB = new Vector3();

  constructor(private scene: Scene, private plugin: HavokPlugin) {
    this.root = MeshBuilder.CreateBox('chassis', CHASSIS, scene);
    this.root.isVisible = false;
    this.root.rotationQuaternion = Quaternion.Identity();

    this.body = new PhysicsBody(this.root, PhysicsMotionType.DYNAMIC, false, scene);
    const shape = new PhysicsShapeBox(
      Vector3.Zero(), Quaternion.Identity(),
      new Vector3(CHASSIS.width, CHASSIS.height, CHASSIS.length), scene,
    );
    shape.material = { friction: 0.3, restitution: 0.05 };
    shape.filterMembershipMask = FILTER_CAR;
    shape.filterCollideMask = FILTER_TRACK;
    this.body.shape = shape;
    this.body.setMassProperties({ mass: MASS, centerOfMass: COM_LOCAL });
    this.body.setLinearDamping(0.02);
    this.body.setAngularDamping(0.6);
    this.body.disablePreStep = false;

    this.wheels = [
      { local: new Vector3(-0.78, 0, 1.55), isFront: true },
      { local: new Vector3(0.78, 0, 1.55), isFront: true },
      { local: new Vector3(-0.78, 0, -1.45), isFront: false },
      { local: new Vector3(0.78, 0, -1.45), isFront: false },
    ].map((w) => ({ ...w, steerAngle: 0, spinAngle: 0, compression: 0, prevCompression: 0, onGround: false }));

    scene.onBeforePhysicsObservable.add(() => this.physicsTick());
  }

  /** Place the car at a pose and zero all motion. */
  teleport(pos: Vector3, heading: number): void {
    this.root.position.copyFrom(pos);
    this.root.rotationQuaternion = Quaternion.FromEulerAngles(0, heading, 0);
    this.body.setLinearVelocity(Vector3.Zero());
    this.body.setAngularVelocity(Vector3.Zero());
    this.drivetrain.reset();
    this.prevVel.setAll(0);
    this.reversing = false;
    this.brakeStillMs = 0;
    for (const w of this.wheels) { w.compression = 0; w.prevCompression = 0; w.spinAngle = 0; }
  }

  private physicsTick(): void {
    const dt = Math.min(Math.max(this.scene.getEngine().getDeltaTime() / 1000, 1 / 240), 1 / 30);
    const m = this.root.getWorldMatrix();
    const up = this.upVec;
    Vector3.TransformNormalToRef(Vector3.UpReadOnly, m, up);
    up.normalize();

    this.body.getLinearVelocityToRef(this.vel);
    this.body.getAngularVelocityToRef(this.angVel);

    // chassis axes
    const fwd = Vector3.TransformNormal(Vector3.Forward(), m).normalize();
    const right = Vector3.Cross(up, fwd).normalize();
    this.speed = Vector3.Dot(this.vel, fwd);
    this.speedKmh = Math.abs(this.speed) * 3.6;

    // accelerations for camera G-effects
    this.tmpA.copyFrom(this.vel).subtractInPlace(this.prevVel).scaleInPlace(1 / dt);
    this.latAccel = Vector3.Dot(this.tmpA, right);
    this.longAccel = Vector3.Dot(this.tmpA, fwd);
    this.prevVel.copyFrom(this.vel);

    // reverse mode bookkeeping: hold brake at standstill to back out of walls
    if (this.brake > 0.3 && Math.abs(this.speed) < 0.6) this.brakeStillMs += dt * 1000;
    else if (this.throttle > 0.1 || this.speed > 1) { this.brakeStillMs = 0; this.reversing = false; }
    if (this.brakeStillMs > 350) this.reversing = true;

    // steering: speed sensitive
    const speedT = Math.min(Math.abs(this.speed) / 75, 1);
    const maxSteer = MAX_STEER_LOW + (MAX_STEER_HIGH - MAX_STEER_LOW) * speedT;
    const steerAngle = this.steer * maxSteer;

    // drivetrain
    const rearSpeed = this.speed; // rolling assumption
    const driveForceTotal = this.drivetrain.update(dt * 1000, rearSpeed, this.reversing ? 0 : this.throttle);

    const comWorld = Vector3.TransformCoordinates(COM_LOCAL, m);

    let groundedCount = 0;
    for (const w of this.wheels) {
      w.steerAngle = w.isFront ? steerAngle : 0;

      const start = Vector3.TransformCoordinates(w.local, m);
      const rayLen = SUSPENSION_REST + WHEEL_RADIUS;
      const end = this.tmpA.copyFrom(up).scaleInPlace(-rayLen).addInPlace(start);
      this.plugin.raycast(start, end, this.raycastResult, { collideWith: FILTER_TRACK });

      w.prevCompression = w.compression;
      if (!this.raycastResult.hasHit) {
        w.compression = 0;
        w.onGround = false;
        continue;
      }
      const dist = this.raycastResult.hitDistance;
      w.compression = Math.min(Math.max(SUSPENSION_REST - (dist - WHEEL_RADIUS), 0), SUSPENSION_REST);
      w.onGround = true;
      groundedCount++;

      // suspension (applied at hardpoint for stability), with anti-roll coupling
      const compRate = (w.compression - w.prevCompression) / dt;
      const axleMate = this.wheels[this.wheels.indexOf(w) ^ 1]; // L/R pair share an axle
      const arb = ARB_K * (w.compression - axleMate.compression);
      const fz = Math.min(
        Math.max(SPRING_K * w.compression + SPRING_C * compRate + arb, 0),
        MAX_WHEEL_FORCE,
      );
      this.body.applyForce(this.tmpA.copyFrom(up).scaleInPlace(fz), start);

      // tire frame
      const cosS = Math.cos(w.steerAngle), sinS = Math.sin(w.steerAngle);
      const wFwd = this.tmpA.set(
        fwd.x * cosS + right.x * sinS,
        fwd.y * cosS + right.y * sinS,
        fwd.z * cosS + right.z * sinS,
      );
      const wRight = Vector3.Cross(up, wFwd).normalize();

      // contact point velocity
      const contact = this.raycastResult.hitPointWorld;
      const rel = this.tmpB.copyFrom(contact).subtractInPlace(comWorld);
      const vContact = Vector3.Cross(this.angVel, rel).addInPlace(this.vel);
      const vLong = Vector3.Dot(vContact, wFwd);
      const vLat = Vector3.Dot(vContact, wRight);

      // lateral (brush model, load-proportional stiffness)
      const slipAngle = Math.atan2(vLat, Math.max(Math.abs(vLong), 1.0));
      let fy = -CORNERING_STIFF * slipAngle * fz;

      // longitudinal
      let fx = 0;
      if (!w.isFront && !this.reversing) fx += driveForceTotal / 2;
      if (!w.isFront && this.reversing && this.brake > 0.1 && this.speed > -REVERSE_MAX_SPEED) {
        fx -= REVERSE_FORCE * this.brake;
      }
      const brakeMax = w.isFront ? BRAKE_FORCE_FRONT : BRAKE_FORCE_REAR;
      const braking = this.reversing ? 0 : this.brake;
      // smooth brake force through zero speed to avoid jitter
      const brakeForce = brakeMax * braking * Math.min(Math.abs(vLong) / 1.5, 1);
      fx -= Math.sign(vLong) * (brakeForce + ROLL_RESIST * fz * Math.min(Math.abs(vLong), 1));

      // friction circle
      const cap = MU_ROAD * fz;
      const mag = Math.hypot(fx, fy);
      if (mag > cap && mag > 0) { fx *= cap / mag; fy *= cap / mag; }

      const force = this.tmpB.set(
        wFwd.x * fx + wRight.x * fy,
        wFwd.y * fx + wRight.y * fy,
        wFwd.z * fx + wRight.z * fy,
      );
      this.body.applyForce(force, contact);

      // visual spin
      w.spinAngle += (vLong / WHEEL_RADIUS) * dt;
    }

    // aero: downforce 40/60 front/rear + drag, only meaningful when grounded
    const v2 = this.vel.lengthSquared();
    if (v2 > 4 && groundedCount > 0) {
      const df = DOWNFORCE_COEF * v2;
      const frontPt = Vector3.TransformCoordinates(this.tmpA.set(0, -0.2, 1.4), m);
      const rearPt = Vector3.TransformCoordinates(this.tmpB.set(0, -0.2, -1.4), m);
      this.body.applyForce(up.scale(-df * 0.4), frontPt);
      this.body.applyForce(up.scale(-df * 0.6), rearPt);
      const drag = this.vel.normalizeToNew().scaleInPlace(-DRAG_COEF * v2);
      this.body.applyForce(drag, comWorld);
    }
  }
}
