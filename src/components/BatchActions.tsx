import { useState } from 'react';
import { useTable } from '../store.js';
import { useConfirmedAction } from '../useConfirmedAction.js';

export function BatchActions({ sceneId, ids }: { sceneId: string; ids: string[] }) {
  const s = useTable(),
    action = useConfirmedAction();
  const [label, setLabel] = useState(''),
    [amount, setAmount] = useState('1'),
    [presetId, setPresetId] = useState(''),
    [anchor, setAnchor] = useState(''),
    [rounds, setRounds] = useState('1'),
    [phase, setPhase] = useState<'start' | 'end'>('start');
  const value = Number(amount),
    valid = Number.isInteger(value) && value > 0 && value <= 10000,
    durationValid =
      !anchor ||
      (Number.isInteger(Number(rounds)) && Number(rounds) > 0 && Number(rounds) <= 10000);
  const preset = presetId ? s.room.statusPresets?.[presetId] : undefined;
  return (
    <details className="token-statuses batch-actions">
      <summary>Selected actions · {ids.length}</summary>
      <label>
        Condition preset
        <select
          aria-label="Batch condition preset"
          value={presetId}
          onChange={(e) => {
            setPresetId(e.target.value);
            const selected = s.room.statusPresets?.[e.target.value];
            if (selected) setLabel(selected.label);
          }}
        >
          <option value="">Custom condition</option>
          {Object.values(s.room.statusPresets || {}).map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
      </label>
      <label>
        Condition name
        <input
          aria-label="Batch condition name"
          maxLength={24}
          value={label}
          onChange={(e) => setLabel(e.target.value)}
        />
      </label>
      <label>
        Expires on
        <select
          aria-label="Batch condition expires on"
          value={anchor}
          onChange={(e) => setAnchor(e.target.value)}
        >
          <option value="">Manually</option>
          {(s.room.tracker?.entries || []).map((entry) => (
            <option key={entry.id} value={entry.id}>
              {entry.name}
            </option>
          ))}
        </select>
      </label>
      {anchor && (
        <>
          <label>
            Rounds
            <input
              aria-label="Batch condition rounds"
              type="number"
              min={1}
              max={10000}
              value={rounds}
              onChange={(e) => setRounds(e.target.value)}
            />
          </label>
          <label>
            Turn phase
            <select
              aria-label="Batch condition turn phase"
              value={phase}
              onChange={(e) => setPhase(e.target.value as 'start' | 'end')}
            >
              <option value="start">Start</option>
              <option value="end">End</option>
            </select>
          </label>
        </>
      )}
      <button
        type="button"
        disabled={!label.trim() || !durationValid || !!action.pending}
        onClick={() =>
          void action.run(
            {
              type: 'TOKEN_BATCH_ACTION',
              sceneId,
              tokenIds: ids,
              operation: {
                kind: 'add-status',
                status: {
                  ...preset,
                  id: crypto.randomUUID(),
                  label: label.trim(),
                  color: preset?.color || '#d8b46c',
                  icon: preset?.icon || 'circle',
                  duration: anchor
                    ? { participantId: anchor, remaining: Number(rounds), phase }
                    : undefined,
                },
              },
            },
            'Adding conditions…',
          )
        }
      >
        Add condition to selected
      </button>
      <button
        type="button"
        disabled={!label.trim() || !!action.pending}
        onClick={() =>
          void action.run(
            {
              type: 'TOKEN_BATCH_ACTION',
              sceneId,
              tokenIds: ids,
              operation: { kind: 'remove-status', label: label.trim() },
            },
            'Removing conditions…',
          )
        }
      >
        Remove condition from selected
      </button>
      <label>
        Amount
        <input
          aria-label="Batch resource amount"
          type="number"
          min={1}
          max={10000}
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
      </label>
      {([-1, 1] as const).map((direction) => (
        <button
          type="button"
          key={direction}
          disabled={!valid || !!action.pending}
          onClick={() =>
            void action.run(
              {
                type: 'TOKEN_BATCH_ACTION',
                sceneId,
                tokenIds: ids,
                operation: { kind: 'adjust-resource', delta: direction * value },
              },
              'Updating resources…',
            )
          }
        >
          {direction < 0 ? 'Spend' : 'Restore'} selected resources
        </button>
      ))}
      <small>Every selected token must be controlled and have an eligible resource.</small>
      {action.pending && <span role="status">{action.pending}</span>}
      {action.error && <span role="alert">{action.error}</span>}
      {!s.self && <span>Join a table to make changes.</span>}
    </details>
  );
}
