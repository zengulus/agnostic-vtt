import type { RollTerm } from './model.js';
export type DiceModifier =
  | { kind: 'kh' | 'kl' | 'dh' | 'dl'; count: number }
  | { kind: 'reroll'; comparison: '<' | '<=' | '>' | '>=' | '='; value: number };
export interface DiceSpec {
  count: number;
  sides: number;
  modifiers?: DiceModifier[];
}
export interface ParsedTerm {
  kind: 'dice' | 'modifier';
  sign: 1 | -1;
  count: number;
  sides?: number;
  value?: number;
  label: string;
  modifiers?: DiceModifier[];
}
const supported = new Set([4, 6, 8, 10, 12, 20, 100]);
function matchesReroll(value: number, comparison: string, threshold: number): boolean {
  switch (comparison) {
    case '<':
      return value < threshold;
    case '<=':
      return value <= threshold;
    case '>':
      return value > threshold;
    case '>=':
      return value >= threshold;
    default:
      return value === threshold;
  }
}
/** Reads one dice literal; macros and ordinary rolls share modifiers and validation. */
export function readDiceTerm(
  input: string,
): { spec: DiceSpec; label: string; length: number } | undefined {
  const match = /^(\d*)d(\d+|%)((?:(?:kh|kl|dh|dl)\d+|r(?:<=|>=|<|>|=)\d+)*)(?![\w<>=%])/i.exec(
    input,
  );
  if (!match) return undefined;
  const count = Number(match[1] || 1),
    sides = match[2] === '%' ? 100 : Number(match[2]);
  if (!Number.isSafeInteger(count) || count < 1 || count > 20 || !supported.has(sides))
    throw new Error('Use up to 20 dice: d4, d6, d8, d10, d12, d20 or d100.');
  const modifiers: DiceModifier[] = [];
  for (const suffix of match[3].toLowerCase().matchAll(/(kh|kl|dh|dl)(\d+)|r(<=|>=|<|>|=)(\d+)/g)) {
    if (suffix[1]) {
      const amount = Number(suffix[2]);
      if (modifiers.some((m) => m.kind !== 'reroll'))
        throw new Error('Use one keep or drop modifier per dice term.');
      if (!Number.isSafeInteger(amount) || amount < 1 || amount > count)
        throw new Error('Keep/drop counts must be between 1 and the number of dice.');
      modifiers.push({ kind: suffix[1] as 'kh' | 'kl' | 'dh' | 'dl', count: amount });
    } else {
      const comparison = suffix[3] as '<' | '<=' | '>' | '>=' | '=',
        value = Number(suffix[4]);
      if (modifiers.some((m) => m.kind === 'reroll'))
        throw new Error('Use one reroll condition per dice term.');
      if (!Number.isSafeInteger(value) || value < 1 || value > sides)
        throw new Error('Reroll thresholds must be between 1 and the number of sides.');
      if (matchesReroll(1, comparison, value) && matchesReroll(sides, comparison, value))
        throw new Error('A reroll condition must leave at least one possible final face.');
      modifiers.push({ kind: 'reroll', comparison, value });
    }
  }
  return {
    spec: { count, sides, ...(modifiers.length ? { modifiers } : {}) },
    label: `${count}d${sides}${match[3].toLowerCase()}`,
    length: match[0].length,
  };
}
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
    const die = readDiceTerm(body);
    if (die) {
      if (die.length !== body.length) throw new Error('Use dice and numbers joined by + or −.');
      const { count, sides, modifiers } = die.spec;
      diceCount += count;
      if (!Number.isSafeInteger(count) || count < 1 || diceCount > 20 || !supported.has(sides))
        throw new Error('Use up to 20 dice: d4, d6, d8, d10, d12, d20 or d100.');
      return {
        kind: 'dice',
        sign,
        count,
        sides,
        ...(modifiers ? { modifiers } : {}),
        label: die.label,
      };
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
    if (t.kind === 'dice')
      return evaluateDiceTerm(
        { count: t.count, sides: t.sides!, modifiers: t.modifiers },
        t.sign,
        t.label,
        randomInt,
      );
    const values = [t.value!];
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
export function evaluateDiceTerm(
  spec: DiceSpec,
  sign: 1 | -1,
  label: string,
  randomInt: (min: number, max: number) => number,
): RollTerm {
  const values = Array.from({ length: spec.count }, () => randomInt(1, spec.sides + 1));
  const reroll = spec.modifiers?.find((m) => m.kind === 'reroll');
  const rerolls = reroll ? values.map((): number[] => []) : undefined;
  if (reroll?.kind === 'reroll') {
    for (let i = 0; i < values.length; i++) {
      while (matchesReroll(values[i], reroll.comparison, reroll.value)) {
        if (rerolls![i].length >= 1000)
          throw new Error(
            'Reroll limit reached (1000 attempts per die). Try a narrower condition.',
          );
        rerolls![i].push(values[i]);
        values[i] = randomInt(1, spec.sides + 1);
      }
    }
  }
  const selection = spec.modifiers?.find((m) => m.kind !== 'reroll');
  let kept: boolean[] | undefined;
  if (selection) {
    const highest = selection.kind.endsWith('h'),
      keep = selection.kind.startsWith('k');
    const ranked = values
      .map((value, index) => ({ value, index }))
      .sort((a, b) => (highest ? b.value - a.value : a.value - b.value) || a.index - b.index);
    const chosen = new Set(ranked.slice(0, selection.count).map((die) => die.index));
    kept = values.map((_, index) => keep === chosen.has(index));
  }
  return {
    kind: 'dice',
    sign,
    sides: spec.sides,
    values,
    label,
    ...(kept ? { kept } : {}),
    ...(rerolls ? { rerolls } : {}),
    subtotal:
      values.reduce((sum, value, index) => sum + (kept?.[index] === false ? 0 : value), 0) * sign,
  };
}
/** Explains final faces and excluded rolls consistently in history, macros and Discord. */
export function formatRollValues(term: RollTerm): string {
  return term.values
    .map((value, index) => {
      const face = term.kept?.[index] === false ? `${value} (dropped)` : String(value);
      const previous = term.rerolls?.[index];
      return previous?.length ? `${previous.join(' → ')} → ${face} (rerolled)` : face;
    })
    .join(' + ');
}
export function formatRollBreakdown(terms: RollTerm[]): string {
  return terms
    .map(
      (term, index) =>
        `${index ? (term.sign < 0 ? ' − ' : ' + ') : term.sign < 0 ? '−' : ''}${term.values.length > 1 ? `(${formatRollValues(term)})` : formatRollValues(term)}${term.kind === 'dice' ? ` (${term.label})` : ''}`,
    )
    .join('');
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
