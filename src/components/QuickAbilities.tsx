import { useState } from 'react';
import {
  characterControlled,
  unavailableAbility,
  type CharacterAbility,
} from '../../shared/characters.js';
import { parseMacro } from '../../shared/macros.js';
import { useTable } from '../store.js';
import { useConfirmedAction } from '../useConfirmedAction.js';

/** Reuse the same authoritative character ability action from the selected token. */
export function QuickAbilities({ characterId }: { characterId: string }) {
  const s = useTable();
  const sheet = s.room.characters?.[characterId];
  const action = useConfirmedAction();
  const [prepared, setPrepared] = useState<CharacterAbility | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [privateResult, setPrivateResult] = useState(true);
  const [filter, setFilter] = useState(''),
    [group, setGroup] = useState('all'),
    [favoritesOnly, setFavoritesOnly] = useState(false);
  const favoritesKey = `aether-ability-favorites:${s.room.id}:${s.self?.id}:${characterId}`;
  const [favorites, setFavorites] = useState<string[]>(() => {
    try {
      const value: unknown = JSON.parse(localStorage.getItem(favoritesKey) || '[]');
      return Array.isArray(value)
        ? value.filter((id): id is string => typeof id === 'string').slice(0, 80)
        : [];
    } catch {
      return [];
    }
  });
  if (!sheet || !s.self || !characterControlled(sheet, s.self.id, s.self.role)) return null;
  const currentPrepared =
    prepared &&
    JSON.stringify(sheet.abilities.find((a) => a.id === prepared.id)) === JSON.stringify(prepared);
  const run = async (ability: CharacterAbility, inputs: Record<string, number>) => {
    if (
      await action.run(
        {
          type: 'CHARACTER_ABILITY_USE',
          id: sheet.id,
          abilityId: ability.id,
          variables: inputs,
          visibility: privateResult ? 'private' : 'public',
        },
        `Using ${ability.name}…`,
      )
    )
      setPrepared(null);
  };
  const choose = (ability: CharacterAbility) => {
    const missing = ability.macro
      ? parseMacro(ability.macro).variables.filter((name) => !Object.hasOwn(sheet.stats, name))
      : [];
    if (!missing.length) void run(ability, {});
    else {
      setPrepared(ability);
      setValues(Object.fromEntries(missing.map((name) => [name, '0'])));
    }
  };
  return (
    <div className="quick-ability-shortcuts">
      {sheet.abilities
        .filter((ability) => favorites.includes(ability.id))
        .map((ability) => (
          <button
            key={ability.id}
            type="button"
            disabled={!!action.pending || !!unavailableAbility(sheet, ability)}
            onClick={() => choose(ability)}
          >
            {ability.name}
          </button>
        ))}
      <details
        className="token-statuses quick-abilities"
        open={prepared || action.pending || action.error ? true : undefined}
      >
        <summary>Actions</summary>
        <label>
          <input
            type="checkbox"
            checked={privateResult}
            onChange={(e) => setPrivateResult(e.target.checked)}
          />{' '}
          Private result
        </label>
        <label>
          Search actions
          <input
            aria-label="Search quick actions"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
        </label>
        <label>
          Group
          <select
            aria-label="Quick action group"
            value={group}
            onChange={(e) => setGroup(e.target.value)}
          >
            <option value="all">All groups</option>
            {[...new Set(sheet.abilities.map((a) => a.group))].map((name) => (
              <option value={name} key={name}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <label>
          <input
            type="checkbox"
            checked={favoritesOnly}
            onChange={(e) => setFavoritesOnly(e.target.checked)}
          />{' '}
          Favorites only
        </label>
        {sheet.abilities
          .filter(
            (a) =>
              (group === 'all' || a.group === group) &&
              (!favoritesOnly || favorites.includes(a.id)) &&
              `${a.name} ${a.group}`.toLowerCase().includes(filter.toLowerCase()),
          )
          .map((ability) => (
            <div key={ability.id}>
              <button
                type="button"
                disabled={!!action.pending || !!unavailableAbility(sheet, ability)}
                onClick={() => choose(ability)}
              >
                {ability.name}
              </button>
              <button
                type="button"
                aria-label={`${favorites.includes(ability.id) ? 'Unpin' : 'Pin'} ${ability.name}`}
                onClick={() => {
                  const next = favorites.includes(ability.id)
                    ? favorites.filter((id) => id !== ability.id)
                    : [...favorites, ability.id];
                  setFavorites(next);
                  try {
                    localStorage.setItem(favoritesKey, JSON.stringify(next));
                  } catch {
                    /* optional preferences */
                  }
                }}
              >
                {favorites.includes(ability.id) ? '★' : '☆'}
              </button>
            </div>
          ))}
        {!sheet.abilities.length && <span>No actions on this sheet.</span>}
        {prepared && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!currentPrepared) return;
              void run(
                prepared,
                Object.fromEntries(
                  Object.entries(values).map(([name, value]) => [name, Number(value)]),
                ),
              );
            }}
          >
            <strong>{prepared.name}</strong>
            {!currentPrepared && (
              <span role="alert">This action changed. Cancel and choose it again.</span>
            )}
            {Object.keys(values).map((name) => (
              <label key={name}>
                {name}
                <input
                  aria-label={`Action input ${name}`}
                  required
                  type="number"
                  step="any"
                  min={-10000}
                  max={10000}
                  value={values[name]}
                  onChange={(e) => setValues({ ...values, [name]: e.target.value })}
                />
              </label>
            ))}
            <button disabled={!!action.pending || !currentPrepared}>Use action</button>
            <button type="button" disabled={!!action.pending} onClick={() => setPrepared(null)}>
              Cancel
            </button>
          </form>
        )}
        {action.pending && <span role="status">{action.pending}</span>}
        {action.error && <span role="alert">{action.error}</span>}
      </details>
    </div>
  );
}
