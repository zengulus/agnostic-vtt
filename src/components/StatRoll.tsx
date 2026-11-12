import { useState } from 'react';
import { useTable } from '../store.js';
import { useConfirmedAction } from '../useConfirmedAction.js';
import { characterControlled } from '../../shared/characters.js';

export function StatRoll({ characterIds }: { characterIds: string[] }) {
  const s = useTable(),
    action = useConfirmedAction();
  const [stat, setStat] = useState(''),
    [expression, setExpression] = useState('1d20'),
    [modifier, setModifier] = useState('0'),
    [privateRoll, setPrivateRoll] = useState(true);
  const sheets = characterIds.map((id) => s.room.characters?.[id]);
  if (
    !s.self ||
    !sheets.length ||
    sheets.some((sheet) => !sheet || !characterControlled(sheet, s.self!.id, s.self!.role))
  )
    return null;
  const names = Object.keys(sheets[0]!.stats).filter((name) =>
    sheets.every((sheet) => Object.hasOwn(sheet!.stats, name)),
  );
  if (!names.length) return null;
  const chosen = stat || names[0];
  return (
    <details className="token-statuses stat-roll">
      <summary>Roll stat{characterIds.length > 1 ? ` · ${characterIds.length}` : ''}</summary>
      <label>
        Stat
        <select aria-label="Roll stat" value={chosen} onChange={(e) => setStat(e.target.value)}>
          {!names.includes(chosen) && <option value={chosen}>Stat no longer available</option>}
          {names.map((name) => (
            <option key={name}>{name}</option>
          ))}
        </select>
      </label>
      <label>
        Dice
        <input
          aria-label="Stat roll dice"
          value={expression}
          maxLength={80}
          onChange={(e) => setExpression(e.target.value)}
        />
      </label>
      <label>
        Adjustment
        <input
          aria-label="Stat roll adjustment"
          type="number"
          step="any"
          min={-10000}
          max={10000}
          value={modifier}
          onChange={(e) => setModifier(e.target.value)}
        />
      </label>
      <label>
        <input
          type="checkbox"
          checked={privateRoll}
          onChange={(e) => setPrivateRoll(e.target.checked)}
        />{' '}
        Private result
      </label>
      <button
        type="button"
        disabled={
          !!action.pending ||
          !names.includes(chosen) ||
          !expression.trim() ||
          !modifier.trim() ||
          !Number.isFinite(Number(modifier)) ||
          Math.abs(Number(modifier)) > 10000
        }
        onClick={() =>
          void action.run(
            {
              type: 'STAT_ROLL_REQUEST',
              characterIds,
              stat: chosen,
              expression,
              modifier: Number(modifier),
              visibility: privateRoll ? 'private' : 'public',
            },
            'Rolling stats…',
          )
        }
      >
        Roll {chosen}
      </button>
      {action.pending && <span role="status">{action.pending}</span>}
      {action.error && <span role="alert">{action.error}</span>}
    </details>
  );
}
