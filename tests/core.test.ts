import { describe, expect, it } from 'vitest';
import { randomInt } from 'node:crypto';
import { parseDice, evaluateDice, predeterminedNotation, physicalDice } from '../shared/dice.js';
import {
  screenToWorld,
  worldToScreen,
  snapPoint,
  clampPoint,
  distance,
} from '../shared/geometry.js';
import { validateAsset } from '../shared/assets.js';
import { projectRoom, tokenVisible } from '../shared/model.js';
import { newRoom } from '../shared/sample.js';
import { clientMessageSchema } from '../shared/protocol.js';
describe('bounded generic dice mathematics', () => {
  it('presents each die and positive/negative contribution separately', () => {
    const result = evaluateDice('1d20 + 5 - 2', () => 14);
    expect(result.total).toBe(17);
    expect(result.terms.map((t) => t.subtotal)).toEqual([14, 5, -2]);
    expect(predeterminedNotation(result.terms)).toBe('1d20@14');
  });
  it('supports mixed dice, negative dice and omitted counts', () => {
    const result = evaluateDice('2d6-d4+3', () => 2);
    expect(result.total).toBe(5);
    expect(result.terms[0].values).toEqual([2, 2]);
    expect(predeterminedNotation(result.terms)).toBe('1d6+1d6+1d4@2,2,2');
  });
  it('maps percentiles to tens and units, including 100', () => {
    const result = evaluateDice(
      'd%+d100',
      (() => {
        const values = [67, 100];
        return () => values.shift()!;
      })(),
    );
    expect(physicalDice(result.terms)).toEqual([
      { sides: 100, value: 60 },
      { sides: 10, value: 7 },
      { sides: 100, value: 100 },
      { sides: 10, value: 10 },
    ]);
  });
  it.each([
    '1d20++2',
    '0d6',
    '21d6',
    '1d7',
    'Infinity',
    'alert(1)',
    '1d6*100',
    '2',
    'd20+10001',
    'd20-',
    '1d6/0',
  ])('rejects invalid/unsupported expression %s', (e) => expect(() => parseDice(e)).toThrow());
  it.each([4, 6, 8, 10, 12, 20, 100])('secure outcomes always lie within d%s bounds', (sides) => {
    for (let i = 0; i < 30; i++) {
      const r = evaluateDice(`20d${sides}`, randomInt);
      expect(r.terms[0].values.every((n) => n >= 1 && n <= sides && Number.isInteger(n))).toBe(
        true,
      );
    }
  });
});
describe('coordinates and assets', () => {
  const grid = newRoom('testing', 'gm', 'GM', 'Test', 'invite').state.scenes.hollow.grid;
  it('roundtrips scene and screen coordinates at fractional zoom', () => {
    const p = { x: 472, y: -39 },
      c = { x: 131, y: -250, zoom: 0.37 };
    const result = screenToWorld(worldToScreen(p, c), c);
    expect(result.x).toBeCloseTo(p.x);
    expect(result.y).toBeCloseTo(p.y);
  });
  it('snaps to aligned cell centres and bounds the token footprint', () => {
    expect(snapPoint({ x: 777, y: 333 }, grid)).toEqual({ x: 760, y: 360 });
    expect(clampPoint({ x: -10, y: 2000 }, 1600, 1200, 80)).toEqual({ x: 40, y: 1160 });
    expect(distance({ x: 0, y: 0 }, { x: 80, y: 0 }, grid)).toBe(5);
  });
  it('allows public HTTPS assets and whitelisted builtins', () => {
    expect(() =>
      validateAsset({ kind: 'external', url: 'https://images.example.com/map.webp' }),
    ).not.toThrow();
    expect(() => validateAsset({ kind: 'builtin', url: 'hollow.svg' })).not.toThrow();
  });
  it.each([
    'http://example.com/map.png',
    'https://127.0.0.1/map.png',
    'https://169.254.169.254/map',
    'https://localhost/map',
    'https://foo.internal/map',
    'file:///etc/passwd',
    'data:image/svg+xml,test',
    'https://user:pass@example.com/x',
    'https://example.com:8000/x',
    'https://[::1]/x',
  ])('rejects unsafe URL %s', (url) =>
    expect(() => validateAsset({ kind: 'external', url })).toThrow(),
  );
  it('rejects prototype keys and nonfinite movement at the protocol boundary', () => {
    expect(
      clientMessageSchema.safeParse({
        v: 2,
        type: 'TOKEN_MOVE_COMMIT',
        actionId: 'a',
        sceneId: 'constructor',
        tokenId: 'ranger',
        position: { x: 1, y: 1 },
      }).success,
    ).toBe(false);
    expect(
      clientMessageSchema.safeParse({
        v: 2,
        type: 'TOKEN_MOVE_COMMIT',
        actionId: 'a',
        sceneId: 'hollow',
        tokenId: 'ranger',
        position: { x: Infinity, y: 1 },
      }).success,
    ).toBe(false);
  });
});
describe('permission projection', () => {
  it('omits GM tokens, notes and private rolls from snapshots', () => {
    const room = newRoom('testing', 'gm', 'GM', 'Test', 'invite');
    room.members.player = { role: 'player', name: 'Player' };
    room.state.scenes.hollow.tokens.ranger.note = 'secret';
    room.state.scenes.hollow.tokens.mage.visibility = 'gm';
    room.state.rolls = [
      {
        id: 'r',
        actionId: 'a',
        userId: 'gm',
        userName: 'GM',
        expression: 'd20',
        terms: [],
        total: 14,
        visibility: 'private',
        createdAt: 'now',
      },
    ];
    const player = projectRoom(room, 'player');
    expect(player.scenes.hollow.tokens.mage).toBeUndefined();
    expect(player.scenes.hollow.tokens.ranger.note).toBeUndefined();
    expect(player.rolls).toHaveLength(0);
    expect(JSON.stringify(player)).not.toContain('invite');
    expect(projectRoom(room, 'gm').scenes.hollow.tokens.ranger.note).toBe('secret');
  });
  it('withholds tokens under fog unless their whole footprint is revealed', () => {
    const room = newRoom('testing', 'gm', 'GM', 'Test', 'invite'),
      s = room.state.scenes.hollow,
      t = s.tokens.ranger;
    s.fog = { enabled: true, revealed: [] };
    expect(tokenVisible(t, s, 'player')).toBe(false);
    expect(tokenVisible(t, s, 'gm')).toBe(true);
    s.fog.revealed = [{ x: t.x, y: t.y, radius: 30 }];
    expect(tokenVisible(t, s, 'player')).toBe(false);
    s.fog.revealed[0].radius = 80;
    expect(tokenVisible(t, s, 'player')).toBe(true);
  });
});
