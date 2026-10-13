import type { RollTerm } from './model.js';
export interface ParsedTerm {
  kind: 'dice' | 'modifier';
  sign: 1 | -1;
  count: number;
  sides?: number;
  value?: number;
  label: string;
}
const supported = new Set([4, 6, 8, 10, 12, 20, 100]);
/** Bounded additive grammar, deliberately no eval(), executable macros or rule assumptions. */
export function parseDice(expression: string): ParsedTerm[] {
  const clean = expression.toLowerCase().replace(/\s/g, '').replace(/d%/g, 'd100');
  if (!clean || clean.length > 120)
    throw new Error('Enter a dice expression, such as 2d6 + 5 - 2.');
  const parts = clean.match(/[+-]?[^+-]+/g);
  if (!parts || parts.join('') !== clean || parts.length > 20)
    throw new Error('Use dice and numbers joined by + or −.');
  let diceCount = 0;
  const terms = parts.map((part): ParsedTerm => {
    const sign = part.startsWith('-') ? -1 : 1;
    const body = part.replace(/^[+-]/, '');
    const die = /^(\d*)d(\d+)$/.exec(body);
    if (die) {
      const count = Number(die[1] || 1),
        sides = Number(die[2]);
      diceCount += count;
      if (!Number.isSafeInteger(count) || count < 1 || diceCount > 20 || !supported.has(sides))
        throw new Error('Use up to 20 dice: d4, d6, d8, d10, d12, d20 or d100.');
      return { kind: 'dice', sign, count, sides, label: `${count}d${sides}` };
    }
    if (!/^\d{1,5}$/.test(body)) throw new Error('Use dice and numbers joined by + or −.');
    const value = Number(body);
    if (value > 10000) throw new Error('Modifiers must be 10,000 or less.');
    return { kind: 'modifier', sign, count: 1, value, label: `${sign > 0 ? '+' : '−'}${value}` };
  });
  if (!diceCount) throw new Error('Include at least one die in your expression.');
  return terms;
}
export function evaluateDice(
  expression: string,
  randomInt: (min: number, max: number) => number,
): { terms: RollTerm[]; total: number } {
  const terms = parseDice(expression).map((t): RollTerm => {
    const values =
      t.kind === 'dice'
        ? Array.from({ length: t.count }, () => randomInt(1, t.sides! + 1))
        : [t.value!];
    return {
      kind: t.kind,
      sign: t.sign,
      sides: t.sides,
      values,
      label: t.label,
      subtotal: values.reduce((a, b) => a + b, 0) * t.sign,
    };
  });
  return { terms, total: terms.reduce((a, t) => a + t.subtotal, 0) };
}
/** Notation understood by Dice Box's deterministic physics renderer. */
export function predeterminedNotation(terms: RollTerm[]): string {
  const dice = physicalDice(terms);
  return `${dice.map((d) => `1d${d.sides}`).join('+')}@${dice.map((d) => d.value).join(',')}`;
}
/** Percentiles use a tens die plus a units die (00 + 0 represents 100). */
export function physicalDice(terms: RollTerm[]): Array<{ sides: number; value: number }> {
  return terms
    .filter((t) => t.kind === 'dice')
    .flatMap((t) =>
      t.values.flatMap((value) =>
        t.sides === 100
          ? [
              { sides: 100, value: Math.floor((value % 100) / 10) * 10 || 100 },
              { sides: 10, value: value % 10 || 10 },
            ]
          : [{ sides: t.sides!, value }],
      ),
    );
}
