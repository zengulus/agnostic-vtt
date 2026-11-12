import { useEffect, useState } from 'react';
import { lightSchema, type Token } from '../../shared/model.js';
import { tokenEdits } from '../../shared/tokenEdits.js';
import { useConfirmedAction } from '../useConfirmedAction.js';
import { LightFields } from './LightFields.js';
import type { LightDraft } from '../lightPresets.js';

export function LightEditor({
  token,
  sceneId,
  onClose,
  onDirtyChange,
}: {
  token: Token;
  sceneId: string;
  onClose: () => void;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const action = useConfirmedAction();
  const [draft, setDraft] = useState<LightDraft>(() => ({
    name: token.name,
    light: { ...token.light! },
  }));
  const [hideLabel, setHideLabel] = useState(!!token.hideLabel);
  const dirty =
    token.name !== draft.name ||
    !!token.hideLabel !== hideLabel ||
    JSON.stringify(token.light) !== JSON.stringify(draft.light);
  useEffect(() => {
    onDirtyChange(dirty);
  }, [dirty, onDirtyChange]);
  const save = async (remove = false) => {
    const name = draft.name.trim();
    if (!remove && (!name || !lightSchema.safeParse(draft.light).success)) return;
    const edits = tokenEdits(token, {
      ...token,
      name: remove ? token.name : name,
      hideLabel: remove ? token.hideLabel : hideLabel || undefined,
      light: remove ? undefined : draft.light,
    });
    if (!edits.length) {
      onClose();
      return;
    }
    if (
      await action.run(
        { type: 'TOKEN_PATCH', sceneId, tokenId: token.id, edits },
        remove ? 'Removing light…' : 'Saving light…',
      )
    )
      onClose();
  };
  return (
    <form
      className="light-editor"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <strong>Edit {token.name}</strong>
      <LightFields prefix="Edit light" value={draft} onChange={setDraft} preserveName />
      <label>
        <input
          type="checkbox"
          checked={hideLabel}
          onChange={(e) => setHideLabel(e.target.checked)}
        />{' '}
        Hide name on map unless selected
      </label>
      <p>
        Changes remain a draft until saved. Move the token to reposition it; rotate the token to
        turn a directional beam.
      </p>
      <button
        type="submit"
        disabled={
          !!action.pending || !draft.name.trim() || !lightSchema.safeParse(draft.light).success
        }
      >
        Save light
      </button>
      <button type="button" disabled={!!action.pending} onClick={() => void save(true)}>
        Remove light from token
      </button>
      <button type="button" disabled={!!action.pending} onClick={onClose}>
        Cancel
      </button>
      {action.pending && <p role="status">{action.pending}</p>}
      {action.error && <p role="alert">{action.error}</p>}
    </form>
  );
}
