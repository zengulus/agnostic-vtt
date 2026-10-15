import { z } from 'zod';
import { tokenSchema, type Token } from './model.js';

function edit<F extends string, V extends z.ZodTypeAny>(field: F, value: V) {
  return z.object({ field: z.literal(field), before: value.nullable(), value }).strict();
}
const resource = tokenSchema.shape.resource.unwrap().shape;
/** Positions, identity and grouping are deliberately outside the token form's edit surface. */
export const tokenEditSchema = z.discriminatedUnion('field', [
  edit('name', tokenSchema.shape.name),
  edit('image', tokenSchema.shape.image),
  edit('size', tokenSchema.shape.size),
  edit('rotation', tokenSchema.shape.rotation),
  edit('color', tokenSchema.shape.color),
  edit('owners', tokenSchema.shape.owners),
  edit('visibility', tokenSchema.shape.visibility),
  edit('characterId', tokenSchema.shape.characterId.unwrap()),
  edit('note', tokenSchema.shape.note.unwrap()),
  edit('statuses', tokenSchema.shape.statuses.unwrap()),
  edit('resource.label', resource.label),
  edit('resource.value', resource.value),
  edit('resource.max', resource.max),
]);
export type TokenEdit = z.infer<typeof tokenEditSchema>;
const fields: TokenEdit['field'][] = tokenEditSchema.options.map(
  (option) => option.shape.field.value,
);

function valueAt(token: Token, field: TokenEdit['field']): unknown {
  if (field === 'resource.label') return token.resource?.label ?? null;
  if (field === 'resource.value') return token.resource?.value ?? null;
  if (field === 'resource.max') return token.resource?.max ?? null;
  return token[field] ?? null;
}
function equal(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const left = a as Record<string, unknown>,
    right = b as Record<string, unknown>;
  return (
    Object.keys(left).length === Object.keys(right).length &&
    Object.keys(left).every((key) => Object.hasOwn(right, key) && equal(left[key], right[key]))
  );
}

export function tokenEdits(before: Token, draft: Token): TokenEdit[] {
  return fields.flatMap((field) => {
    const original = valueAt(before, field),
      value = valueAt(draft, field);
    return equal(original, value)
      ? []
      : [tokenEditSchema.parse({ field, before: original, value })];
  });
}

/** Compare and apply atomically against the authoritative token, never an opening snapshot. */
export function applyTokenEdits(current: Token, edits: TokenEdit[]): Token {
  if (new Set(edits.map((entry) => entry.field)).size !== edits.length)
    throw new Error('Duplicate token fields in edit.');
  for (const entry of edits) {
    if (!equal(valueAt(current, entry.field), entry.before))
      throw new Error(
        `This token's ${entry.field} changed while you were editing. Reload the latest values before saving.`,
      );
  }
  const next = { ...current };
  for (const entry of edits) {
    switch (entry.field) {
      case 'resource.label':
        next.resource = {
          ...(next.resource || { label: '', value: 0, max: 10 }),
          label: entry.value,
        };
        break;
      case 'resource.value':
        next.resource = {
          ...(next.resource || { label: '', value: 0, max: 10 }),
          value: entry.value,
        };
        break;
      case 'resource.max':
        next.resource = {
          ...(next.resource || { label: '', value: 0, max: 10 }),
          max: entry.value,
        };
        break;
      default:
        Object.assign(next, { [entry.field]: entry.value });
    }
  }
  return next;
}
