import { useEffect, useState } from 'react';
import { useTable } from '../store.js';
import { sendAndWait } from '../connection.js';
import { parseMacro, type Macro } from '../../shared/macros.js';
import { useMacroPreferences } from '../macroPreferences.js';

export function FavoriteActions({ privateRoll }: { privateRoll: boolean }) {
  const s = useTable(),
    [preferences, remember] = useMacroPreferences();
  const [prepared, setPrepared] = useState<Macro | null>(null),
    [values, setValues] = useState<Record<string, string>>({}),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const macros = s.room.macros || {},
    macro = prepared && macros[prepared.id];
  useEffect(() => {
    if (
      prepared &&
      (!macro || macro.source !== prepared.source || macro.visibility !== prepared.visibility)
    ) {
      setPrepared(null);
      setError('That action changed or was removed. Choose it again to review its inputs.');
    }
  }, [macro, prepared]);
  useEffect(() => {
    setPrepared(null);
    setError('');
  }, [s.room.id, s.self?.id, s.self?.role]);
  const run = async (m: Macro, inputs: Record<string, string>) => {
    if (busy) return;
    const definition = parseMacro(m.source);
    if (
      definition.variables.some(
        (name) =>
          !inputs[name]?.trim() ||
          !Number.isFinite(Number(inputs[name])) ||
          Math.abs(Number(inputs[name])) > 10000,
      )
    ) {
      setError('Enter each numeric input between −10,000 and 10,000.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await sendAndWait({
        type: 'MACRO_ROLL_REQUEST',
        id: m.id,
        variables: Object.fromEntries(
          definition.variables.map((name) => [name, Number(inputs[name])]),
        ),
        visibility: privateRoll || m.visibility === 'private' ? 'private' : 'public',
      });
      remember((p) => ({
        ...p,
        recent: [m.id, ...p.recent.filter((id) => id !== m.id)].slice(0, 20),
        inputs: { ...p.inputs, [m.id]: inputs },
      }));
      setPrepared(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const favorites = preferences.favorites.flatMap((id) => (macros[id] ? [macros[id]] : []));
  return (
    <div className="favorite-actions" aria-label="Favorite actions">
      <div className="favorite-strip">
        {favorites.map((m) => (
          <button
            key={m.id}
            disabled={busy || !['live', 'demo'].includes(s.status)}
            aria-label={`Roll ${m.name}`}
            title={
              m.visibility === 'private'
                ? 'Private result · you & GM'
                : privateRoll
                  ? 'Private result · you & GM'
                  : 'Party result'
            }
            onClick={() => {
              setError('');
              if (!parseMacro(m.source).variables.length) void run(m, {});
              else {
                setValues(preferences.inputs[m.id] || {});
                setPrepared(m);
              }
            }}
          >
            {m.visibility === 'private' ? '🔒 ' : '★ '}
            {m.name}
          </button>
        ))}
        {!favorites.length && (
          <span className="field-note">Pin named actions with ★ in Manage macros.</span>
        )}
      </div>
      {prepared && macro && prepared.source === macro.source && (
        <form
          className="favorite-prompt"
          aria-label={`Inputs for ${macro.name}`}
          onSubmit={(e) => {
            e.preventDefault();
            void run(macro, values);
          }}
        >
          <strong>{macro.name}</strong>
          {parseMacro(macro.source).variables.map((name) => (
            <label key={name}>
              {name}
              <input
                aria-label={`Action input ${name}`}
                type="number"
                step="any"
                min={-10000}
                max={10000}
                required
                disabled={busy}
                value={values[name] || ''}
                onChange={(e) => {
                  const next = { ...values, [name]: e.target.value };
                  setValues(next);
                  remember((p) => ({ ...p, inputs: { ...p.inputs, [macro.id]: next } }));
                }}
              />
            </label>
          ))}
          <small>
            {privateRoll || macro.visibility === 'private' ? 'Private · you & GM' : 'Party result'}
          </small>
          <button disabled={busy}>{busy ? 'Rolling…' : 'Roll action'}</button>
          <button type="button" disabled={busy} onClick={() => setPrepared(null)}>
            Cancel
          </button>
        </form>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
