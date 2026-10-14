import type { Scene, Token } from '../shared/model.js';
import type { Action } from '../shared/protocol.js';
import { tokenEdits } from '../shared/tokenEdits.js';

/** Table edits and optional library saves have separate confirmations. Retain partial success. */
export async function saveTokenDraft(
  draft: { sceneId: string; original?: Token; token: Token; saveTemplate: boolean },
  effects: {
    currentScene: () => Scene | undefined;
    send: (action: Action) => Promise<void>;
    accepted: (token: Token) => void;
  },
): Promise<Token | undefined> {
  if (!effects.currentScene()) return;
  if (draft.original) {
    const edits = tokenEdits(draft.original, draft.token);
    if (edits.length)
      await effects.send({
        type: 'TOKEN_PATCH',
        sceneId: draft.sceneId,
        tokenId: draft.token.id,
        edits,
      });
  } else {
    await effects.send({
      type: 'TOKEN_UPDATE',
      sceneId: draft.sceneId,
      token: draft.token,
      createOnly: true,
    });
  }
  const current = effects.currentScene();
  if (!current) return;
  const saved = current.tokens[draft.token.id];
  if (!saved)
    throw new Error('This token was removed. Close this dialog and select another token.');
  // Promote both the original and form value before a library rejection can return control.
  // A retry now compares with the accepted edit instead of recreating or replaying it.
  effects.accepted(saved);
  if (draft.saveTemplate)
    await effects.send({ type: 'LIBRARY_SAVE', token: { ...saved, id: crypto.randomUUID() } });
  return effects.currentScene() ? saved : undefined;
}
