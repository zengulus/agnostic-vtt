import { useState } from 'react';
import { canControl, type Roll } from '../../shared/model.js';
import { characterControlled } from '../../shared/characters.js';
import { useTable } from '../store.js';
import { useConfirmedAction } from '../useConfirmedAction.js';

export function ApplyRoll({ roll }: { roll: Roll }) {
  const s = useTable(),
    action = useConfirmedAction();
  const scene = s.room.scenes[s.viewSceneId || s.room.activeSceneId];
  const options = roll.macro
    ? roll.macro.groups.filter((g) => !g.selections).map((g) => ({ label: g.name, total: g.total }))
    : [{ label: 'Total', total: roll.total }];
  const [index, setIndex] = useState(0),
    [amount, setAmount] = useState(() => String(Math.abs(options[0]?.total ?? 0))),
    [target, setTarget] = useState<{
      sceneId: string;
      tokenId: string;
      characterId: string | null;
      resourceId: string | null;
      label: string | null;
    } | null>(null);
  const tokens = Object.values(scene.tokens).filter((token) => {
    if (!s.self || !canControl(token, s.self.id, s.self.role)) return false;
    if (!token.resourceId) return !!token.resource;
    const sheet = token.characterId && s.room.characters?.[token.characterId];
    return (
      !!sheet &&
      characterControlled(sheet, s.self.id, s.self.role) &&
      sheet.resources.some((r) => r.id === token.resourceId)
    );
  });
  if (!options.length || !tokens.length) return null;
  const selected =
    target?.sceneId === scene.id ? tokens.find((t) => t.id === target.tokenId) : undefined;
  const sameResource =
    !!selected &&
    !!target &&
    target.characterId === (selected.characterId || null) &&
    target.resourceId === (selected.resourceId || null) &&
    target.label === (selected.resourceId ? null : (selected.resource?.label ?? null));
  const value = Number(amount);
  const valid =
    amount.trim() !== '' &&
    Number.isFinite(value) &&
    value > 0 &&
    value <= 10000 &&
    !!selected &&
    sameResource &&
    (!selected.resourceId || Number.isInteger(value));
  return (
    <details className="apply-roll">
      <summary>Apply to resource</summary>
      <label>
        Result
        <select
          aria-label="Roll result group"
          value={index}
          onChange={(e) => {
            const next = Number(e.target.value);
            setIndex(next);
            setAmount(String(Math.abs(options[next].total)));
          }}
        >
          {options.map((option, i) => (
            <option key={i} value={i}>
              {option.label}: {option.total}
            </option>
          ))}
        </select>
      </label>
      <label>
        Target
        <select
          aria-label="Apply roll target"
          value={selected?.id || ''}
          onChange={(e) => {
            const token = tokens.find((t) => t.id === e.target.value);
            setTarget(
              token
                ? {
                    sceneId: scene.id,
                    tokenId: token.id,
                    characterId: token.characterId || null,
                    resourceId: token.resourceId || null,
                    label: token.resourceId ? null : (token.resource?.label ?? null),
                  }
                : null,
            );
          }}
        >
          <option value="">Choose a target</option>
          {tokens.map((token) => (
            <option value={token.id} key={token.id}>
              {token.name}
            </option>
          ))}
        </select>
      </label>
      {selected && (
        <small>
          Resource:{' '}
          {selected.resourceId
            ? s.room.characters?.[selected.characterId || '']?.resources.find(
                (r) => r.id === selected.resourceId,
              )?.name
            : selected.resource?.label || 'Resource'}
        </small>
      )}
      {target && !sameResource && (
        <span role="alert">The target resource changed. Choose it again before applying.</span>
      )}
      <label>
        Amount
        <input
          aria-label="Apply roll amount"
          type="number"
          min={0}
          max={10000}
          step="any"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
      </label>
      {([-1, 1] as const).map((direction) => (
        <button
          key={direction}
          type="button"
          disabled={!valid || !!action.pending}
          onClick={() =>
            void action.run(
              {
                type: 'TOKEN_RESOURCE_ADJUST',
                sceneId: scene.id,
                tokenId: selected!.id,
                delta: direction * value,
                expected: {
                  characterId: target!.characterId,
                  resourceId: target!.resourceId,
                  label: target!.label,
                },
              },
              'Applying resource change…',
            )
          }
        >
          {direction < 0 ? 'Confirm spend' : 'Confirm restore'}
        </button>
      ))}
      {action.pending && <span role="status">{action.pending}</span>}
      {action.error && <span role="alert">{action.error}</span>}
    </details>
  );
}
