import type { Point, Scene, Token, Wall } from './model.js';
import { fogAllowsToken } from './regions.js';

const TAU = Math.PI * 2;
const angleDelta = (angle: number, center: number) =>
  Math.atan2(Math.sin(angle - center), Math.cos(angle - center));
export const blocksSight = (wall: Wall) =>
  wall.kind !== 'window' && !(wall.kind === 'door' && wall.open);
function intersection(origin: Point, dx: number, dy: number, wall: Wall): number | undefined {
  const sx = wall.b.x - wall.a.x,
    sy = wall.b.y - wall.a.y;
  const cross = dx * sy - dy * sx;
  if (Math.abs(cross) < 1e-9) return;
  const qx = wall.a.x - origin.x,
    qy = wall.a.y - origin.y;
  const t = (qx * sy - qy * sx) / cross,
    u = (qx * dy - qy * dx) / cross;
  if (t > 1e-7 && u >= 0 && u <= 1) return t;
}
export function relevantWalls(
  walls: Record<string, Wall> | undefined,
  p: Point,
  range: number,
): Wall[] {
  return Object.values(walls || {}).filter(
    (w) =>
      blocksSight(w) &&
      Math.min(w.a.x, w.b.x) <= p.x + range &&
      Math.max(w.a.x, w.b.x) >= p.x - range &&
      Math.min(w.a.y, w.b.y) <= p.y + range &&
      Math.max(w.a.y, w.b.y) >= p.y - range,
  );
}
export function sightContains(
  source: Token,
  target: Point,
  walls: Record<string, Wall> | undefined,
): boolean {
  const sight = source.sight || { range: 600, angle: 360 },
    dx = target.x - source.x,
    dy = target.y - source.y;
  const distance = Math.hypot(dx, dy);
  if (distance > sight.range) return false;
  if (distance < 1e-7) return true;
  if (
    sight.angle < 360 &&
    Math.abs(angleDelta(Math.atan2(dy, dx), (source.rotation * Math.PI) / 180)) >
      (sight.angle * Math.PI) / 360
  )
    return false;
  return !relevantWalls(walls, source, distance).some((wall) => {
    const t = intersection(source, dx / distance, dy / distance, wall);
    return t !== undefined && t < distance - 1e-7;
  });
}
const visibilityCache = new WeakMap<
  Scene,
  Map<string, { sources: Token[]; results: Map<string, boolean> }>
>();
export function isSharedVisionSource(token: Token, playerIds: readonly string[]): boolean {
  return (
    token.visibility === 'public' &&
    (token.owners.includes('*') || token.owners.some((id) => playerIds.includes(id)))
  );
}
export function visibleTo(
  scene: Scene,
  userId: string,
  target: Token,
  playerIds: readonly string[] = [userId],
): boolean {
  if (!scene.lighting?.vision) return true;
  let users = visibilityCache.get(scene);
  if (!users) {
    users = new Map();
    visibilityCache.set(scene, users);
  }
  const teamKey = [...playerIds].sort().join('|');
  let cached = users.get(teamKey);
  if (!cached) {
    cached = {
      sources: Object.values(scene.tokens).filter(
        (t) => isSharedVisionSource(t, playerIds) && fogAllowsToken(scene.fog, t),
      ),
      results: new Map(),
    };
    if (users.size >= 20) users.delete(users.keys().next().value!);
    users.set(teamKey, cached);
  }
  const key = `${target.id}/${target.x}/${target.y}`;
  const prior = cached.results.get(key);
  if (prior !== undefined) return prior;
  const result = cached.sources.some((source) => {
    if (source.id === target.id) return true;
    const dx = target.x - source.x,
      dy = target.y - source.y,
      distance = Math.hypot(dx, dy);
    if (distance < 1e-7) return true;
    return !relevantWalls(scene.walls, source, distance).some((wall) => {
      const hit = intersection(source, dx / distance, dy / distance, wall);
      return hit !== undefined && hit < distance - 1e-7;
    });
  });
  if (cached.results.size >= 300) cached.results.clear();
  cached.results.set(key, result);
  return result;
}
/** Polygon approximates the outer circular arc; wall endpoints use offset rays for sharp shadows. */
export function visibilityPolygon(
  origin: Point,
  range: number,
  angle: number,
  rotation: number,
  walls: Record<string, Wall> | undefined,
): Point[] {
  if (range <= 0) return [];
  const candidates = relevantWalls(walls, origin, range),
    center = (rotation * Math.PI) / 180,
    span = (angle * Math.PI) / 180,
    full = angle >= 360;
  const start = center - span / 2,
    rays: number[] = [];
  const count = Math.max(4, Math.ceil((64 * angle) / 360));
  for (let i = 0; i <= count; i++) rays.push(start + (span * i) / count);
  for (const wall of candidates)
    for (const p of [wall.a, wall.b]) {
      const theta = Math.atan2(p.y - origin.y, p.x - origin.x);
      const offset = full
        ? (((theta - start) % TAU) + TAU) % TAU
        : angleDelta(theta, center) + span / 2;
      for (const n of [-0.00001, 0, 0.00001])
        if (offset + n >= 0 && offset + n <= span) rays.push(start + offset + n);
    }
  rays.sort((a, b) => a - b);
  const points = rays.map((theta) => {
    const dx = Math.cos(theta),
      dy = Math.sin(theta);
    let distance = range;
    for (const wall of candidates) {
      const t = intersection(origin, dx, dy, wall);
      if (t !== undefined && t < distance) distance = t;
    }
    return { x: origin.x + dx * distance, y: origin.y + dy * distance };
  });
  return full ? points : [origin, ...points];
}
