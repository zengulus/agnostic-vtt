import { describe, expect, it, vi } from 'vitest';
import {
  evaluateDice,
  formatRollValues,
  parseDice,
  physicalDice,
  predeterminedNotation,
} from '../shared/dice.js';
import { evaluateMacro, parseMacro } from '../shared/macros.js';

function faces(values: number[]) {
  const queue = [...values];
  return vi.fn((min: number, max: number) => {
    const value = queue.shift();
    if (value === undefined) throw new Error('Unexpected random draw');
    expect(value).toBeGreaterThanOrEqual(min);
    expect(value).toBeLessThan(max);
    return value;
  });
}

describe('keep, drop and reroll dice', () => {
  it.each([
    ['2d20kh1', [4, 18], [false, true], 18],
    ['2d20kl1', [4, 18], [true, false], 4],
    ['4d6dl1', [3, 1, 6, 4], [true, false, true, true], 13],
    ['4d6dh1', [3, 1, 6, 4], [true, true, false, true], 8],
    ['4d6kh2', [3, 1, 6, 4], [false, false, true, true], 10],
    ['4d6kl2', [3, 1, 6, 4], [true, true, false, false], 4],
    ['2d6kh1', [4, 4], [true, false], 4],
    ['2d6dl1', [4, 4], [false, true], 4],
    ['2d6kh2', [4, 5], [true, true], 9],
    ['2d6dl2', [4, 5], [false, false], 0],
  ])('evaluates %s with stable tie handling', (source, values, kept, total) => {
    const result = evaluateDice(source as string, faces(values as number[]));
    expect(result.total).toBe(total);
    expect(result.terms[0].values).toEqual(values);
    expect(result.terms[0].kept).toEqual(kept);
    expect(physicalDice(result.terms).map((die) => die.value)).toEqual(values);
  });
  it('repeats rerolls of ones and stores every previous face, keeping final faces for physics', () => {
    const random = faces([1, 2, 1, 4, 6, 1, 3, 5]),
      result = evaluateDice('5d6r<2', random);
    expect(result.terms[0]).toMatchObject({
      values: [3, 2, 5, 4, 6],
      rerolls: [[1, 1], [], [1], [], []],
      subtotal: 20,
    });
    expect(random).toHaveBeenCalledTimes(8);
    expect(formatRollValues(result.terms[0])).toBe(
      '1 → 1 → 3 (rerolled) + 2 + 1 → 5 (rerolled) + 4 + 6',
    );
    expect(predeterminedNotation(result.terms)).toBe('1d6+1d6+1d6+1d6+1d6@3,2,5,4,6');
  });
  it.each([
    ['d6r<2', [1, 2], 2],
    ['d6r<=2', [2, 1, 3], 3],
    ['d6r>4', [5, 6, 4], 4],
    ['d6r>=4', [4, 5, 3], 3],
    ['d6r=3', [3, 3, 4], 4],
    ['d6r<1', [1], 1],
    ['d6r>6', [6], 6],
  ])('applies comparison in %s', (source, values, expected) => {
    expect(evaluateDice(source as string, faces(values as number[])).total).toBe(expected);
  });
  it('rerolls before selecting, in either suffix order, and applies signs after selecting', () => {
    for (const expression of ['-3d6r<2kh2 + d4 + 5', '-3d6kh2r<2 + d4 + 5']) {
      const result = evaluateDice(expression, faces([1, 3, 4, 6, 2]));
      expect(result.total).toBe(-3);
      expect(result.terms[0]).toMatchObject({
        values: [6, 3, 4],
        kept: [true, false, true],
        rerolls: [[1], [], []],
        subtotal: -10,
      });
      expect(formatRollValues(result.terms[0])).toBe('1 → 6 (rerolled) + 3 (dropped) + 4');
    }
  });
  it('supports uppercase, whitespace, omitted dice counts, and percentile modifiers', () => {
    expect(parseDice(' 2 D20 KH1 + D% R<=2 ')[0].label).toBe('2d20kh1');
    const result = evaluateDice('2d%kh1', faces([67, 100]));
    expect(result.total).toBe(100);
    expect(physicalDice(result.terms).map((die) => die.value)).toEqual([60, 7, 100, 10]);
  });
  it('uses the same evaluator for macro inputs, labels, subtraction and modifiers', () => {
    const definition = parseMacro(
      '[Advanced]([Attack Roll(2d20kh1 + X)],[Damage Roll([Fire(4d6dl1)] - d6r<2)])',
    );
    const result = evaluateMacro(definition, { X: 5 }, faces([4, 18, 3, 1, 6, 4, 1, 1, 2]));
    expect(result.groups.map((group) => group.total)).toEqual([23, 11]);
    expect(result.groups[0].terms[0].kept).toEqual([false, true]);
    expect(result.groups[1].contributions[0]).toMatchObject({ label: 'Fire', total: 13 });
    expect(result.groups[1].terms[1]).toMatchObject({ sign: -1, values: [2], rerolls: [[1, 1]] });
    expect(physicalDice(result.groups.flatMap((group) => group.terms))).toHaveLength(7);
    expect(parseMacro('[Variable]([Check(Select + drop)])').variables).toEqual(['Select', 'drop']);
  });
  it.each([
    '2d20kh0',
    '2d20kh3',
    '2d20kh',
    '4d6dl5',
    '4d6dl-1',
    '4d6dl1.5',
    'd6kh1kh1',
    '4d6kh3dl1',
    'd6r',
    'd6r<',
    'd6r<0',
    'd6r<7',
    'd6r!=2',
    'd6r<=6',
    'd6r>=1',
    'd6r<2r=3',
    '2d20kh1junk',
    'd6r<2<3',
    '21d6kh1',
    '20d6dl19+d4',
    'd7kh1',
    'd6!',
    'd6kh1*2',
    'd6r<2++1',
  ])('rejects invalid or unbounded modifiers in ordinary rolls and macros: %s', (source) => {
    expect(() => parseDice(source)).toThrow();
    expect(() => parseMacro(`[Bad]([Roll(${source})])`)).toThrow();
  });
  it('bounds repeated rerolls rather than silently accepting a matching face', () => {
    const random = vi.fn(() => 1);
    expect(() => evaluateDice('d6r<2', random)).toThrow('Reroll limit reached');
    expect(random).toHaveBeenCalledTimes(1001);
  });
});
