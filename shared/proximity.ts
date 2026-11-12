import { type Point, type ProximityRule, type RoomState, type Zone } from './model.js';
import { fogAllowsToken, pointInPolygon, segmentDistance } from './regions.js';

type Cue = { gm: string; player?: string; tokenId: string; sourceTokenId?: string };
function insideZone(p: Point, z: Zone, distance: number) {
  if (z.shape === 'circle') {
    const rx = z.width / 2 + distance,
      ry = z.height / 2 + distance;
    return ((p.x - z.x - z.width / 2) / rx) ** 2 + ((p.y - z.y - z.height / 2) / ry) ** 2 <= 1;
  }
  if (z.points?.length) {
    if (z.shape !== 'line' && pointInPolygon(p, z.points)) return true;
    const segments = z.shape === 'line' ? z.points.length - 1 : z.points.length;
    return Array.from({ length: segments }, (_, i) =>
      segmentDistance(p, z.points![i], z.points![(i + 1) % z.points!.length]),
    ).some((d) => d <= distance);
  }
  return (
    p.x >= z.x - distance &&
    p.x <= z.x + z.width + distance &&
    p.y >= z.y - distance &&
    p.y <= z.y + z.height + distance
  );
}
function segmentsIntersect(a: Point, b: Point, c: Point, d: Point): boolean {
  const cross = (p: Point, q: Point, r: Point) =>
    (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  const x = cross(a, b, c),
    y = cross(a, b, d),
    z = cross(c, d, a),
    w = cross(c, d, b);
  if (x * y > 0 || z * w > 0) return false;
  return (
    Math.max(Math.min(a.x, b.x), Math.min(c.x, d.x)) <=
      Math.min(Math.max(a.x, b.x), Math.max(c.x, d.x)) &&
    Math.max(Math.min(a.y, b.y), Math.min(c.y, d.y)) <=
      Math.min(Math.max(a.y, b.y), Math.max(c.y, d.y))
  );
}
function segmentGap(a: Point, b: Point, c: Point, d: Point): number {
  if (segmentsIntersect(a, b, c, d)) return 0;
  return Math.min(
    segmentDistance(a, c, d),
    segmentDistance(b, c, d),
    segmentDistance(c, a, b),
    segmentDistance(d, a, b),
  );
}
function crossesZone(a: Point, b: Point, z: Zone, distance: number): boolean {
  if (z.shape === 'circle') {
    const rx = z.width / 2 + distance,
      ry = z.height / 2 + distance;
    if (rx <= 0 || ry <= 0) return false;
    const transform = (p: Point) => ({
      x: (p.x - z.x - z.width / 2) / rx,
      y: (p.y - z.y - z.height / 2) / ry,
    });
    return segmentDistance({ x: 0, y: 0 }, transform(a), transform(b)) <= 1;
  }
  if (z.points?.length) {
    const count = z.shape === 'line' ? z.points.length - 1 : z.points.length;
    return Array.from({ length: count }, (_, i) =>
      segmentGap(a, b, z.points![i], z.points![(i + 1) % z.points!.length]),
    ).some((gap) => gap <= distance);
  }
  const left = z.x - distance,
    right = z.x + z.width + distance,
    top = z.y - distance,
    bottom = z.y + z.height + distance;
  const corners = [
    { x: left, y: top },
    { x: right, y: top },
    { x: right, y: bottom },
    { x: left, y: bottom },
  ];
  return corners.some((p, i) => segmentsIntersect(a, b, p, corners[(i + 1) % 4]));
}
const relative = (p: Point, target: Point): Point => ({ x: p.x - target.x, y: p.y - target.y });
/** Detect boundary crossings on committed moves only. No game effects are applied. */
export function proximityCues(
  before: RoomState,
  after: RoomState,
  sceneId: string,
  tokenIds: string[],
): Cue[] {
  const old = before.scenes[sceneId],
    scene = after.scenes[sceneId];
  if (!old || !scene || sceneId !== after.activeSceneId) return [];
  const cues: Cue[] = [];
  for (const id of new Set(tokenIds)) {
    const a = old.tokens[id],
      b = scene.tokens[id];
    if (!a || !b || (a.x === b.x && a.y === b.y)) continue;
    const check = (
      rule: ProximityRule | undefined,
      label: string,
      isPublic: boolean,
      was: boolean,
      now: boolean,
      crossed: boolean,
      sourceTokenId?: string,
    ) => {
      if (!rule || (was === now && (was || !crossed))) return;
      const events = was !== now ? [now ? 'enter' : 'leave'] : ['enter', 'leave'];
      for (const event of events) {
        if (cues.length >= 50 || (rule.when !== 'both' && rule.when !== event)) continue;
        cues.push({
          gm: `${b.name} ${event === 'enter' ? 'entered' : 'left'} ${label}.`,
          player:
            isPublic && b.visibility === 'public' && fogAllowsToken(scene.fog, b)
              ? rule.playerMessage
              : undefined,
          tokenId: b.id,
          sourceTokenId,
        });
      }
    };
    for (const pin of Object.values(scene.pins || {}))
      if (pin.proximity) {
        const range = pin.proximity.distance;
        check(
          pin.proximity,
          pin.label,
          pin.visibility === 'public',
          Math.hypot(a.x - pin.x, a.y - pin.y) <= range,
          Math.hypot(b.x - pin.x, b.y - pin.y) <= range,
          segmentDistance(pin, a, b) <= range,
        );
      }
    for (const zone of Object.values(scene.zones))
      if (zone.proximity && zone.anchorTokenId !== id) {
        const previous = old.zones[zone.id] || zone;
        check(
          zone.proximity,
          zone.label || 'a region',
          zone.visibility !== 'gm',
          insideZone(a, previous, zone.proximity.distance),
          insideZone(b, zone, zone.proximity.distance),
          crossesZone(
            a,
            { x: b.x - (zone.x - previous.x), y: b.y - (zone.y - previous.y) },
            previous,
            zone.proximity.distance,
          ),
        );
      }
    for (const target of Object.values(scene.tokens))
      if (target.id !== id && target.proximity) {
        const previous = old.tokens[target.id] || target,
          range = target.proximity.distance;
        check(
          target.proximity,
          target.name,
          target.visibility === 'public',
          Math.hypot(a.x - previous.x, a.y - previous.y) <= range,
          Math.hypot(b.x - target.x, b.y - target.y) <= range,
          segmentDistance({ x: 0, y: 0 }, relative(a, previous), relative(b, target)) <= range,
          target.id,
        );
      }
  }
  const moved = new Set(tokenIds);
  for (const id of moved) {
    const target = scene.tokens[id],
      previous = old.tokens[id];
    if (!target || !previous || (target.x === previous.x && target.y === previous.y)) continue;
    for (const actor of Object.values(scene.tokens)) {
      if (moved.has(actor.id) || !old.tokens[actor.id]) continue;
      const check = (
        rule: ProximityRule | undefined,
        label: string,
        isPublic: boolean,
        was: boolean,
        now: boolean,
        crossed: boolean,
        sourceTokenId?: string,
      ) => {
        if (!rule || (was === now && (was || !crossed))) return;
        const events = was !== now ? [now ? 'enter' : 'leave'] : ['enter', 'leave'];
        for (const event of events) {
          if (cues.length >= 50 || (rule.when !== 'both' && rule.when !== event)) continue;
          cues.push({
            gm: `${actor.name} ${event === 'enter' ? 'entered' : 'left'} ${label}.`,
            player:
              isPublic && actor.visibility === 'public' && fogAllowsToken(scene.fog, actor)
                ? rule.playerMessage
                : undefined,
            tokenId: actor.id,
            sourceTokenId,
          });
        }
      };
      if (target.proximity) {
        const range = target.proximity.distance;
        check(
          target.proximity,
          target.name,
          target.visibility === 'public',
          Math.hypot(actor.x - previous.x, actor.y - previous.y) <= range,
          Math.hypot(actor.x - target.x, actor.y - target.y) <= range,
          segmentDistance(actor, previous, target) <= range,
          target.id,
        );
      }
      for (const zone of Object.values(scene.zones)) {
        if (zone.anchorTokenId !== id || !zone.proximity || !old.zones[zone.id]) continue;
        check(
          zone.proximity,
          zone.label || 'a region',
          zone.visibility !== 'gm',
          insideZone(actor, old.zones[zone.id], zone.proximity.distance),
          insideZone(actor, zone, zone.proximity.distance),
          crossesZone(
            actor,
            {
              x: actor.x - (zone.x - old.zones[zone.id].x),
              y: actor.y - (zone.y - old.zones[zone.id].y),
            },
            old.zones[zone.id],
            zone.proximity.distance,
          ),
        );
      }
    }
  }
  return cues;
}
