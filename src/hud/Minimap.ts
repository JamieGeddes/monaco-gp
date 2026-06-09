import { TrackData } from '../track/TrackData';

/** 2D canvas minimap: cached track outline + live car dot. */
export class Minimap {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private bg: HTMLCanvasElement;
  private toPx: (x: number, z: number) => [number, number];

  constructor(track: TrackData) {
    this.canvas = document.getElementById('minimap') as HTMLCanvasElement;
    this.ctx = this.canvas.getContext('2d')!;
    const W = this.canvas.width, H = this.canvas.height;

    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const p of track.points) {
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
      minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z);
    }
    const pad = 14;
    const scale = Math.min((W - pad * 2) / (maxX - minX), (H - pad * 2) / (maxZ - minZ));
    const ox = (W - (maxX - minX) * scale) / 2;
    const oy = (H - (maxZ - minZ) * scale) / 2;
    this.toPx = (x, z) => [ox + (x - minX) * scale, H - (oy + (z - minZ) * scale)];

    // cache the outline
    this.bg = document.createElement('canvas');
    this.bg.width = W; this.bg.height = H;
    const bctx = this.bg.getContext('2d')!;
    bctx.strokeStyle = 'rgba(255,255,255,0.85)';
    bctx.lineWidth = 2.5;
    bctx.lineJoin = 'round';
    bctx.beginPath();
    track.points.forEach((p, i) => {
      const [px, py] = this.toPx(p.x, p.z);
      if (i === 0) bctx.moveTo(px, py); else bctx.lineTo(px, py);
    });
    bctx.closePath();
    bctx.stroke();
    // SF tick
    const [sx, sy] = this.toPx(track.sf.ax, track.sf.az);
    const [ex, ey] = this.toPx(track.sf.bx, track.sf.bz);
    bctx.strokeStyle = '#e23';
    bctx.lineWidth = 3;
    bctx.beginPath();
    const cx = (sx + ex) / 2, cy = (sy + ey) / 2;
    const dx = ex - sx, dy = ey - sy;
    const dl = Math.hypot(dx, dy) || 1;
    bctx.moveTo(cx - (dx / dl) * 5, cy - (dy / dl) * 5);
    bctx.lineTo(cx + (dx / dl) * 5, cy + (dy / dl) * 5);
    bctx.stroke();
  }

  update(x: number, z: number): void {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.ctx.drawImage(this.bg, 0, 0);
    const [px, py] = this.toPx(x, z);
    this.ctx.fillStyle = '#ff2a2a';
    this.ctx.beginPath();
    this.ctx.arc(px, py, 4, 0, Math.PI * 2);
    this.ctx.fill();
    this.ctx.strokeStyle = 'rgba(0,0,0,0.6)';
    this.ctx.lineWidth = 1;
    this.ctx.stroke();
  }
}
