import { useState } from 'react';
import {
  canControl,
  REDACTED_TURN_ID,
  statusDigest,
  type Token,
  type TokenStatus,
} from '../../shared/model.js';
import { useTable } from '../store.js';
import { useConfirmedAction } from '../useConfirmedAction.js';

export function TokenStatuses({ token, sceneId }: { token: Token; sceneId: string }) {
  const s = useTable();
  const action = useConfirmedAction();
  const [draft, setDraft] = useState<TokenStatus | null>(null);
  const [expected, setExpected] = useState<string | undefined>();
  const controlled = !!s.self && canControl(token, s.self.id, s.self.role);
  const entries = s.room.tracker?.entries || [];
  const begin = () => {
    setExpected(undefined);
    setDraft({ id: crypto.randomUUID(), label: '', color: token.color, icon: 'circle' });
  };
  return (
    <details className="token-statuses">
      <summary>Conditions{token.statuses?.length ? ` · ${token.statuses.length}` : ''}</summary>
      {(token.statuses || []).map((status) => (
        <div key={status.id}>
          <span style={{ color: status.color }}>
            {status.label}
            {status.counter !== undefined ? ` ${status.counter}` : ''}
            {status.duration ? ` · ${status.duration.remaining} rounds` : ''}
            {status.note ? ` · ${status.note}` : ''}
          </span>
          {controlled && (
            <>
              <button
                type="button"
                disabled={!!action.pending}
                onClick={() => {
                  setExpected(statusDigest(status));
                  setDraft(status);
                }}
                aria-label={`Edit ${status.label}`}
              >
                Edit
              </button>
              <button
                type="button"
                disabled={!!action.pending}
                onClick={() =>
                  void action.run(
                    {
                      type: 'TOKEN_STATUS_REMOVE',
                      sceneId,
                      tokenId: token.id,
                      statusId: status.id,
                    },
                    'Removing condition…',
                  )
                }
                aria-label={`Remove ${status.label}`}
              >
                ×
              </button>
            </>
          )}
        </div>
      ))}
      {controlled && (
        <button
          type="button"
          disabled={!!action.pending || (token.statuses?.length || 0) >= 16}
          onClick={begin}
        >
          Add condition
        </button>
      )}
      {controlled &&
        Object.values(s.room.statusPresets || {}).map((preset) => (
          <div key={preset.id}>
            <button
              type="button"
              disabled={!!action.pending || (token.statuses?.length || 0) >= 16}
              onClick={() =>
                void action.run(
                  {
                    type: 'TOKEN_STATUS_SET',
                    sceneId,
                    tokenId: token.id,
                    status: { ...preset, id: crypto.randomUUID() },
                  },
                  `Adding ${preset.label}…`,
                )
              }
            >
              + {preset.label}
            </button>
            {s.self?.role === 'gm' && (
              <button
                type="button"
                disabled={!!action.pending}
                aria-label={`Delete preset ${preset.label}`}
                onClick={() =>
                  void action.run(
                    { type: 'STATUS_PRESET_DELETE', id: preset.id },
                    'Removing preset…',
                  )
                }
              >
                ×
              </button>
            )}
          </div>
        ))}
      {draft && controlled && (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (
              await action.run(
                { type: 'TOKEN_STATUS_SET', sceneId, tokenId: token.id, status: draft, expected },
                'Saving condition…',
              )
            )
              setDraft(null);
          }}
        >
          <label>
            Condition name
            <input
              aria-label="Condition name"
              required
              maxLength={24}
              value={draft.label}
              onChange={(e) => setDraft({ ...draft, label: e.target.value })}
            />
          </label>
          <label>
            Note
            <input
              aria-label="Condition note"
              maxLength={120}
              value={draft.note || ''}
              onChange={(e) => setDraft({ ...draft, note: e.target.value })}
            />
          </label>
          <label>
            Counter
            <input
              aria-label="Condition counter"
              type="number"
              min={-10000}
              max={10000}
              value={draft.counter ?? ''}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  counter: e.target.value === '' ? undefined : Number(e.target.value),
                })
              }
            />
          </label>
          <label>
            Colour
            <input
              aria-label="Condition colour"
              type="color"
              value={draft.color}
              onChange={(e) => setDraft({ ...draft, color: e.target.value })}
            />
          </label>
          <label>
            Expires on
            <select
              aria-label="Condition expires on"
              value={draft.duration?.participantId || ''}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  duration: e.target.value
                    ? {
                        participantId: e.target.value,
                        remaining: draft.duration?.remaining || 1,
                        phase: draft.duration?.phase || 'start',
                      }
                    : undefined,
                })
              }
            >
              <option value="">Manually</option>
              {draft.duration?.participantId === REDACTED_TURN_ID && (
                <option value={REDACTED_TURN_ID}>Current turn anchor</option>
              )}
              {entries.map((entry) => (
                <option value={entry.id} key={entry.id}>
                  {entry.name}
                </option>
              ))}
            </select>
          </label>
          {draft.duration && (
            <>
              <label>
                Rounds
                <input
                  aria-label="Condition rounds"
                  type="number"
                  required
                  min={1}
                  max={10000}
                  value={draft.duration.remaining}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      duration: { ...draft.duration!, remaining: Number(e.target.value) },
                    })
                  }
                />
              </label>
              <label>
                Turn phase
                <select
                  aria-label="Condition turn phase"
                  value={draft.duration.phase}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      duration: { ...draft.duration!, phase: e.target.value as 'start' | 'end' },
                    })
                  }
                >
                  <option value="start">Start</option>
                  <option value="end">End</option>
                </select>
              </label>
            </>
          )}
          <button disabled={!!action.pending}>Save condition</button>
          {s.self?.role === 'gm' && (
            <button
              type="button"
              disabled={!!action.pending || !draft.label.trim()}
              onClick={() => {
                const { duration: _duration, ...preset } = draft;
                void action.run(
                  { type: 'STATUS_PRESET_SET', preset: { ...preset, id: crypto.randomUUID() } },
                  'Saving preset…',
                );
              }}
            >
              Save as campaign preset
            </button>
          )}
          <button type="button" disabled={!!action.pending} onClick={() => setDraft(null)}>
            Cancel
          </button>
        </form>
      )}
      {action.pending && <span role="status">{action.pending}</span>}
      {action.error && <span role="alert">{action.error}</span>}
    </details>
  );
}
