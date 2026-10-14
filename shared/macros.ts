import type { RollTerm } from './model.js';
import { evaluateDiceTerm, readDiceTerm, type DiceSpec } from './dice.js';

export interface Macro {
  id: string;
  name: string;
  source: string;
  ownerId: string;
  visibility: 'public' | 'private';
}
type Operand =
  | ({ kind: 'dice'; label: string } & DiceSpec)
  | { kind: 'number'; value: number }
  | { kind: 'variable'; name: string }
  | { kind: 'label'; name: string; expression: Expression };
type Expression = Array<{ sign: 1 | -1; operand: Operand }>;
interface TableSelection {
  count: number;
  entries: string[];
}
type MacroGroup =
  | { name: string; expression: Expression; selection?: never }
  | { name: string; selection: TableSelection; expression?: never };
export interface MacroDefinition {
  name: string;
  groups: MacroGroup[];
  variables: string[];
  source: string;
  repaired: boolean;
}
export interface MacroContribution {
  label?: string;
  terms: RollTerm[];
  total: number;
}
export interface MacroGroupResult {
  name: string;
  terms: RollTerm[];
  contributions: MacroContribution[];
  total: number;
  /** Table picks have no arithmetic total or physical dice; total stays 0 for compatibility. */
  selections?: string[];
}
export interface MacroResult {
  name: string;
  groups: MacroGroupResult[];
  variables: Record<string, number>;
}
class Parser {
  position = 0;
  repaired = '';
  terms = 0;
  dice = 0;
  selections = 0;
  variables = new Set<string>();
  constructor(readonly input: string) {}
  whitespace() {
    while (/\s/.test(this.input[this.position] || '') && this.position < this.input.length)
      this.position++;
  }
  peek() {
    this.whitespace();
    return this.input[this.position];
  }
  expect(character: string, repair = false) {
    if (this.peek() === character) {
      this.position++;
      return;
    }
    if (repair && this.position === this.input.length) {
      this.repaired += character;
      return;
    }
    throw new Error(`Expected “${character}” at column ${this.position + 1}.`);
  }
  name(until: string) {
    this.whitespace();
    const start = this.position;
    while (this.position < this.input.length && this.input[this.position] !== until)
      this.position++;
    const name = this.input.slice(start, this.position).trim();
    if (!name || name.length > 64 || /[\[\]()\r\n\x00-\x1f]/.test(name))
      throw new Error('Names need 1–64 characters, without brackets or parentheses.');
    return name;
  }
  isSelection() {
    this.whitespace();
    return /^Select\s*\(/i.test(this.input.slice(this.position));
  }
  selection(): TableSelection {
    this.whitespace();
    this.position += 'Select'.length;
    this.expect('(');
    this.whitespace();
    const countText = /^\d+/.exec(this.input.slice(this.position));
    if (!countText) throw new Error('Select needs a whole number of entries to pick.');
    const count = Number(countText[0]);
    if (count < 1 || count > 20 || (this.selections += count) > 20)
      throw new Error('Select supports 1–20 picks, with at most 20 picks per macro.');
    this.position += countText[0].length;
    this.expect(')');
    this.expect('{');
    const entries: string[] = [];
    while (true) {
      this.whitespace();
      const start = this.position;
      let entry: string;
      if (this.input[this.position] === '"') {
        this.position++;
        let closed = false;
        while (this.position < this.input.length) {
          const character = this.input[this.position++];
          if (character === '\\') this.position++;
          else if (character === '"') {
            closed = true;
            break;
          }
        }
        if (!closed) throw new Error('A quoted table entry is missing its closing quote.');
        try {
          entry = JSON.parse(this.input.slice(start, this.position));
        } catch {
          throw new Error('Use valid double-quoted text and escapes in table entries.');
        }
      } else {
        while (this.position < this.input.length && ![',', '}'].includes(this.input[this.position]))
          this.position++;
        entry = this.input.slice(start, this.position).trim();
        if (/[{"\\]/.test(entry))
          throw new Error('Quote table entries containing braces, quotes or backslashes.');
      }
      if (!entry.trim() || entry.length > 1000 || /[\x00-\x08\x0b-\x1f\x7f]/.test(entry))
        throw new Error('Table entries need 1–1000 characters of text.');
      entries.push(entry);
      if (entries.length > 100) throw new Error('Use at most 100 entries per table.');
      if (this.peek() === ',') {
        this.position++;
        continue;
      }
      this.expect('}');
      break;
    }
    if (count > entries.length)
      throw new Error('Select cannot pick more entries than the table contains.');
    return { count, entries };
  }
  expression(depth = 0): Expression {
    if (depth > 4) throw new Error('Labels can nest at most four levels.');
    const result: Expression = [];
    while (true) {
      let sign: 1 | -1 = 1;
      const character = this.peek();
      if (character === '+' || character === '-') {
        sign = character === '-' ? -1 : 1;
        this.position++;
      } else if (result.length)
        throw new Error(`Use + or − between contributions (column ${this.position + 1}).`);
      let operand: Operand;
      if (this.peek() === '[') {
        this.position++;
        const name = this.name('(');
        this.expect('(');
        const expression = this.expression(depth + 1);
        this.expect(')');
        this.expect(']');
        operand = { kind: 'label', name, expression };
      } else {
        this.whitespace();
        const rest = this.input.slice(this.position),
          die = readDiceTerm(rest),
          number = /^\d+(?![\w])/.exec(rest),
          variable = /^[A-Za-z][A-Za-z0-9_]{0,23}(?![\w])/.exec(rest);
        if (die) {
          if ((this.dice += die.spec.count) > 20)
            throw new Error('A macro supports up to 20 standard dice in total.');
          operand = { kind: 'dice', ...die.spec, label: die.label };
          this.position += die.length;
        } else if (number) {
          const value = Number(number[0]);
          if (value > 10000) throw new Error('Numbers must be 10,000 or less.');
          operand = { kind: 'number', value };
          this.position += number[0].length;
        } else if (variable && !/^\d*d\d+/i.test(variable[0])) {
          this.variables.add(variable[0]);
          if (this.variables.size > 12) throw new Error('Use at most 12 numeric inputs.');
          operand = { kind: 'variable', name: variable[0] };
          this.position += variable[0].length;
        } else
          throw new Error(
            `Expected a die, number, numeric input or [Label(expression)] at column ${this.position + 1}.`,
          );
        if (++this.terms > 40) throw new Error('Use at most 40 contributions per macro.');
      }
      result.push({ sign, operand });
      if (this.peek() === ')') return result;
      if (this.position === this.input.length)
        throw new Error('A roll expression is missing its closing parenthesis.');
    }
  }
}
/** Data-only grammar. Never evaluates JavaScript or performs string substitution. */
export function parseMacro(source: string): MacroDefinition {
  const input = source.trim();
  if (!input || input.length > 4096 || /[\r\n]/.test(input))
    throw new Error('Put one macro on each line (up to 4096 characters).');
  const p = new Parser(input);
  p.expect('[');
  const name = p.name(']');
  p.expect(']');
  if (p.peek() === '\\') p.position++;
  p.expect('(');
  const groups: MacroDefinition['groups'] = [];
  while (true) {
    if (p.isSelection()) groups.push({ name: 'Selected', selection: p.selection() });
    else {
      p.expect('[');
      const groupName = p.name('(');
      p.expect('(');
      const group: MacroGroup = p.isSelection()
        ? { name: groupName, selection: p.selection() }
        : { name: groupName, expression: p.expression() };
      p.expect(')');
      p.expect(']', true);
      groups.push(group);
    }
    if (groups.length > 8) throw new Error('Use at most eight result groups in a macro.');
    if (p.peek() === ',') {
      p.position++;
      continue;
    }
    p.expect(')', true);
    break;
  }
  if (p.peek() !== undefined) throw new Error(`Unexpected text at column ${p.position + 1}.`);
  if (input.length + p.repaired.length > 4096)
    throw new Error('The completed macro exceeds 4096 characters.');
  return {
    name,
    groups,
    variables: [...p.variables],
    source: input + p.repaired,
    repaired: !!p.repaired,
  };
}
export function importMacros(text: string) {
  if (new TextEncoder().encode(text).length > 64 * 1024)
    throw new Error('Import text files up to 64 KiB.');
  const macros: Array<MacroDefinition & { line: number }> = [],
    errors: Array<{ line: number; message: string }> = [];
  for (const [index, raw] of text
    .replace(/^\uFEFF/, '')
    .split(/\r\n|\n|\r/)
    .entries()) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    if (macros.length >= 100) {
      errors.push({ line: index + 1, message: 'Import at most 100 macros at a time.' });
      break;
    }
    try {
      macros.push({ ...parseMacro(line), line: index + 1 });
    } catch (error) {
      errors.push({ line: index + 1, message: (error as Error).message });
    }
  }
  if (!macros.length && !errors.length)
    errors.push({ line: 1, message: 'The file contains no macro definitions.' });
  return { macros, errors };
}
export function evaluateMacro(
  definition: MacroDefinition,
  variables: Record<string, number>,
  randomInt: (min: number, max: number) => number,
): MacroResult {
  if (Object.keys(variables).some((key) => !definition.variables.includes(key)))
    throw new Error('Unknown numeric input.');
  for (const name of definition.variables)
    if (
      !Object.hasOwn(variables, name) ||
      !Number.isFinite(variables[name]) ||
      Math.abs(variables[name]) > 10000
    )
      throw new Error(`Enter a number between −10,000 and 10,000 for ${name}.`);
  const evaluate = (
    expression: Expression,
    multiplier: 1 | -1 = 1,
    labels: string[] = [],
  ): MacroContribution[] =>
    expression.flatMap(({ sign, operand }): MacroContribution[] => {
      const direction = (sign * multiplier) as 1 | -1;
      if (operand.kind === 'label') {
        const children = evaluate(operand.expression, direction, [...labels, operand.name]),
          terms = children.flatMap((c) => c.terms);
        return [
          {
            label: [...labels, operand.name].join(' · '),
            terms,
            total: children.reduce((n, c) => n + c.total, 0),
          },
        ];
      }
      if (operand.kind === 'dice') {
        const term = evaluateDiceTerm(operand, direction, operand.label, randomInt);
        return [
          {
            ...(labels.length ? { label: labels.join(' · ') } : {}),
            terms: [term],
            total: term.subtotal,
          },
        ];
      }
      const value =
          operand.kind === 'number'
            ? operand.value
            : operand.kind === 'variable'
              ? variables[operand.name]
              : 0,
        values = [Math.abs(value)],
        termSign = (value < 0 ? -direction : direction) as 1 | -1,
        term: RollTerm = {
          kind: 'modifier',
          sign: termSign,
          values,
          sides: undefined,
          label:
            operand.kind === 'variable'
              ? operand.name
              : `${termSign < 0 ? '−' : '+'}${Math.abs(value)}`,
          subtotal: values.reduce((a, b) => a + b, 0) * termSign,
        };
      return [
        {
          ...(labels.length ? { label: labels.join(' · ') } : {}),
          terms: [term],
          total: term.subtotal,
        },
      ];
    });
  return {
    name: definition.name,
    variables: { ...variables },
    groups: definition.groups.map((group) => {
      if (group.selection) {
        const remaining = [...group.selection.entries],
          selections: string[] = [];
        for (let i = 0; i < group.selection.count; i++) {
          const index = randomInt(0, remaining.length);
          selections.push(remaining.splice(index, 1)[0]);
        }
        return { name: group.name, selections, contributions: [], terms: [], total: 0 };
      }
      const contributions = evaluate(group.expression);
      return {
        name: group.name,
        contributions,
        terms: contributions.flatMap((c) => c.terms),
        total: contributions.reduce((n, c) => n + c.total, 0),
      };
    }),
  };
}
export function formatMacroGroup(group: MacroGroupResult): string {
  if (group.selections) return group.selections.map((entry) => `• ${entry}`).join('\n');
  if (!group.contributions.some((c) => c.label)) return String(group.total);
  const unit = /^(.*?)\s+roll$/i.exec(group.name)?.[1].trim().toLowerCase() || '';
  const expression = group.contributions
    .map((c, index) => {
      const label = c.label
          ? `${c.label}${unit && !c.label.toLowerCase().endsWith(unit) ? ` ${unit}` : ''}`
          : '',
        negative = c.total < 0,
        magnitude = Math.abs(c.total),
        prefix = index === 0 ? (negative ? '−' : '') : negative ? ' − ' : ' + ';
      return `${prefix}${magnitude}${label ? ` ${label}` : ''}`;
    })
    .join('');
  return `${expression} = ${group.total}`;
}
export function macroText(result: MacroResult): string {
  return [
    result.name,
    ...result.groups.map((group) => `${group.name}: ${formatMacroGroup(group)}`),
  ].join('\n');
}
