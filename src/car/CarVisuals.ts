import {
  Color3, DynamicTexture, Mesh, MeshBuilder, Scene, StandardMaterial, TransformNode, Vector3,
} from '@babylonjs/core';
import { Vehicle } from './Vehicle';

/**
 * Procedural modern-F1 cockpit, built from primitives and parented to the physics chassis.
 * Driver-eye view shows: nose + front wing, exposed steering front wheels, halo,
 * mirrors, cockpit tub sides, and the steering wheel (with live gear display).
 */
export class CarVisuals {
  readonly steeringWheel: TransformNode;
  private gearTexture: DynamicTexture;
  private gearCtx: CanvasRenderingContext2D;
  private frontWheels: { node: TransformNode; spin: Mesh; index: number }[] = [];
  private lastGearShown = '';

  constructor(scene: Scene, private vehicle: Vehicle) {
    const root = vehicle.root;

    const carbon = new StandardMaterial('carbon', scene);
    carbon.diffuseColor = new Color3(0.07, 0.07, 0.08);
    carbon.specularColor = new Color3(0.1, 0.1, 0.11);
    carbon.specularPower = 128;
    const livery = new StandardMaterial('livery', scene);
    livery.diffuseColor = new Color3(0.72, 0.04, 0.05);
    livery.specularColor = new Color3(0.18, 0.1, 0.1);
    livery.specularPower = 96;
    const tire = new StandardMaterial('tire', scene);
    tire.diffuseColor = new Color3(0.05, 0.05, 0.05);
    tire.specularColor = new Color3(0.12, 0.12, 0.12);

    // --- nose: tapered cone from cockpit front to wing
    const nose = MeshBuilder.CreateCylinder('nose', {
      diameterTop: 0.5, diameterBottom: 0.16, height: 1.9, tessellation: 10,
    }, scene);
    nose.rotation.x = Math.PI / 2 + 0.06;
    nose.position.set(0, 0.02, 1.55);
    nose.parent = root;
    nose.material = livery;

    // --- front wing
    const wing = MeshBuilder.CreateBox('wing', { width: 1.9, height: 0.05, depth: 0.62 }, scene);
    wing.position.set(0, -0.28, 2.52);
    wing.parent = root;
    wing.material = carbon;
    for (const sx of [-1, 1]) {
      const ep = MeshBuilder.CreateBox('endplate', { width: 0.04, height: 0.26, depth: 0.62 }, scene);
      ep.position.set(sx * 0.95, -0.15, 2.52);
      ep.parent = root;
      ep.material = livery;
    }

    // --- cockpit tub sides + headrest
    for (const sx of [-1, 1]) {
      const side = MeshBuilder.CreateBox('tubSide', { width: 0.16, height: 0.3, depth: 1.5 }, scene);
      side.position.set(sx * 0.46, 0.32, 0.45);
      side.parent = root;
      side.material = livery;
    }
    const front = MeshBuilder.CreateBox('tubFront', { width: 1.05, height: 0.34, depth: 0.55 }, scene);
    front.position.set(0, 0.31, 1.15);
    front.parent = root;
    front.material = livery;
    const headrest = MeshBuilder.CreateBox('headrest', { width: 0.95, height: 0.28, depth: 0.3 }, scene);
    headrest.position.set(0, 0.42, -0.55);
    headrest.parent = root;
    headrest.material = carbon;

    // --- engine cover behind driver
    const cover = MeshBuilder.CreateCylinder('cover', {
      diameterTop: 0.3, diameterBottom: 0.9, height: 2.2, tessellation: 8,
    }, scene);
    cover.rotation.x = -Math.PI / 2 - 0.1;
    cover.position.set(0, 0.35, -1.6);
    cover.parent = root;
    cover.material = livery;

    // --- halo: ring around the cockpit opening (apex ahead of the driver) + center pylon
    const haloPath: Vector3[] = [];
    for (let i = 0; i <= 24; i++) {
      const a = (i / 24) * Math.PI; // 0 = right shoulder, pi = left shoulder
      haloPath.push(new Vector3(
        Math.cos(a) * 0.48,
        0.78 + Math.sin(a) * 0.11,
        -0.05 + Math.sin(a) * 0.9,
      ));
    }
    const halo = MeshBuilder.CreateTube('halo', { path: haloPath, radius: 0.038, tessellation: 10 }, scene);
    halo.parent = root;
    halo.material = carbon;
    const pylon = MeshBuilder.CreateCylinder('haloPylon', { diameterTop: 0.04, diameterBottom: 0.065, height: 0.45, tessellation: 8 }, scene);
    pylon.position.set(0, 0.66, 0.84);
    pylon.rotation.x = 0.14;
    pylon.parent = root;
    pylon.material = carbon;

    // --- mirrors on short stalks off the tub sides
    const mmat = new StandardMaterial('mirrorMat', scene);
    mmat.diffuseColor = new Color3(0.45, 0.5, 0.58);
    mmat.specularColor = new Color3(0.9, 0.9, 0.95);
    for (const sx of [-1, 1]) {
      const stalk = MeshBuilder.CreateCylinder('mirrorStalk', { diameter: 0.025, height: 0.14, tessellation: 6 }, scene);
      stalk.position.set(sx * 0.58, 0.46, 1.0);
      stalk.rotation.z = sx * 1.1;
      stalk.parent = root;
      stalk.material = carbon;
      const housing = MeshBuilder.CreateBox('mirrorHousing', { width: 0.15, height: 0.08, depth: 0.05 }, scene);
      housing.position.set(sx * 0.66, 0.49, 1.0);
      housing.parent = root;
      housing.material = carbon;
      const glass = MeshBuilder.CreateBox('mirror', { width: 0.13, height: 0.06, depth: 0.012 }, scene);
      glass.position.set(sx * 0.66, 0.49, 0.975);
      glass.parent = root;
      glass.material = mmat;
    }

    // --- dark cockpit rim directly ahead of the driver (immersion: you sit IN the tub)
    const rim = MeshBuilder.CreateBox('cockpitRim', { width: 0.92, height: 0.09, depth: 0.32 }, scene);
    rim.position.set(0, 0.46, 0.76);
    rim.parent = root;
    rim.material = carbon;
    for (const sx of [-1, 1]) {
      const pad = MeshBuilder.CreateBox('cockpitPad', { width: 0.14, height: 0.12, depth: 0.85 }, scene);
      pad.position.set(sx * 0.4, 0.5, 0.1);
      pad.parent = root;
      pad.material = carbon;
    }

    // --- front wheels (visible from cockpit), with steer + spin nodes
    this.vehicle.wheels.forEach((w, i) => {
      if (!w.isFront) return;
      const steerNode = new TransformNode(`wheelSteer${i}`, scene);
      steerNode.position.copyFrom(w.local);
      steerNode.parent = root;
      const wheel = MeshBuilder.CreateCylinder(`wheel${i}`, { diameter: 0.66, height: 0.36, tessellation: 18 }, scene);
      wheel.rotation.z = Math.PI / 2;
      const rim = MeshBuilder.CreateCylinder(`rim${i}`, { diameter: 0.4, height: 0.37, tessellation: 12 }, scene);
      rim.rotation.z = Math.PI / 2;
      const rmat = new StandardMaterial('rim', scene);
      rmat.diffuseColor = new Color3(0.25, 0.25, 0.28);
      rmat.specularColor = new Color3(0.6, 0.6, 0.65);
      rim.material = rmat;
      const spinNode = MeshBuilder.CreateBox(`spinRef${i}`, { size: 0.01 }, scene);
      spinNode.isVisible = false;
      wheel.parent = spinNode;
      rim.parent = spinNode;
      spinNode.parent = steerNode;
      wheel.material = tire;
      this.frontWheels.push({ node: steerNode, spin: spinNode, index: i });

      // suspension arms
      for (const dz of [0.12, -0.12]) {
        const arm = MeshBuilder.CreateCylinder('arm', { diameter: 0.04, height: 0.62, tessellation: 6 }, scene);
        arm.position.set(w.local.x * 0.55, 0.05, w.local.z + dz);
        arm.rotation.z = w.local.x > 0 ? Math.PI / 2 - 0.12 : Math.PI / 2 + 0.12;
        arm.parent = root;
        arm.material = carbon;
      }
    });

    // --- rear wheels (visible in mirrors / peripherally)
    this.vehicle.wheels.forEach((w, i) => {
      if (w.isFront) return;
      const wheel = MeshBuilder.CreateCylinder(`wheelR${i}`, { diameter: 0.72, height: 0.4, tessellation: 18 }, scene);
      wheel.rotation.z = Math.PI / 2;
      wheel.position.copyFrom(w.local);
      wheel.parent = root;
      wheel.material = tire;
    });

    // --- steering column + wheel
    const column = new TransformNode('steeringColumn', scene);
    column.position.set(0, 0.54, 0.72);
    column.rotation.x = -0.42; // tilted toward driver
    column.parent = root;

    this.steeringWheel = new TransformNode('steeringWheel', scene);
    this.steeringWheel.parent = column;

    const grips = new StandardMaterial('grip', scene);
    grips.diffuseColor = new Color3(0.12, 0.1, 0.1);
    grips.specularColor = new Color3(0.05, 0.05, 0.05);
    for (const sx of [-1, 1]) {
      const grip = MeshBuilder.CreateCylinder('grip', { diameter: 0.05, height: 0.13, tessellation: 8 }, scene);
      grip.position.set(sx * 0.155, 0.02, 0);
      grip.parent = this.steeringWheel;
      grip.material = grips;
    }
    const topBar = MeshBuilder.CreateBox('wheelTop', { width: 0.3, height: 0.045, depth: 0.025 }, scene);
    topBar.position.set(0, 0.085, 0);
    topBar.parent = this.steeringWheel;
    topBar.material = grips;
    const botBar = MeshBuilder.CreateBox('wheelBot', { width: 0.26, height: 0.05, depth: 0.03 }, scene);
    botBar.position.set(0, -0.075, 0);
    botBar.parent = this.steeringWheel;
    botBar.material = grips;

    // central display with live gear number
    this.gearTexture = new DynamicTexture('gearDisplay', { width: 128, height: 96 }, scene, false);
    this.gearCtx = this.gearTexture.getContext() as CanvasRenderingContext2D;
    const display = MeshBuilder.CreateBox('display', { width: 0.16, height: 0.11, depth: 0.02 }, scene);
    display.position.set(0, 0.015, -0.005);
    display.parent = this.steeringWheel;
    const dmat = new StandardMaterial('displayMat', scene);
    dmat.diffuseColor = new Color3(0.02, 0.02, 0.02);
    dmat.emissiveTexture = this.gearTexture;
    dmat.specularColor = Color3.Black();
    display.material = dmat;
    this.drawGear('N');
  }

  private drawGear(g: string): void {
    if (g === this.lastGearShown) return;
    this.lastGearShown = g;
    const ctx = this.gearCtx;
    ctx.fillStyle = '#060a06';
    ctx.fillRect(0, 0, 128, 96);
    ctx.fillStyle = '#39ff5a';
    ctx.font = 'bold 72px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(g, 64, 52);
    this.gearTexture.update();
  }

  /** Per-frame: wheel rotation (±92° at full lock, F1-style) + front wheel steer/spin + gear display. */
  update(steerSmoothed: number): void {
    this.steeringWheel.rotation.z = -steerSmoothed * 1.6;
    for (const fw of this.frontWheels) {
      const w = this.vehicle.wheels[fw.index];
      fw.node.rotation.y = w.steerAngle;
      fw.spin.rotation.x = w.spinAngle;
    }
    this.drawGear(this.vehicle.reversing ? 'R' : String(this.vehicle.drivetrain.gear));
  }
}
