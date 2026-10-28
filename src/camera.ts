import type { Camera } from '../shared/geometry.js';
import type { Token } from '../shared/model.js';

/** Frame only the tokens in the client's projected scene, with room for rings and labels. */
export function frameTokens(
  tokens: Pick<Token, 'x' | 'y' | 'size'>[],
  width: number,
  height: number,
): Camera | null {
  if (!tokens.length || width <= 0 || height <= 0) return null;
  const left = Math.min(...tokens.map((t) => t.x - t.size / 2 - 24));
  const right = Math.max(...tokens.map((t) => t.x + t.size / 2 + 24));
  const top = Math.min(...tokens.map((t) => t.y - t.size / 2 - 24));
  const bottom = Math.max(...tokens.map((t) => t.y + t.size / 2 + 40));
  const zoom = Math.max(
    0.08,
    Math.min(
      1.5,
      Math.max(1, width - 48) / (right - left),
      Math.max(1, height - 120) / (bottom - top),
    ),
  );
  return {
    zoom,
    x: width / 2 - ((left + right) / 2) * zoom,
    y: height / 2 - ((top + bottom) / 2) * zoom,
  };
}
