import type { Annotation, Point, Zone } from './model.js';
import { pointInPolygon, segmentDistance } from './regions.js';

function segmentGap(a: Point, b: Point, c: Point, d: Point): number {
  const cross = (p: Point, q: Point, r: Point) =>
    (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  const overlaps =
    Math.max(Math.min(a.x, b.x), Math.min(c.x, d.x)) <=
      Math.min(Math.max(a.x, b.x), Math.max(c.x, d.x)) &&
    Math.max(Math.min(a.y, b.y), Math.min(c.y, d.y)) <=
      Math.min(Math.max(a.y, b.y), Math.max(c.y, d.y));
  if (overlaps && cross(a, b, c) * cross(a, b, d) <= 0 && cross(c, d, a) * cross(c, d, b) <= 0)
    return 0;
  return Math.min(
    segmentDistance(a, c, d),
    segmentDistance(b, c, d),
    segmentDistance(c, a, b),
    segmentDistance(d, a, b),
  );
}

function brushHitsPolygon(points: Point[], from: Point, to: Point, radius: number): boolean {
  return (
    pointInPolygon(from, points) ||
    pointInPolygon(to, points) ||
    points.some(
      (point, i) => segmentGap(from, to, point, points[(i + 1) % points.length]) <= radius,
    )
  );
}

export function zonesAlongBrush(zones: Zone[], from: Point, to: Point, radius: number): string[] {
  return zones
    .filter((zone) => {
      if (zone.shape === 'line')
        return (
          zone.points?.some(
            (point, i, points) => segmentGap(from, to, point, points[Math.max(0, i - 1)]) <= radius,
          ) || false
        );
      if (zone.shape === 'circle') {
        const rx = zone.width / 2,
          ry = zone.height / 2,
          center = { x: zone.x + rx, y: zone.y + ry };
        if (rx === ry) return segmentDistance(center, from, to) <= rx + radius;
        const inside = (p: Point) =>
          ((p.x - center.x) / rx) ** 2 + ((p.y - center.y) / ry) ** 2 <= 1;
        // Rendered circles can also be ellipses; use their outline rather than the bounding box.
        const outline = Array.from({ length: 128 }, (_, i) => {
          const angle = (i * Math.PI * 2) / 128;
          return { x: center.x + Math.cos(angle) * rx, y: center.y + Math.sin(angle) * ry };
        });
        return inside(from) || inside(to) || brushHitsPolygon(outline, from, to, radius);
      }
      const points = zone.points || [
        { x: zone.x, y: zone.y },
        { x: zone.x + zone.width, y: zone.y },
        { x: zone.x + zone.width, y: zone.y + zone.height },
        { x: zone.x, y: zone.y + zone.height },
      ];
      return brushHitsPolygon(points, from, to, radius);
    })
    .map((zone) => zone.id);
}

/** Swept brush hit testing catches drawings between pointer events, at any zoom. */
export function drawingsAlongBrush(
  annotations: Annotation[],
  from: Point,
  to: Point,
  radius: number,
  textWidth: (text: string, fontSize: number) => number,
): string[] {
  return annotations
    .filter((annotation) => {
      const points = annotation.points;
      if (!points.length) return false;
      if (annotation.kind === 'stroke')
        return points.some(
          (point, index) =>
            segmentGap(from, to, point, points[Math.max(0, index - 1)]) <=
            radius + annotation.width / 2,
        );
      const fontSize = Math.max(14, annotation.width * 5),
        lineHeight = Math.max(18, annotation.width * 6);
      return annotation.text.split('\n').some((line, index) => {
        if (!line) return false;
        const x = points[0].x,
          y = points[0].y + index * lineHeight;
        const left = x,
          right = x + textWidth(line, fontSize),
          top = y - fontSize,
          bottom = y + fontSize * 0.25;
        const corners = [
          { x: left, y: top },
          { x: right, y: top },
          { x: right, y: bottom },
          { x: left, y: bottom },
        ];
        const inside = (p: Point) => p.x >= left && p.x <= right && p.y >= top && p.y <= bottom;
        return (
          inside(from) ||
          inside(to) ||
          corners.some((corner, i) => segmentGap(from, to, corner, corners[(i + 1) % 4]) <= radius)
        );
      });
    })
    .map((annotation) => annotation.id);
}
