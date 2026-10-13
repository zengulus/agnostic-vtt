import { describe, expect, it } from 'vitest';
import {
  evaluateMacro,
  formatMacroGroup,
  importMacros,
  macroText,
  parseMacro,
} from '../shared/macros.js';
import { physicalDice, predeterminedNotation } from '../shared/dice.js';

const example = String.raw`[Attack Name]\([Attack Roll(1d20 + X)],[Damage Roll(1d6 + [Fire(1d6)] + [Akashic(12)])`;
describe('data-only named roll macros', () => {
  it('imports the supplied format, repairs trailing delimiters, and keeps unrelated totals separate', () => {
    const definition = parseMacro(example),
      faces = [14, 3, 4];
    expect(definition.repaired).toBe(true);
    expect(parseMacro(definition.source).repaired).toBe(false);
    const result = evaluateMacro(definition, { X: 5 }, (min, max) => {
      const value = faces.shift()!;
      expect(value).toBeGreaterThanOrEqual(min);
      expect(value).toBeLessThan(max);
      return value;
    });
    expect(macroText(result)).toBe(
      'Attack Name\nAttack Roll: 19\nDamage Roll: 3 + 4 Fire damage + 12 Akashic damage = 19',
    );
    expect(result.groups.map((g) => g.total)).toEqual([19, 19]);
    const terms = result.groups.flatMap((g) => g.terms);
    expect(physicalDice(terms).map((d) => d.value)).toEqual([14, 3, 4]);
    expect(predeterminedNotation(terms)).toContain('@14');
  });
  it('supports newline conventions, Unicode names, BOM, comments and blank lines with useful line errors', () => {
    const text = `\uFEFF# Party macros\r\n${example}\r\n\r\n[Restoration]([Healing Roll(2d6 + [Divine(4)])])\r[Exploration]([Awareness(1d20)])\ninvalid`;
    const result = importMacros(text);
    expect(result.macros.map((m) => [m.name, m.line])).toEqual([
      ['Attack Name', 2],
      ['Restoration', 4],
      ['Exploration', 5],
    ]);
    expect(result.errors[0].line).toBe(6);
    expect(parseMacro('[Élan ✦]([Resolve(5)])').name).toBe('Élan ✦');
    expect(importMacros('# no definitions').errors).toHaveLength(1);
  });
  it('uses arbitrary headings and labels for healing, resources and nested contributions', () => {
    const result = evaluateMacro(
      parseMacro(
        '[Rest]([Healing Roll(2d6 + [Divine(4)] + X)],[Supplies(12 - [Consumed(1d4)])],[Focus([Mental(2 + [Bonus(3)])])])',
      ),
      { X: -2 },
      () => 3,
    );
    expect(result.groups.map(formatMacroGroup)).toEqual([
      '6 + 4 Divine healing − 2 = 8',
      '12 − 3 Consumed = 9',
      '5 Mental = 5',
    ]);
    expect(result.groups[0].terms.at(-1)).toMatchObject({ sign: -1, subtotal: -2, values: [2] });
    expect(result.groups[2].terms).toHaveLength(2);
  });
  it('supports subtraction, zero, decimals in inputs and percentiles without requiring any dice', () => {
    const result = evaluateMacro(
      parseMacro('[Costs]([Resource Roll(0 - [Mana(X)] - 2)],[Odds(d% - 1d100)])'),
      { X: -1.5 },
      () => 42,
    );
    expect(result.groups.map(formatMacroGroup)).toEqual(['0 + 1.5 Mana resource − 2 = -0.5', '0']);
    expect(
      evaluateMacro(parseMacro('[Rest]([Stamina(12)])'), {}, () => {
        throw new Error('No dice');
      }).groups[0].total,
    ).toBe(12);
  });
  it.each([
    '[Bad]([Roll(1d7)])',
    '[Bad]([Roll(0d6)])',
    '[Bad]([Roll(21d6)])',
    '[Bad]([A(20d6)],[B(d4)])',
    '[Bad]([Roll(10001)])',
    '[Bad]([Roll(1d6 * 2)])',
    '[Bad]([Roll(Math.random())])',
    '[Bad]([Roll(1d6 + [Fire(1d6))])',
    '[Bad]([Roll()])',
    '[Bad]([Roll(1d6)]),evil',
    '[Bad]([Roll(1d6 +)])',
    '[Bad]([Roll(1d6)],[Other(2',
    `[Bad]([Roll(${Array.from({ length: 41 }, () => '1').join(' + ')})])`,
    `[Bad](${Array.from({ length: 9 }, () => '[Roll(1)]').join(',')})`,
    `[Bad]([Roll(${Array.from({ length: 13 }, (_, i) => `X${i}`).join('+')})])`,
  ])('rejects malformed or unbounded expressions: %s', (source) =>
    expect(() => parseMacro(source)).toThrow(),
  );
  it('rejects oversized imports and missing, extra or unsafe numeric inputs', () => {
    const definition = parseMacro('[Test]([Check(1d20 + X)])');
    const invalid: Record<string, number>[] = [
      {},
      { X: NaN },
      { X: Infinity },
      { X: 10001 },
      { X: 5, unknown: 2 },
    ];
    for (const variables of invalid)
      expect(() => evaluateMacro(definition, variables, () => 1)).toThrow();
    expect(() => parseMacro(`[${'a'.repeat(65)}]([Check(1)])`)).toThrow();
    expect(() => importMacros('é'.repeat(40000))).toThrow('64 KiB');
    expect(
      importMacros(Array.from({ length: 101 }, () => '[Check]([Roll(1)])').join('\n')).errors[0]
        .message,
    ).toContain('100');
    expect(() => parseMacro(`[A]([Roll(${' '.repeat(4096 - '[A]([Roll(1)'.length)}1)`)).toThrow();
    const named = parseMacro('[Input]([Check(constructor)])');
    expect(() => evaluateMacro(named, {}, () => 1)).toThrow('for constructor');
    expect(evaluateMacro(named, { constructor: 4 }, () => 1).groups[0].total).toBe(4);
  });
});
