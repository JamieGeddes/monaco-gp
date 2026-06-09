import { ArcRotateCamera, Engine, HavokPlugin, Scene, Vector3 } from '@babylonjs/core';
import { EngineAudio } from '../audio/EngineAudio';
import { CockpitCamera } from '../camera/CockpitCamera';
import { CarVisuals } from '../car/CarVisuals';
import { Input } from '../car/Input';
import { Vehicle } from '../car/Vehicle';
import { Hud } from '../hud/Hud';
import { Minimap } from '../hud/Minimap';
import { initHavok } from '../physics/havok';
import { buildBarriers } from '../track/Barriers';
import { buildEnvironment, EnvLights } from '../track/Environment';
import { buildKerbs, buildRoad } from '../track/TrackBuilder';
import { TrackData, TrackProgress } from '../track/TrackData';
import { buildTunnel } from '../track/Tunnel';
import { Autopilot } from './Autopilot';
import { LapTimer } from './LapTimer';
import { StartLights } from './StartLights';

type State = 'menu' | 'grid' | 'racing' | 'paused';

export class Game {
  private engine: Engine;
  private scene: Scene;
  private plugin!: HavokPlugin;
  private track!: TrackData;
  private vehicle!: Vehicle;
  private visuals!: CarVisuals;
  private camera!: CockpitCamera;
  private input = new Input();
  private audio: EngineAudio | null = null;
  private hud = new Hud();
  private minimap!: Minimap;
  private lapTimer!: LapTimer;
  private lights = new StartLights();
  private progress!: TrackProgress;
  private envLights!: EnvLights;

  private state: State = 'menu';
  private throttleEnabled = false;
  private tunnelBlend = 0;
  private debug = new URLSearchParams(location.search).has('debug');
  private autopilot: Autopilot | null = null;
  private autopilotOn = new URLSearchParams(location.search).has('auto');

  private pauseScreen = document.getElementById('pauseScreen')!;
  private fpsEl = document.getElementById('fps')!;

  constructor(canvas: HTMLCanvasElement) {
    this.engine = new Engine(canvas, true, { stencil: false }, true);
    this.scene = new Scene(this.engine);
    window.addEventListener('resize', () => this.engine.resize());
    if (this.debug) document.body.classList.add('debug');
  }

  async init(onProgress: (msg: string) => void): Promise<void> {
    onProgress('Initialising physics…');
    this.plugin = await initHavok(this.scene);

    onProgress('Loading circuit…');
    this.track = new TrackData();
    buildRoad(this.scene, this.track);
    buildKerbs(this.scene, this.track);
    buildBarriers(this.scene, this.track);
    buildTunnel(this.scene, this.track);

    onProgress('Building Monte Carlo…');
    this.envLights = buildEnvironment(this.scene, this.track);

    onProgress('Preparing car…');
    this.vehicle = new Vehicle(this.scene, this.plugin);
    this.visuals = new CarVisuals(this.scene, this.vehicle);
    this.camera = new CockpitCamera(this.scene, this.vehicle);
    this.scene.activeCamera = this.camera.camera;

    this.lapTimer = new LapTimer(this.track.sf);
    this.minimap = new Minimap(this.track);
    this.progress = new TrackProgress(this.track, this.track.length - 15);
    if (this.debug) {
      this.autopilot = new Autopilot(this.track, this.vehicle);
      this.setupDebugCamera();
    }

    this.input.onPause = () => this.togglePause();
    this.input.onRestart = () => { if (this.state === 'racing' || this.state === 'paused' || this.state === 'grid') void this.startRace(); };
    this.input.onAnyKey = () => this.audio?.resume();

    document.getElementById('resumeBtn')!.addEventListener('click', () => this.togglePause());
    document.getElementById('restartBtn')!.addEventListener('click', () => void this.startRace());

    this.engine.runRenderLoop(() => this.frame());
  }

  /** Called from the start button (a user gesture: also unlocks audio). */
  start(): void {
    if (!this.audio) this.audio = new EngineAudio();
    this.audio.resume();
    void this.startRace();
  }

  private placeOnGrid(): void {
    const g = this.track.grid;
    this.vehicle.teleport(new Vector3(g.x, g.y + 0.6, g.z), g.heading);
    this.input.reset();
    this.vehicle.throttle = 0;
    this.vehicle.brake = 0;
    this.vehicle.steer = 0;
    this.camera.snap();
    this.progress.reset(this.track.length - 15);
  }

  private async startRace(): Promise<void> {
    this.lights.cancel();
    this.setPaused(false);
    this.state = 'grid';
    this.throttleEnabled = false;
    this.lapTimer.reset();
    this.placeOnGrid();
    this.hud.show(true);
    this.audio?.setMuted(false);
    this.vehicle.drivetrain.onShift = () => this.audio?.shift();

    const go = await this.lights.run();
    if (go) {
      this.state = 'racing';
      this.throttleEnabled = true;
    }
  }

  private togglePause(): void {
    if (this.state === 'racing') {
      this.state = 'paused';
      this.setPaused(true);
    } else if (this.state === 'paused') {
      this.state = 'racing';
      this.setPaused(false);
    }
  }

  private setPaused(paused: boolean): void {
    this.pauseScreen.classList.toggle('hidden', !paused);
    this.scene.physicsEnabled = !paused;
    this.audio?.setMuted(paused || this.state === 'menu');
  }

  private frame(): void {
    const dt = this.engine.getDeltaTime() / 1000;

    if (this.state === 'racing' || this.state === 'grid') {
      const pos = this.vehicle.root.position;
      const s = this.progress.update(pos.x, pos.z);

      if (this.autopilotOn && this.autopilot) {
        const c = this.autopilot.update(s, dt);
        this.vehicle.steer = c.steer;
        this.vehicle.brake = c.brake;
        this.vehicle.throttle = this.throttleEnabled ? c.throttle : 0;
        this.input.steer = c.steer; // keep the visual wheel in sync
      } else {
        this.input.update(dt);
        this.vehicle.steer = this.input.steer;
        this.vehicle.brake = this.input.brake;
        this.vehicle.throttle = this.throttleEnabled ? this.input.throttle : 0;
      }

      if (this.state === 'racing') {
        this.lapTimer.setFrameDt(dt * 1000);
        this.lapTimer.tick(dt * 1000);
        this.lapTimer.update(pos.x, pos.z);
      }
      this.updateTunnelLighting(s, dt);

      this.camera.update(dt);
      this.visuals.update(this.input.steer);
      this.hud.update(
        this.vehicle.reversing ? 'R' : String(this.vehicle.drivetrain.gear),
        this.vehicle.drivetrain.rpm,
        this.vehicle.speedKmh,
        this.lapTimer,
      );
      this.minimap.update(pos.x, pos.z);
      this.audio?.update(this.vehicle.drivetrain.rpm, this.vehicle.throttle, Math.abs(this.vehicle.speed));
    }

    if (this.debug) {
      const grounded = this.vehicle.wheels.filter((w) => w.onGround).length;
      this.fpsEl.textContent =
        `${this.engine.getFps().toFixed(0)} fps | wheels ${grounded}/4 | ` +
        `rpm ${this.vehicle.drivetrain.rpm.toFixed(0)} | v ${this.vehicle.speedKmh.toFixed(0)}`;
    }
    this.scene.render();
  }

  /** Debug: press C to toggle a free top-down camera over the car. */
  private setupDebugCamera(): void {
    this.vehicle.root.isVisible = true; // show the physics chassis box
    (window as unknown as Record<string, unknown>).__car = {
      state: () => {
        const p = this.vehicle.root.position;
        const s = this.progress.update(p.x, p.z);
        const road = this.track.pointAt(s);
        return {
          s: Math.round(s),
          carY: +p.y.toFixed(3),
          roadY: +road.pos.y.toFixed(3),
          v: +this.vehicle.speedKmh.toFixed(1),
          wheels: this.vehicle.wheels.map((w) => +w.compression.toFixed(3)),
          grounded: this.vehicle.wheels.filter((w) => w.onGround).length,
          lap: this.lapTimer.currentMs,
          lastLap: this.lapTimer.lastMs,
          bestLap: this.lapTimer.bestMs,
          fps: +this.engine.getFps().toFixed(0),
          audio: this.audio?.probe() ?? null,
        };
      },
    };
    const top = new ArcRotateCamera('debugCam', -Math.PI / 2, 0.01, 110, Vector3.Zero(), this.scene);
    top.attachControl(true);
    let active = false;
    window.addEventListener('keydown', (e) => {
      if (e.code !== 'KeyC') return;
      active = !active;
      this.scene.activeCamera = active ? top : this.camera.camera;
    });
    this.scene.onBeforeRenderObservable.add(() => {
      if (active) top.target.copyFrom(this.vehicle.root.position);
    });
  }

  /** Smooth exposure shift inside the tunnel, keyed to car arclength. */
  private updateTunnelLighting(s: number, dt: number): void {
    const [t0, t1] = this.track.tunnel;
    const inTunnel = this.track.inRange(s, t0, t1);
    const target = inTunnel ? 1 : 0;
    const k = Math.min(dt * 3.5, 1);
    this.tunnelBlend += (target - this.tunnelBlend) * k;
    const b = this.tunnelBlend;
    this.envLights.sun.intensity = 1.25 * (1 - b * 0.92);
    this.envLights.ambient.intensity = 0.55 * (1 - b * 0.45);
    this.scene.fogDensity = 0.0012 * (1 - b);
  }
}
