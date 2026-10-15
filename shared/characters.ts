import { z } from 'zod';
import { parseMacro } from './macros.js';
import { sha256 } from './macroDigest.js';

const identifier = z
  .string()
  .regex(/^[a-zA-Z0-9_-]{1,64}$/)
  .refine((s) => !['__proto__', 'prototype', 'constructor'].includes(s));
export const refreshSchema = z.enum(['manual', 'recovery', 'encounter', 'rest']);
export type Refresh = z.infer<typeof refreshSchema>;
export const characterResourceSchema = z.object({
  id: identifier,
  name: z.string().trim().min(1).max(48),
  current: z.number().int().min(0).max(10000),
  max: z.number().int().min(1).max(10000),
  refresh: refreshSchema,
});
export const characterAbilitySchema = z.object({
  id: identifier,
  name: z.string().trim().min(1).max(64),
  group: z.string().trim().min(1).max(48),
  text: z.string().max(2000),
  macro: z.string().max(4096),
  maxUses: z.number().int().min(0).max(100),
  remainingUses: z.number().int().min(0).max(100),
  prepared: z.boolean(),
  refresh: refreshSchema,
  costs: z
    .array(z.object({ resourceId: identifier, amount: z.number().int().min(1).max(10000) }))
    .max(8),
});
export const characterDefinitionSchema = z
  .object({
    name: z.string().trim().min(1).max(64),
    description: z.string().max(2000),
    stats: z
      .record(
        z
          .string()
          .regex(/^[A-Za-z][A-Za-z0-9_]{0,23}$/)
          .refine((s) => !['__proto__', 'prototype', 'constructor'].includes(s)),
        z.number().finite().min(-10000).max(10000),
      )
      .refine((s) => Object.keys(s).length <= 30, 'Use at most 30 stats.'),
    resources: z.array(characterResourceSchema).max(30),
    abilities: z.array(characterAbilitySchema).max(80),
  })
  .superRefine((sheet, ctx) => {
    const issue = (message: string) => ctx.addIssue({ code: 'custom', message });
    if (new Set(sheet.resources.map((r) => r.id)).size !== sheet.resources.length)
      issue('Duplicate resource identifiers.');
    if (new Set(sheet.abilities.map((a) => a.id)).size !== sheet.abilities.length)
      issue('Duplicate ability identifiers.');
    for (const r of sheet.resources)
      if (r.current > r.max) issue(`${r.name}: current exceeds maximum.`);
    for (const a of sheet.abilities) {
      if (a.remainingUses > a.maxUses) issue(`${a.name}: remaining uses exceed maximum.`);
      if (new Set(a.costs.map((c) => c.resourceId)).size !== a.costs.length)
        issue(`${a.name}: duplicate resource costs.`);
      for (const c of a.costs)
        if (!sheet.resources.some((r) => r.id === c.resourceId && c.amount <= r.max))
          issue(`${a.name}: unknown resource or cost above its maximum: ${c.resourceId}.`);
      if (a.macro) {
        try {
          parseMacro(a.macro);
        } catch (error) {
          issue(`${a.name}: ${(error as Error).message}`);
        }
      }
    }
  });
export type CharacterDefinition = z.infer<typeof characterDefinitionSchema>;
export type CharacterAbility = z.infer<typeof characterAbilitySchema>;
export interface CharacterSheet extends CharacterDefinition {
  id: string;
  ownerId: string;
  visibility: 'public' | 'private';
}
export interface CharacterUse {
  characterId: string;
  abilityId: string;
  name: string;
  ability: string;
  text: string;
  remainingUses: number | null;
  maxUses: number;
  resources: Array<{ name: string; current: number; max: number; spent: number }>;
}
export const characterVisible = (sheet: CharacterSheet, userId: string, role: string) =>
  sheet.visibility === 'public' || sheet.ownerId === userId || role === 'gm';
export const characterControlled = (sheet: CharacterSheet, userId: string, role: string) =>
  sheet.ownerId === userId || role === 'gm';
export const characterDigest = (sheet: CharacterSheet) => sha256(JSON.stringify(sheet));
export const refreshNames: Record<Refresh, string> = {
  manual: 'Manual',
  recovery: 'Recovery',
  encounter: 'Encounter',
  rest: 'Rest',
};

/** A bounded, data-only INI-style format. Values may be JSON quoted for newlines. */
export function parseCharacter(text: string): CharacterDefinition {
  if (new TextEncoder().encode(text).byteLength > 65536)
    throw new Error('Import character files up to 64 KiB.');
  const result: CharacterDefinition = {
    name: '',
    description: '',
    stats: {},
    resources: [],
    abilities: [],
  };
  let section = '',
    sectionId = '',
    item: Record<string, unknown> | undefined;
  const seen = new Set<string>();
  function fail(line: number, message: string): never {
    throw new Error(`Line ${line}: ${message}`);
  }
  for (const [index, raw] of text
    .replace(/^\uFEFF/, '')
    .split(/\r\n|\r|\n/)
    .entries()) {
    const line = index + 1,
      value = raw.trim();
    if (!value || value.startsWith('#') || value.startsWith(';')) continue;
    const header =
      /^\[(character|stats|resource ([a-zA-Z0-9_-]+)|ability ([a-zA-Z0-9_-]+))\]$/.exec(value);
    if (header) {
      section = header[1].split(' ')[0];
      const id = header[2] || header[3];
      sectionId = `${section}:${id || ''}`;
      if (id && !identifier.safeParse(id).success) fail(line, 'Invalid section identifier.');
      if (seen.has(`section:${header[1]}`)) fail(line, 'Duplicate section.');
      seen.add(`section:${header[1]}`);
      if (section === 'resource') {
        const resource = { id, name: id, current: 0, max: 1, refresh: 'manual' };
        result.resources.push(resource as CharacterDefinition['resources'][number]);
        item = resource;
      } else if (section === 'ability') {
        const ability = {
          id,
          name: id,
          group: 'Actions',
          text: '',
          macro: '',
          maxUses: 1,
          remainingUses: 1,
          prepared: true,
          refresh: 'manual',
          costs: [],
        };
        result.abilities.push(ability as CharacterAbility);
        item = ability;
      } else item = section === 'character' ? result : result.stats;
      continue;
    }
    const entry = /^([A-Za-z][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(value);
    if (!entry || !item)
      fail(
        line,
        'Use [character], [stats], [resource id], or [ability id], followed by key = value.',
      );
    const key = entry[1];
    const keyId = `${sectionId}:${key}`;
    if (seen.has(keyId)) fail(line, `Duplicate field ${key}.`);
    seen.add(keyId);
    let data = entry[2];
    if (data.startsWith('"')) {
      try {
        const parsed: unknown = JSON.parse(data);
        if (typeof parsed !== 'string') throw new Error();
        data = parsed;
      } catch {
        fail(line, 'Use valid double-quoted text and escapes.');
      }
    }
    if (section === 'stats') {
      if (
        !/^[A-Za-z][A-Za-z0-9_]{0,23}$/.test(key) ||
        ['__proto__', 'prototype', 'constructor'].includes(key) ||
        !data ||
        !Number.isFinite(Number(data))
      )
        fail(line, 'Stats need a safe variable name and a number.');
      item[key] = Number(data);
    } else if (
      key === 'name' ||
      (section === 'character' && key === 'description') ||
      (section === 'ability' && ['group', 'text', 'macro'].includes(key))
    )
      item[key] = data;
    else if (['resource', 'ability'].includes(section) && key === 'refresh') item.refresh = data;
    else if (section === 'resource' && ['current', 'max'].includes(key)) {
      if (!/^\d+$/.test(data)) fail(line, 'Resource amounts must be whole numbers.');
      item[key] = Number(data);
    } else if (section === 'ability' && ['uses', 'remaining'].includes(key)) {
      if (key === 'uses' && data === 'unlimited') {
        item.maxUses = 0;
        item.remainingUses = 0;
      } else {
        if (!/^\d+$/.test(data)) fail(line, 'Uses must be whole numbers, or uses = unlimited.');
        if (key === 'uses' && Number(data) === 0)
          fail(
            line,
            'Use a positive use limit, or uses = unlimited. Set remaining = 0 for an expended ability.',
          );
        item[key === 'uses' ? 'maxUses' : 'remainingUses'] = Number(data);
        if (key === 'uses' && !seen.has(`${section}:${String(item.id)}:remaining`))
          item.remainingUses = Number(data);
      }
    } else if (section === 'ability' && key === 'prepared') {
      if (!['true', 'false'].includes(data)) fail(line, 'Prepared must be true or false.');
      item.prepared = data === 'true';
    } else if (section === 'ability' && key === 'cost') {
      item.costs = data
        .split(',')
        .filter((c) => c.trim())
        .map((c) => {
          const match = /^\s*([a-zA-Z0-9_-]+)\s*:\s*(\d+)\s*$/.exec(c);
          if (!match) fail(line, 'Use cost = resource-id:amount, another-id:amount.');
          return { resourceId: match[1], amount: Number(match[2]) };
        });
    } else fail(line, `Unknown field ${key} in [${section}].`);
  }
  const parsed = characterDefinitionSchema.safeParse(result);
  if (!parsed.success)
    throw new Error(
      parsed.error.issues.map((i) => `${i.path.join('.') || 'Character'}: ${i.message}`).join('\n'),
    );
  return parsed.data;
}

export function exportCharacter(sheet: CharacterDefinition): string {
  const quote = (s: string) => JSON.stringify(s);
  return (
    [
      `[character]\nname = ${quote(sheet.name)}\ndescription = ${quote(sheet.description)}`,
      `[stats]\n${Object.entries(sheet.stats)
        .map(([k, v]) => `${k} = ${v}`)
        .join('\n')}`,
      ...sheet.resources.map(
        (r) =>
          `[resource ${r.id}]\nname = ${quote(r.name)}\ncurrent = ${r.current}\nmax = ${r.max}\nrefresh = ${r.refresh}`,
      ),
      ...sheet.abilities.map(
        (a) =>
          `[ability ${a.id}]\nname = ${quote(a.name)}\ngroup = ${quote(a.group)}\ntext = ${quote(a.text)}\nuses = ${a.maxUses || 'unlimited'}\nremaining = ${a.remainingUses}\nprepared = ${a.prepared}\nrefresh = ${a.refresh}\ncost = ${a.costs.map((c) => `${c.resourceId}:${c.amount}`).join(', ')}\nmacro = ${quote(a.macro)}`,
      ),
    ].join('\n\n') + '\n'
  );
}
export function unavailableAbility(
  sheet: CharacterDefinition,
  ability: CharacterAbility,
): string | null {
  if (!ability.prepared) return 'Not prepared';
  if (ability.maxUses && ability.remainingUses === 0) return 'Expended';
  for (const cost of ability.costs) {
    const r = sheet.resources.find((r) => r.id === cost.resourceId);
    if (!r || r.current < cost.amount) return `Needs ${cost.amount} ${r?.name || cost.resourceId}`;
  }
  return null;
}
