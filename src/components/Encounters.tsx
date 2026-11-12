import { useState } from 'react';
import { useTable } from '../store.js';
import { useConfirmedAction } from '../useConfirmedAction.js';
import { encounterDigest, type Encounter } from '../../shared/model.js';

function RepairEncounter({ encounter }: { encounter: Encounter }) {
  const s = useTable(),
    action = useConfirmedAction();
  const [draft, setDraft] = useState<{ digest: string; from: string; to: string } | null>(null);
  const links = [
    ...new Set(encounter.tokens.flatMap((t) => (t.characterId ? [t.characterId] : []))),
  ];
  if (!links.length) return null;
  return (
    <div>
      {!draft ? (
        <button
          type="button"
          onClick={() => setDraft({ digest: encounterDigest(encounter), from: links[0], to: '' })}
        >
          Repair links
        </button>
      ) : (
        <>
          <label>
            Saved link
            <select
              aria-label={`Saved link for ${encounter.name}`}
              value={draft.from}
              onChange={(e) => setDraft({ ...draft, from: e.target.value })}
            >
              {links.map((id) => (
                <option value={id} key={id}>
                  {encounter.characters?.[id]?.name ||
                    s.room.characters?.[id]?.name ||
                    `Missing sheet ${id}`}
                </option>
              ))}
            </select>
          </label>
          <label>
            Replacement
            <select
              aria-label={`Replacement for ${encounter.name}`}
              value={draft.to}
              onChange={(e) => setDraft({ ...draft, to: e.target.value })}
            >
              <option value="">Choose a replacement</option>
              <option value=":unlink">Unlink</option>
              {Object.values(s.room.characters || {}).map((sheet) => (
                <option key={sheet.id} value={sheet.id}>
                  {sheet.name}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            disabled={!draft.to || !!action.pending}
            onClick={async () => {
              if (
                await action.run(
                  {
                    type: 'ENCOUNTER_REPAIR',
                    id: encounter.id,
                    digest: draft.digest,
                    from: draft.from,
                    to: draft.to === ':unlink' ? null : draft.to,
                  },
                  'Repairing encounter…',
                )
              )
                setDraft(null);
            }}
          >
            Apply link repair
          </button>
          <small>Resources missing from the replacement sheet will be unlinked.</small>
          <button type="button" disabled={!!action.pending} onClick={() => setDraft(null)}>
            Cancel
          </button>
          {action.pending && <span role="status">{action.pending}</span>}
          {action.error && <span role="alert">{action.error}</span>}
        </>
      )}
    </div>
  );
}

export function Encounters() {
  const s = useTable(),
    action = useConfirmedAction();
  const [name, setName] = useState('');
  const [independent, setIndependent] = useState(false);
  if (s.self?.role !== 'gm') return null;
  return (
    <details className="encounter-library">
      <summary>Encounters</summary>
      <p>
        Save selected tokens and their linked turn entries. Placement adds fresh tokens; linked
        character sheets remain shared. Durations tied to other participants are omitted.
      </p>
      <label>
        Encounter name
        <input
          aria-label="Encounter name"
          maxLength={64}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </label>
      <label>
        <input
          type="checkbox"
          checked={independent}
          onChange={(e) => setIndependent(e.target.checked)}
        />{' '}
        Create independent character copies for each token
      </label>
      <button
        type="button"
        disabled={!name.trim() || !s.selectedIds.length || !!action.pending}
        onClick={async () => {
          if (
            await action.run(
              {
                type: 'ENCOUNTER_SAVE',
                id: crypto.randomUUID(),
                name: name.trim(),
                sceneId: s.viewSceneId || s.room.activeSceneId,
                tokenIds: s.selectedIds,
              },
              'Saving encounter…',
            )
          )
            setName('');
        }}
      >
        Save selected as encounter
      </button>
      {Object.values(s.room.encounters || {}).map((encounter) => (
        <div key={encounter.id}>
          <span>
            {encounter.name} · {encounter.tokens.length} tokens
          </span>
          <button
            type="button"
            disabled={!!action.pending}
            onClick={() =>
              void action.run(
                {
                  type: 'ENCOUNTER_PLACE',
                  id: encounter.id,
                  sceneId: s.viewSceneId || s.room.activeSceneId,
                  independent,
                },
                `Placing ${encounter.name}…`,
              )
            }
          >
            Place {encounter.name}
          </button>
          {(() => {
            const token =
              s.room.scenes[s.viewSceneId || s.room.activeSceneId]?.tokens[s.selectedIds[0]];
            if (token?.encounterId !== encounter.id || !token.encounterPlacementId) return null;
            const placementId = token.encounterPlacementId;
            return (
              <button
                type="button"
                disabled={!!action.pending}
                onClick={() => {
                  if (
                    window.confirm(
                      'Reset this placement’s positions, scene counters, conditions, and turn values? Linked character resources remain unchanged.',
                    )
                  )
                    void action.run(
                      {
                        type: 'ENCOUNTER_REFRESH',
                        id: encounter.id,
                        sceneId: s.viewSceneId || s.room.activeSceneId,
                        placementId,
                      },
                      'Refreshing encounter…',
                    );
                }}
              >
                Refresh selected placement
              </button>
            );
          })()}
          <button
            type="button"
            disabled={!!action.pending}
            aria-label={`Delete encounter ${encounter.name}`}
            onClick={() =>
              void action.run({ type: 'ENCOUNTER_DELETE', id: encounter.id }, 'Deleting encounter…')
            }
          >
            Delete
          </button>
          <RepairEncounter encounter={encounter} />
        </div>
      ))}
      {action.pending && <span role="status">{action.pending}</span>}
      {action.error && <span role="alert">{action.error}</span>}
    </details>
  );
}
