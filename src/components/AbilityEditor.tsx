import { useState } from 'react';
import {
  characterDigest,
  type CharacterAbility,
  type CharacterSheet,
} from '../../shared/characters.js';
import { useConfirmedAction } from '../useConfirmedAction.js';

export function AbilityEditor({
  sheet,
  ability,
  close,
}: {
  sheet: CharacterSheet;
  ability?: CharacterAbility;
  close: () => void;
}) {
  const [digest] = useState(() => characterDigest(sheet));
  const [draft, setDraft] = useState<CharacterAbility>(() =>
    ability
      ? structuredClone(ability)
      : {
          id: crypto.randomUUID(),
          name: '',
          group: 'Actions',
          text: '',
          macro: '',
          maxUses: 0,
          remainingUses: 0,
          prepared: true,
          refresh: 'manual',
          costs: [],
        },
  );
  const [costs, setCosts] = useState(() =>
    draft.costs.map((c) => `${c.resourceId}:${c.amount}`).join(', '),
  );
  const [localError, setLocalError] = useState('');
  const action = useConfirmedAction();
  const update = (change: Partial<CharacterAbility>) => setDraft((old) => ({ ...old, ...change }));
  return (
    <form
      className="ability-editor"
      onSubmit={async (e) => {
        e.preventDefault();
        setLocalError('');
        const parsed: CharacterAbility['costs'] = [];
        for (const part of costs
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)) {
          const match = /^([A-Za-z0-9_-]+):(\d+)$/.exec(part);
          if (!match) {
            setLocalError('Use resource-id:amount, separated by commas.');
            return;
          }
          parsed.push({ resourceId: match[1], amount: Number(match[2]) });
        }
        if (
          await action.run(
            {
              type: 'CHARACTER_ABILITY_SAVE',
              id: sheet.id,
              digest,
              ability: { ...draft, costs: parsed },
            },
            'Saving ability…',
          )
        )
          close();
      }}
    >
      <label>
        Name
        <input
          required
          maxLength={64}
          aria-label="Ability name"
          value={draft.name}
          onChange={(e) => update({ name: e.target.value })}
        />
      </label>
      <label>
        Group
        <input
          required
          maxLength={48}
          aria-label="Ability group"
          value={draft.group}
          onChange={(e) => update({ group: e.target.value })}
        />
      </label>
      <label>
        Description
        <textarea
          maxLength={2000}
          aria-label="Ability description"
          value={draft.text}
          onChange={(e) => update({ text: e.target.value })}
        />
      </label>
      <label>
        Macro
        <input
          maxLength={4096}
          aria-label="Ability macro"
          value={draft.macro}
          onChange={(e) => update({ macro: e.target.value })}
        />
      </label>
      <label>
        Maximum uses (0 = unlimited)
        <input
          type="number"
          min={0}
          max={100}
          required
          aria-label="Ability maximum uses"
          value={draft.maxUses}
          onChange={(e) => {
            const maxUses = Number(e.target.value);
            update({
              maxUses,
              remainingUses: draft.maxUses === 0 ? maxUses : Math.min(draft.remainingUses, maxUses),
            });
          }}
        />
      </label>
      {draft.maxUses > 0 && (
        <label>
          Remaining uses
          <input
            type="number"
            min={0}
            max={draft.maxUses}
            required
            aria-label="Ability remaining uses"
            value={draft.remainingUses}
            onChange={(e) => update({ remainingUses: Number(e.target.value) })}
          />
        </label>
      )}
      <label>
        Refresh
        <select
          aria-label="Ability refresh"
          value={draft.refresh}
          onChange={(e) => update({ refresh: e.target.value as CharacterAbility['refresh'] })}
        >
          {['manual', 'recovery', 'encounter', 'rest'].map((v) => (
            <option key={v}>{v}</option>
          ))}
        </select>
      </label>
      <label>
        Costs (resource-id:amount)
        <input
          aria-label="Ability costs"
          value={costs}
          onChange={(e) => setCosts(e.target.value)}
        />
      </label>
      <label>
        <input
          type="checkbox"
          checked={draft.prepared}
          onChange={(e) => update({ prepared: e.target.checked })}
        />{' '}
        Prepared
      </label>
      <button disabled={!!action.pending}>Save ability</button>
      <button type="button" disabled={!!action.pending} onClick={close}>
        Cancel
      </button>
      {action.pending && <span role="status">{action.pending}</span>}
      {(action.error || localError) && <span role="alert">{action.error || localError}</span>}
    </form>
  );
}
