import type { FogOperation, Point, Scene, Token } from './model.js';
export function pointInPolygon(p: Point, points: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[i],
      b = points[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x)
      inside = !inside;
  }
  return inside;
}
export function segmentDistance(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x,
    dy = b.y - a.y,
    l = dx * dx + dy * dy;
  const t = l ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l)) : 0;
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
}
export function containsDisk(s: FogOperation, p: Point, r: number): boolean {
  if (s.shape === 'circle') return Math.hypot(p.x - s.x, p.y - s.y) + r <= s.radius!;
  if (s.shape === 'rectangle')
    return (
      p.x - r >= s.x && p.y - r >= s.y && p.x + r <= s.x + s.width! && p.y + r <= s.y + s.height!
    );
  const points = s.points!;
  return (
    pointInPolygon(p, points) &&
    points.every((a, i) => segmentDistance(p, a, points[(i + 1) % points.length]) >= r)
  );
}
export function intersectsDisk(s: FogOperation, p: Point, r: number): boolean {
  if (s.shape === 'circle') return Math.hypot(p.x - s.x, p.y - s.y) <= s.radius! + r;
  if (s.shape === 'rectangle')
    return (
      Math.hypot(
        p.x - Math.max(s.x, Math.min(s.x + s.width!, p.x)),
        p.y - Math.max(s.y, Math.min(s.y + s.height!, p.y)),
      ) <= r
    );
  return (
    pointInPolygon(p, s.points!) ||
    s.points!.some((a, i) => segmentDistance(p, a, s.points![(i + 1) % s.points!.length]) <= r)
  );
}
/** Conservative whole-footprint projection; overlapping reveals never leak concealed token data. */
export function fogAllowsToken(fog: Scene['fog'], token: Token): boolean {
  if (!fog.enabled) return true;
  const r = token.size / 2,
    ops = fog.operations || [];
  for (let i = ops.length - 1; i >= 0; i--) {
    const op = ops[i];
    if (op.mode === 'conceal' && intersectsDisk(op, token, r)) return false;
    if (op.mode === 'reveal' && containsDisk(op, token, r)) return true;
  }
  return fog.revealed.some((p) => Math.hypot(p.x - token.x, p.y - token.y) + r <= p.radius);
}
