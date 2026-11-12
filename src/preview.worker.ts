import { parseCharacter } from '../shared/characters.js';
import { importMacros, type Macro } from '../shared/macros.js';
import { planMacroImport } from '../shared/macroImport.js';

export type PreviewRequest =
  | { kind: 'character'; text: string }
  | { kind: 'macros'; text: string; macros: Macro[]; ownerId: string };
export type CharacterPreview = { sheet: ReturnType<typeof parseCharacter> | null; error: string };
export type MacroPreview = ReturnType<typeof importMacros> & {
  plan: ReturnType<typeof planMacroImport>;
};

self.onmessage = (event: MessageEvent<PreviewRequest>) => {
  const request = event.data;
  try {
    if (request.kind === 'character') {
      self.postMessage({
        sheet: parseCharacter(request.text),
        error: '',
      } satisfies CharacterPreview);
    } else {
      const imported = importMacros(request.text);
      self.postMessage({
        ...imported,
        plan: planMacroImport(imported.macros, request.macros, request.ownerId),
      } satisfies MacroPreview);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Preview failed.';
    self.postMessage(
      request.kind === 'character'
        ? { sheet: null, error: message }
        : { macros: [], plan: [], errors: [{ line: 1, message }] },
    );
  }
};
