import type { Grid, Point } from './model.js';
export interface Camera {
  x: number;
  y: number;
  zoom: number;
}
export function screenToWorld(p: Point, c: Camera): Point {
  return { x: (p.x - c.x) / c.zoom, y: (p.y - c.y) / c.zoom };
}
export function worldToScreen(p: Point, c: Camera): Point {
  return { x: p.x * c.zoom + c.x, y: p.y * c.zoom + c.y };
}
export function snapPoint(p: Point, g: Grid): Point {
  if (!g.enabled || !g.snap) return p;
  if (g.type === 'hex') {
    const a = worldToHex(p, g),
      rounded = roundHex(a.q, a.r);
    return hexToWorld(rounded.q, rounded.r, g);
  }
  return {
    x: Math.round((p.x - g.offsetX - g.size / 2) / g.size) * g.size + g.offsetX + g.size / 2,
    y: Math.round((p.y - g.offsetY - g.size / 2) / g.size) * g.size + g.offsetY + g.size / 2,
  };
}
export function clampPoint(p: Point, width: number, height: number, size: number): Point {
  return {
    x: Math.min(width - size / 2, Math.max(size / 2, p.x)),
    y: Math.min(height - size / 2, Math.max(size / 2, p.y)),
  };
}
export function distance(a: Point, b: Point, g: Grid): number {
  if (g.measurement === 'grid' && g.enabled) {
    if (g.type === 'hex') {
      const x = worldToHex(a, g),
        y = worldToHex(b, g),
        ra = roundHex(x.q, x.r),
        rb = roundHex(y.q, y.r);
      return (
        ((Math.abs(ra.q - rb.q) + Math.abs(ra.r - rb.r) + Math.abs(ra.q + ra.r - rb.q - rb.r)) /
          2) *
        g.distance
      );
    }
    return (Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y)) / g.size) * g.distance;
  }
  return (Math.hypot(b.x - a.x, b.y - a.y) / g.size) * g.distance;
}
export function worldToHex(p: Point, g: Grid) {
  const radius = g.size / Math.sqrt(3),
    x = p.x - g.offsetX,
    y = p.y - g.offsetY;
  return { q: ((Math.sqrt(3) / 3) * x - y / 3) / radius, r: ((2 / 3) * y) / radius };
}
export function hexToWorld(q: number, r: number, g: Grid): Point {
  const radius = g.size / Math.sqrt(3);
  return { x: radius * Math.sqrt(3) * (q + r / 2) + g.offsetX, y: radius * 1.5 * r + g.offsetY };
}
export function roundHex(q: number, r: number) {
  let x = Math.round(q),
    y = Math.round(r),
    z = Math.round(-q - r);
  const dx = Math.abs(x - q),
    dy = Math.abs(y - r),
    dz = Math.abs(z + q + r);
  if (dx > dy && dx > dz) x = -y - z;
  else if (dy > dz) y = -x - z;
  else z = -x - y;
  return { q: x, r: y };
}

/** Arrow movement follows cell centres when snapping, otherwise uses ten map pixels. */
export function nudgePoint(point: Point, key: string, grid: Grid): Point {
  const dx = key === 'ArrowLeft' ? -1 : key === 'ArrowRight' ? 1 : 0;
  const dy = key === 'ArrowUp' ? -1 : key === 'ArrowDown' ? 1 : 0;
  if (grid.enabled && grid.snap) {
    if (grid.type === 'hex') {
      const hex = worldToHex(point, grid),
        rounded = roundHex(hex.q, hex.r);
      return hexToWorld(rounded.q + dx, rounded.r + dy, grid);
    }
    const snapped = snapPoint(point, grid);
    return { x: snapped.x + dx * grid.size, y: snapped.y + dy * grid.size };
  }
  return { x: point.x + dx * 10, y: point.y + dy * 10 };
}
