import type { ProximityRule } from '../../shared/model.js';

export function ProximityEditor({
  value,
  onChange,
}: {
  value?: ProximityRule;
  onChange: (value: ProximityRule | undefined) => void;
}) {
  return (
    <details className="proximity-editor">
      <summary>Proximity cue{value ? ' · on' : ''}</summary>
      <label>
        <input
          type="checkbox"
          checked={!!value}
          onChange={(e) =>
            onChange(
              e.target.checked ? { distance: 80, when: 'enter', playerMessage: '' } : undefined,
            )
          }
        />{' '}
        Notify when a token crosses the boundary
      </label>
      {value && (
        <>
          <label>
            Distance in map pixels{' '}
            <input
              type="number"
              min={0}
              max={5000}
              value={value.distance}
              onChange={(e) => onChange({ ...value, distance: Number(e.target.value) })}
            />
          </label>
          <label>
            When{' '}
            <select
              value={value.when}
              onChange={(e) =>
                onChange({ ...value, when: e.target.value as ProximityRule['when'] })
              }
            >
              <option value="enter">Enter</option>
              <option value="leave">Leave</option>
              <option value="both">Enter and leave</option>
            </select>
          </label>
          <label>
            Optional message to players{' '}
            <input
              maxLength={160}
              value={value.playerMessage || ''}
              onChange={(e) => onChange({ ...value, playerMessage: e.target.value })}
            />
          </label>
          <small>
            The GM always receives a cue. Players see the message only for public objects and
            visible tokens. Detection follows the path of each committed move.
          </small>
        </>
      )}
    </details>
  );
}
