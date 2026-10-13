import type { Asset, FogOperation, Point, Scene, Token } from '../shared/model.js';
import type { Camera } from '../shared/geometry.js';
import { distance, hexToWorld } from '../shared/geometry.js';
import { resolveAsset } from './assets.js';
import type { Tool } from './store.js';
import { useTable } from './store.js';
interface ImageEntry {
  image: HTMLCanvasElement | null;
  failed: boolean;
  used: number;
  bytes: number;
}
const imageCache = new Map<string, ImageEntry>();
let imageBytes = 0;
useTable.subscribe((state, previous) => {
  if (
    state.room.id !== previous.room.id ||
    state.self?.id !== previous.self?.id ||
    state.self?.role !== previous.self?.role
  ) {
    imageCache.clear();
    imageBytes = 0;
  }
});
export function invalidateImage(asset: Asset, roomId: string) {
  const key = `${roomId}/${asset.kind}/${asset.url}`;
  const entry = imageCache.get(key);
  if (entry) imageBytes -= entry.bytes;
  imageCache.delete(key);
}
function image(asset: Asset, roomId: string, map: boolean, redraw: () => void): ImageEntry {
  const key = `${roomId}/${asset.kind}/${asset.url}`,
    existing = imageCache.get(key);
  if (existing) {
    existing.used = performance.now();
    return existing;
  }
  const entry: ImageEntry = { image: null, failed: false, used: performance.now(), bytes: 0 };
  imageCache.set(key, entry);
  const source = new Image();
  const timeout = setTimeout(() => {
    entry.failed = true;
    redraw();
  }, 12000);
  source.onload = () => {
    clearTimeout(timeout);
    if (imageCache.get(key) !== entry) return;
    if (!source.naturalWidth || source.naturalWidth * source.naturalHeight > 40000000) {
      entry.failed = true;
      redraw();
      return;
    }
    const scale = Math.min(1, (map ? 2048 : 256) / Math.max(source.width, source.height)),
      canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(source.width * scale));
    canvas.height = Math.max(1, Math.round(source.height * scale));
    canvas.getContext('2d')!.drawImage(source, 0, 0, canvas.width, canvas.height);
    entry.image = canvas;
    entry.failed = false;
    entry.bytes = canvas.width * canvas.height * 4;
    imageBytes += entry.bytes;
    while (imageBytes > 64 * 1024 * 1024 && imageCache.size > 1) {
      const oldest = [...imageCache]
        .filter(([k]) => k !== key)
        .sort((a, b) => a[1].used - b[1].used)[0];
      if (!oldest) break;
      imageBytes -= oldest[1].bytes;
      imageCache.delete(oldest[0]);
    }
    redraw();
  };
  source.onerror = () => {
    clearTimeout(timeout);
    entry.failed = true;
    redraw();
  };
  source.referrerPolicy = 'no-referrer';
  void resolveAsset(asset, roomId)
    .then((url) => (source.src = url))
    .catch(() => {
      clearTimeout(timeout);
      entry.failed = true;
      redraw();
    });
  return entry;
}
export function polygonPath(ctx: CanvasRenderingContext2D, points: Point[], closed = true) {
  ctx.beginPath();
  points.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
  if (closed) ctx.closePath();
}
export function conePoints(a: Point, b: Point) {
  const angle = Math.atan2(b.y - a.y, b.x - a.x),
    r = Math.hypot(b.x - a.x, b.y - a.y);
  return [
    a,
    ...Array.from({ length: 25 }, (_, i) => {
      const v = angle - Math.PI / 6 + ((i / 24) * Math.PI) / 3;
      return { x: a.x + Math.cos(v) * r, y: a.y + Math.sin(v) * r };
    }),
  ];
}
function fogPath(ctx: CanvasRenderingContext2D, op: FogOperation) {
  ctx.beginPath();
  if (op.shape === 'circle') ctx.arc(op.x, op.y, op.radius!, 0, Math.PI * 2);
  else if (op.shape === 'rectangle') ctx.rect(op.x, op.y, op.width!, op.height!);
  else polygonPath(ctx, op.points!);
}
export interface Draft {
  tool: Tool;
  start: Point;
  end: Point;
  points: Point[];
  completed?: boolean;
}
interface RenderOptions {
  scene: Scene;
  roomId: string;
  camera: Camera;
  width: number;
  height: number;
  dpr: number;
  gm: boolean;
  selected: string[];
  previews: Record<string, Point>;
  localDragging: Set<string>;
  reducedMotion: boolean;
  pings: Array<Point & { at: number }>;
  draft: Draft | null;
  tool: Tool;
  zoneShape: string;
  fogShape: string;
  fogMode: string;
  brushSize: number;
  drawColor: string;
  drawWidth: number;
  measurementShape: string;
  redraw: () => void;
}
export class SceneRenderer {
  private positions = new Map<string, Point>();
  private fog: {
    canvas: HTMLCanvasElement;
    source: Scene['fog'];
    camera: Camera;
    sceneId: string;
    gm: boolean;
    w: number;
    h: number;
  } | null = null;
  draw(ctx: CanvasRenderingContext2D, o: RenderOptions): boolean {
    const { scene: s, camera: c, width: w, height: h, dpr } = o;
    let animating = false;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.save();
    ctx.translate(c.x, c.y);
    ctx.scale(c.zoom, c.zoom);
    ctx.shadowColor = '#000';
    ctx.shadowBlur = 30;
    ctx.fillStyle = '#1d2924';
    ctx.fillRect(0, 0, s.width, s.height);
    ctx.shadowBlur = 0;
    const map = image(s.map, o.roomId, true, o.redraw);
    if (map.image) ctx.drawImage(map.image, 0, 0, s.width, s.height);
    if (map.failed) {
      ctx.fillStyle = '#a8b4a4';
      ctx.textAlign = 'center';
      ctx.font = '22px Georgia';
      ctx.fillText(
        'Map unavailable · replace or retry it in Scene settings',
        s.width / 2,
        s.height / 2,
      );
    }
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, s.width, s.height);
    ctx.clip();
    if (s.grid.enabled && s.grid.size * c.zoom >= 6) {
      ctx.strokeStyle = `rgba(221,223,192,${s.grid.opacity})`;
      ctx.lineWidth = 1 / c.zoom;
      ctx.beginPath();
      if (s.grid.type === 'hex') {
        const radius = s.grid.size / Math.sqrt(3);
        const left = Math.max(0, -c.x / c.zoom),
          right = Math.min(s.width, (w - c.x) / c.zoom),
          top = Math.max(0, -c.y / c.zoom),
          bottom = Math.min(s.height, (h - c.y) / c.zoom);
        for (
          let r = Math.floor((top - s.grid.offsetY) / (radius * 1.5)) - 2;
          r <= Math.ceil((bottom - s.grid.offsetY) / (radius * 1.5)) + 2;
          r++
        )
          for (
            let q = Math.floor((left - s.grid.offsetX) / s.grid.size - r / 2) - 2;
            q <= Math.ceil((right - s.grid.offsetX) / s.grid.size - r / 2) + 2;
            q++
          ) {
            const p = hexToWorld(q, r, s.grid);
            for (let i = 0; i < 6; i++) {
              const angle = ((i * 60 - 30) * Math.PI) / 180,
                x = p.x + Math.cos(angle) * radius,
                y = p.y + Math.sin(angle) * radius;
              if (i) ctx.lineTo(x, y);
              else ctx.moveTo(x, y);
            }
            ctx.closePath();
          }
      } else {
        for (let x = s.grid.offsetX; x < s.width; x += s.grid.size) {
          ctx.moveTo(x, 0);
          ctx.lineTo(x, s.height);
        }
        for (let y = s.grid.offsetY; y < s.height; y += s.grid.size) {
          ctx.moveTo(0, y);
          ctx.lineTo(s.width, y);
        }
      }
      ctx.stroke();
    }
    for (const z of Object.values(s.zones)) {
      ctx.save();
      ctx.fillStyle = z.color;
      ctx.strokeStyle = z.color;
      ctx.lineWidth = 2 / c.zoom;
      ctx.beginPath();
      if (z.shape === 'circle')
        ctx.ellipse(
          z.x + z.width / 2,
          z.y + z.height / 2,
          z.width / 2,
          z.height / 2,
          0,
          0,
          Math.PI * 2,
        );
      else if (z.points) polygonPath(ctx, z.points, z.shape !== 'line');
      else ctx.rect(z.x, z.y, z.width, z.height);
      ctx.globalAlpha = z.opacity ?? 0.2;
      if (z.shape !== 'line') ctx.fill();
      ctx.globalAlpha = 0.75;
      ctx.setLineDash([8 / c.zoom, 5 / c.zoom]);
      ctx.stroke();
      ctx.restore();
      ctx.fillStyle = z.color;
      ctx.font = `${13 / c.zoom}px sans-serif`;
      ctx.textAlign = 'left';
      ctx.fillText(z.label, z.x + 8 / c.zoom, z.y - 8 / c.zoom);
    }
    for (const a of Object.values(s.annotations || {})) {
      ctx.save();
      ctx.globalAlpha = a.visibility === 'gm' ? 0.55 : 1;
      ctx.fillStyle = a.color;
      ctx.strokeStyle = a.color;
      ctx.lineWidth = a.width;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      if (a.kind === 'text') {
        ctx.font = `${Math.max(14, a.width * 5)}px Georgia`;
        ctx.textAlign = 'left';
        a.text
          .split('\n')
          .forEach((line, i) =>
            ctx.fillText(line, a.points[0].x, a.points[0].y + i * Math.max(18, a.width * 6)),
          );
      } else {
        polygonPath(ctx, a.points, false);
        ctx.stroke();
      }
      ctx.restore();
    }
    for (const id of this.positions.keys()) if (!s.tokens[id]) this.positions.delete(id);
    for (const t of Object.values(s.tokens)) {
      const target = o.previews[t.id] || t,
        last = this.positions.get(t.id),
        gap = last ? Math.hypot(last.x - target.x, last.y - target.y) : 0,
        p =
          last && gap > 0.5 && gap < 400 && !o.localDragging.has(t.id) && !o.reducedMotion
            ? { x: last.x + (target.x - last.x) * 0.4, y: last.y + (target.y - last.y) * 0.4 }
            : target;
      if (p !== target) animating = true;
      this.positions.set(t.id, p);
      this.token(ctx, t, p, o, c.zoom);
    }
    if (s.fog.enabled) {
      let mask = this.fog;
      if (
        !mask ||
        mask.source !== s.fog ||
        mask.camera !== c ||
        mask.sceneId !== s.id ||
        mask.gm !== o.gm ||
        mask.w !== w ||
        mask.h !== h
      ) {
        const canvas = mask?.canvas || document.createElement('canvas');
        canvas.width = Math.ceil(w * dpr);
        canvas.height = Math.ceil(h * dpr);
        const f = canvas.getContext('2d')!;
        f.setTransform(dpr * c.zoom, 0, 0, dpr * c.zoom, dpr * c.x, dpr * c.y);
        f.fillStyle = '#060d09';
        f.fillRect(0, 0, s.width, s.height);
        f.globalCompositeOperation = 'destination-out';
        for (const p of s.fog.revealed) {
          f.beginPath();
          f.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
          f.fill();
        }
        for (const op of s.fog.operations || []) {
          f.globalCompositeOperation = op.mode === 'reveal' ? 'destination-out' : 'source-over';
          fogPath(f, op);
          f.fill();
        }
        mask = { canvas, source: s.fog, camera: c, sceneId: s.id, gm: o.gm, w, h };
        this.fog = mask;
      }
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = o.gm ? 0.62 : 1;
      ctx.drawImage(mask.canvas, 0, 0);
      ctx.restore();
    }
    for (const p of o.pings) {
      const life = (Date.now() - p.at) / 2000;
      if (life > 1) continue;
      animating = true;
      ctx.strokeStyle = `rgba(224,190,117,${1 - life})`;
      ctx.lineWidth = 2 / c.zoom;
      ctx.beginPath();
      ctx.arc(p.x, p.y, (12 + 65 * life) / c.zoom, 0, Math.PI * 2);
      ctx.stroke();
    }
    if (o.draft) this.draft(ctx, o.draft, o);
    ctx.restore();
    ctx.restore();
    return animating;
  }
  private token(ctx: CanvasRenderingContext2D, t: Token, p: Point, o: RenderOptions, zoom: number) {
    const r = t.size / 2;
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate((t.rotation * Math.PI) / 180);
    if (t.visibility === 'gm') ctx.globalAlpha = 0.5;
    if (o.selected.includes(t.id)) {
      ctx.shadowColor = t.color;
      ctx.shadowBlur = 20;
      ctx.strokeStyle = t.color;
      ctx.lineWidth = 2 / zoom;
      ctx.beginPath();
      ctx.arc(0, 0, r + 9 / zoom, 0, Math.PI * 2);
      ctx.stroke();
      ctx.shadowBlur = 0;
    }
    ctx.shadowColor = '#000b';
    ctx.shadowBlur = 12;
    ctx.fillStyle = '#14221c';
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.save();
    ctx.beginPath();
    ctx.arc(0, 0, r - 3 / zoom, 0, Math.PI * 2);
    ctx.clip();
    const portrait = image(t.image, o.roomId, false, o.redraw);
    if (portrait.image) ctx.drawImage(portrait.image, -r, -r, 2 * r, 2 * r);
    else {
      ctx.fillStyle = t.color;
      ctx.font = `bold ${r}px Georgia`;
      ctx.textAlign = 'center';
      ctx.fillText(t.name[0], 0, r / 3);
    }
    ctx.restore();
    ctx.strokeStyle = t.color;
    ctx.lineWidth = 3 / zoom;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
    const label = t.name.split(' · ')[0];
    ctx.font = `500 ${11 / zoom}px sans-serif`;
    ctx.textAlign = 'center';
    const tw = ctx.measureText(label).width;
    ctx.fillStyle = '#111b16ed';
    ctx.fillRect(p.x - tw / 2 - 7 / zoom, p.y + r + 6 / zoom, tw + 14 / zoom, 20 / zoom);
    ctx.fillStyle = '#eee8d9';
    ctx.fillText(label, p.x, p.y + r + 20 / zoom);
    if (t.resource) {
      const bw = t.size * 0.7;
      ctx.fillStyle = '#10221c';
      ctx.fillRect(p.x - bw / 2, p.y + r - 7 / zoom, bw, 4 / zoom);
      ctx.fillStyle = t.color;
      ctx.fillRect(
        p.x - bw / 2,
        p.y + r - 7 / zoom,
        bw * Math.min(1, t.resource.value / t.resource.max),
        4 / zoom,
      );
    }
    const icons = { star: '✦', shield: '◆', flame: '♨', eye: '◉', circle: '●' };
    for (const [i, status] of (t.statuses || []).entries()) {
      const x = p.x - r + (i * 15) / zoom,
        y = p.y - r - 7 / zoom;
      ctx.fillStyle = '#122019';
      ctx.beginPath();
      ctx.arc(x, y, 7 / zoom, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = status.color;
      ctx.font = `${10 / zoom}px sans-serif`;
      ctx.fillText(icons[status.icon], x, y + 3 / zoom);
    }
  }
  private draft(ctx: CanvasRenderingContext2D, d: Draft, o: RenderOptions) {
    const { start: a, end: b } = d,
      c = o.camera;
    ctx.strokeStyle = o.drawColor;
    ctx.fillStyle = o.drawColor;
    ctx.lineWidth = 2 / c.zoom;
    ctx.setLineDash([7 / c.zoom, 5 / c.zoom]);
    if (d.tool === 'draw') {
      ctx.setLineDash([]);
      ctx.lineWidth = o.drawWidth;
      polygonPath(ctx, d.points, false);
      ctx.stroke();
      return;
    }
    if (d.tool === 'select') {
      ctx.strokeRect(a.x, a.y, b.x - a.x, b.y - a.y);
      return;
    }
    if (d.tool === 'measure') {
      const mode = o.measurementShape;
      if (mode === 'path') {
        polygonPath(ctx, [...d.points, b], false);
        ctx.stroke();
      } else if (mode === 'radius') {
        ctx.beginPath();
        ctx.arc(a.x, a.y, Math.hypot(b.x - a.x, b.y - a.y), 0, Math.PI * 2);
        ctx.stroke();
      } else if (mode === 'area') ctx.strokeRect(a.x, a.y, b.x - a.x, b.y - a.y);
      else if (mode === 'cone') {
        polygonPath(ctx, conePoints(a, b));
        ctx.stroke();
      } else {
        polygonPath(ctx, [a, b], false);
        ctx.stroke();
      }
      const length =
        mode === 'path'
          ? [...d.points, b].reduce(
              (n, p, i, all) => (i ? n + distance(all[i - 1], p, o.scene.grid) : 0),
              0,
            )
          : distance(a, b, o.scene.grid);
      const area =
        mode === 'area'
          ? ((Math.abs(b.x - a.x) * Math.abs(b.y - a.y)) / o.scene.grid.size ** 2) *
            o.scene.grid.distance ** 2
          : Math.PI * length ** 2 * (mode === 'cone' ? 1 / 6 : 1);
      const text =
        mode === 'area'
          ? `${area.toFixed(1)} ${o.scene.grid.units}²`
          : mode === 'radius' || mode === 'cone'
            ? `${length.toFixed(1)} ${o.scene.grid.units} · ${area.toFixed(1)} ${o.scene.grid.units}²`
            : `${length.toFixed(1)} ${o.scene.grid.units}`;
      ctx.font = `bold ${14 / c.zoom}px sans-serif`;
      ctx.fillStyle = '#fff0c8';
      ctx.textAlign = 'center';
      ctx.fillText(text, (a.x + b.x) / 2, (a.y + b.y) / 2 - 12 / c.zoom);
      return;
    }
    const shape = d.tool === 'fog' ? o.fogShape : o.zoneShape;
    if (shape === 'polygon') polygonPath(ctx, [...d.points, b]);
    else if (shape === 'circle') {
      ctx.beginPath();
      ctx.arc(
        a.x,
        a.y,
        d.tool === 'fog' ? o.brushSize : Math.hypot(b.x - a.x, b.y - a.y),
        0,
        Math.PI * 2,
      );
    } else if (shape === 'cone') polygonPath(ctx, conePoints(a, b));
    else if (shape === 'line') polygonPath(ctx, [a, b], false);
    else {
      ctx.beginPath();
      ctx.rect(a.x, a.y, b.x - a.x, b.y - a.y);
    }
    ctx.stroke();
    ctx.globalAlpha = 0.15;
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.setLineDash([]);
  }
}
