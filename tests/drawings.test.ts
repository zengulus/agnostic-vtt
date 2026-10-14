import { describe, expect, it } from 'vitest';
import type { Annotation, Zone } from '../shared/model.js';
import { drawingsAlongBrush, zonesAlongBrush } from '../shared/drawings.js';

const stroke: Annotation = {
  id: 'stroke',
  kind: 'stroke',
  points: [
    { x: 0, y: 50 },
    { x: 100, y: 50 },
  ],
  text: '',
  color: '#ffffff',
  width: 4,
  visibility: 'public',
};
const width = (text: string, size: number) => (text.length * size) / 2;
describe('eraser geometry', () => {
  it('hits the middle of a segment, accounts for width and misses outside the brush', () => {
    expect(drawingsAlongBrush([stroke], { x: 50, y: 55 }, { x: 50, y: 55 }, 3, width)).toEqual([
      'stroke',
    ]);
    expect(drawingsAlongBrush([stroke], { x: 50, y: 56 }, { x: 50, y: 56 }, 3, width)).toEqual([]);
  });
  it('catches crossed and collinear strokes between events, including single-point strokes', () => {
    expect(drawingsAlongBrush([stroke], { x: 50, y: 0 }, { x: 50, y: 100 }, 1, width)).toEqual([
      'stroke',
    ]);
    expect(drawingsAlongBrush([stroke], { x: -10, y: 50 }, { x: 110, y: 50 }, 1, width)).toEqual([
      'stroke',
    ]);
    expect(
      drawingsAlongBrush(
        [{ ...stroke, points: [{ x: 50, y: 50 }] }],
        { x: 0, y: 50 },
        { x: 100, y: 50 },
        1,
        width,
      ),
    ).toEqual(['stroke']);
  });
  it('hits multiline text away from its anchor, using font size and measured width', () => {
    const text: Annotation = {
      ...stroke,
      kind: 'text',
      points: [{ x: 100, y: 100 }],
      text: 'Long text\nSecond line',
      visibility: 'gm',
    };
    expect(drawingsAlongBrush([text], { x: 180, y: 107 }, { x: 180, y: 107 }, 1, width)).toEqual([
      'stroke',
    ]);
    expect(drawingsAlongBrush([text], { x: 250, y: 107 }, { x: 250, y: 107 }, 1, width)).toEqual(
      [],
    );
    expect(drawingsAlongBrush([text], { x: 50, y: 107 }, { x: 230, y: 107 }, 1, width)).toEqual([
      'stroke',
    ]);
  });
});

describe('zone eraser geometry', () => {
  const zone: Zone = {
    id: 'zone',
    shape: 'rectangle',
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    label: 'Zone',
    color: '#ffffff',
  };
  it('hits filled rectangles and brushes their edges, but misses outside the radius', () => {
    expect(zonesAlongBrush([zone], { x: 50, y: 50 }, { x: 50, y: 50 }, 1)).toEqual(['zone']);
    expect(zonesAlongBrush([zone], { x: 104, y: 50 }, { x: 104, y: 50 }, 5)).toEqual(['zone']);
    expect(zonesAlongBrush([zone], { x: 106, y: 50 }, { x: 106, y: 50 }, 5)).toEqual([]);
    expect(zonesAlongBrush([zone], { x: -20, y: 50 }, { x: 120, y: 50 }, 1)).toEqual(['zone']);
  });
  it('tests circles and ellipses against their shape instead of their bounding rectangle', () => {
    const circle = { ...zone, shape: 'circle' as const };
    expect(zonesAlongBrush([circle], { x: -20, y: 50 }, { x: 120, y: 50 }, 1)).toEqual(['zone']);
    expect(zonesAlongBrush([circle], { x: 5, y: 5 }, { x: 5, y: 5 }, 1)).toEqual([]);
    const ellipse = { ...circle, width: 200, height: 40 };
    expect(zonesAlongBrush([ellipse], { x: 190, y: 20 }, { x: 190, y: 20 }, 1)).toEqual(['zone']);
    expect(zonesAlongBrush([ellipse], { x: 190, y: 39 }, { x: 190, y: 39 }, 1)).toEqual([]);
  });
  it.each(['polygon', 'cone'] as const)(
    'hits filled %s shapes and sweeps across their boundary',
    (shape) => {
      const polygon = {
        ...zone,
        shape,
        points: [
          { x: 0, y: 0 },
          { x: 100, y: 0 },
          { x: 0, y: 100 },
        ],
      };
      expect(zonesAlongBrush([polygon], { x: 20, y: 20 }, { x: 20, y: 20 }, 1)).toEqual(['zone']);
      expect(zonesAlongBrush([polygon], { x: 80, y: 80 }, { x: 80, y: 80 }, 1)).toEqual([]);
      expect(zonesAlongBrush([polygon], { x: -20, y: 50 }, { x: 120, y: 50 }, 1)).toEqual(['zone']);
    },
  );
  it('hits lines without filling or closing them', () => {
    const line = {
      ...zone,
      shape: 'line' as const,
      points: [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 100 },
      ],
    };
    expect(zonesAlongBrush([line], { x: 50, y: -20 }, { x: 50, y: 20 }, 1)).toEqual(['zone']);
    expect(zonesAlongBrush([line], { x: 50, y: 50 }, { x: 50, y: 50 }, 1)).toEqual([]);
  });
});
