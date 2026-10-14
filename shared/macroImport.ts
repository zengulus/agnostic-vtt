import type { Macro, MacroDefinition } from './macros.js';

export type ImportDefinition = MacroDefinition & { line: number };
/** Match only the importing author's macros; shared names never grant write access. */
export function planMacroImport(
  definitions: ImportDefinition[],
  existing: Macro[],
  ownerId: string,
) {
  const names = new Set<string>();
  return definitions.map((definition) => {
    if (names.has(definition.name))
      throw new Error(
        `Line ${definition.line}: Duplicate macro name in import: ${definition.name}.`,
      );
    names.add(definition.name);
    const matches = existing.filter((m) => m.ownerId === ownerId && m.name === definition.name);
    const unchanged = matches.some((m) => m.source === definition.source);
    return {
      definition,
      matches,
      status: unchanged
        ? ('unchanged' as const)
        : matches.length
          ? ('changed' as const)
          : ('new' as const),
    };
  });
}
