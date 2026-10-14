import { useMemo, useState } from 'react';
import { Lock, Play, Trash2, Upload } from 'lucide-react';
import { useTable } from '../store.js';
import { sendAndWait } from '../connection.js';
import {
  formatMacroGroup,
  importMacros,
  parseMacro,
  type MacroResult,
} from '../../shared/macros.js';
import { macroTextParts } from '../../shared/macroFormatting.js';
import { formatRollBreakdown } from '../../shared/dice.js';

export function MacroResults({
  result,
  details = false,
  reveal = true,
}: {
  result: MacroResult;
  details?: boolean;
  reveal?: boolean;
}) {
  return (
    <dl className={`macro-results ${details ? 'expanded' : ''}`}>
      {result.groups.map((group, index) => (
        <div key={index}>
          <dt>{group.name}:</dt>
          <dd>
            {!reveal ? (
              '…'
            ) : group.selections ? (
              <ul className="macro-table-selections">
                {group.selections.map((entry, i) => (
                  <li key={i}>
                    {macroTextParts(entry).map((part, j) =>
                      part.kind === 'bold' ? (
                        <strong key={j}>{part.text}</strong>
                      ) : part.kind === 'italic' ? (
                        <em key={j}>{part.text}</em>
                      ) : part.kind === 'code' ? (
                        <code key={j}>{part.text}</code>
                      ) : (
                        part.text
                      ),
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              formatMacroGroup(group)
            )}
          </dd>
          {(details || group.terms.some((t) => t.kept || t.rerolls)) && group.terms.length > 0 && (
            <small className="macro-result-terms">{formatRollBreakdown(group.terms)}</small>
          )}
        </div>
      ))}
    </dl>
  );
}

export function MacroLibraryDialog() {
  const s = useTable(),
    macros = Object.values(s.room.macros || {});
  const [text, setText] = useState(''),
    [visibility, setVisibility] = useState<'public' | 'private'>('public'),
    [selected, setSelected] = useState(''),
    [values, setValues] = useState<Record<string, string>>({}),
    [privateRoll, setPrivateRoll] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const preview = useMemo(() => {
    if (!text.trim()) return null;
    try {
      return importMacros(text);
    } catch (error) {
      return { macros: [], errors: [{ line: 1, message: (error as Error).message }] };
    }
  }, [text]);
  const macro = macros.find((m) => m.id === selected),
    definition = macro ? parseMacro(macro.source) : null;
  const inputValue = (name: string) => (Object.hasOwn(values, name) ? values[name] : '');
  const act = async (action: Parameters<typeof sendAndWait>[0], success?: () => void) => {
    setBusy(true);
    setError('');
    try {
      await sendAndWait(action);
      success?.();
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="macro-library">
      <div className="macro-list">
        {!macros.length && <p className="muted">No saved macros yet.</p>}
        {macros.map((m) => (
          <div className={`macro-library-row ${selected === m.id ? 'selected' : ''}`} key={m.id}>
            <button
              aria-label={`Prepare ${m.name}`}
              onClick={() => {
                setSelected(m.id);
                setValues({});
                setPrivateRoll(m.visibility === 'private');
                setError('');
              }}
            >
              <Play size={14} />
              <span>
                {m.name}
                <small>
                  {m.visibility === 'private' ? 'Private · author & GM' : 'Shared with the party'}
                </small>
              </span>
              {m.visibility === 'private' && <Lock size={13} />}
            </button>
            {(m.ownerId === s.self?.id || s.self?.role === 'gm') && (
              <button
                aria-label={`Delete macro ${m.name}`}
                disabled={busy || (s.status !== 'live' && s.status !== 'demo')}
                onClick={() => void act({ type: 'MACRO_DELETE', id: m.id })}
              >
                <Trash2 size={14} />
              </button>
            )}
          </div>
        ))}
      </div>
      {macro && definition && (
        <form
          className="macro-run"
          onSubmit={(e) => {
            e.preventDefault();
            const variables = Object.fromEntries(
              definition.variables.map((name) => [name, Number(inputValue(name))]),
            );
            if (
              definition.variables.some(
                (name) =>
                  !inputValue(name).trim() ||
                  !Number.isFinite(variables[name]) ||
                  Math.abs(variables[name]) > 10000,
              )
            ) {
              setError('Enter each numeric input between −10,000 and 10,000.');
              return;
            }
            void act(
              {
                type: 'MACRO_ROLL_REQUEST',
                id: macro.id,
                variables,
                visibility: privateRoll ? 'private' : 'public',
              },
              () => s.set({ dialog: null }),
            );
          }}
        >
          <h3>{macro.name}</h3>
          <p className="muted">{definition.groups.map((g) => g.name).join(' · ')}</p>
          <div className="macro-inputs">
            {definition.variables.map((name) => (
              <label key={name}>
                {name}
                <input
                  aria-label={`Numeric input ${name}`}
                  type="number"
                  step="any"
                  min="-10000"
                  max="10000"
                  required
                  value={inputValue(name)}
                  onChange={(e) => setValues({ ...values, [name]: e.target.value })}
                />
              </label>
            ))}
          </div>
          <label className="check-label">
            <input
              type="checkbox"
              checked={privateRoll}
              onChange={(e) => setPrivateRoll(e.target.checked)}
            />
            Private result · you & GM
          </label>
          <button
            className="primary-button"
            disabled={busy || (s.status !== 'live' && s.status !== 'demo')}
          >
            <Play size={15} />
            {busy ? 'Rolling…' : 'Roll macro'}
          </button>
        </form>
      )}
      <div className="macro-import">
        <h3>Import macro.txt</h3>
        <p className="muted">
          One macro per line. Use any roll names and labels; numeric inputs such as X are filled in
          when you roll. Select(3)&#123;A,B,C,D&#125; picks three table entries without replacement.
          Entries support **bold**, *italic* and `code`; quote entries containing commas.
        </p>
        <label className="file-import">
          <span>
            <Upload size={15} /> Choose a .txt file
          </span>
          <input
            aria-label="Import macro.txt"
            type="file"
            accept=".txt,text/plain"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (!file) return;
              try {
                if (file.size > 65536) throw new Error('Import text files up to 64 KiB.');
                setText(await file.text());
                setError('');
              } catch (error) {
                setError((error as Error).message);
              }
            }}
          />
        </label>
        <label>
          Macro definitions
          <textarea
            aria-label="Macro definitions"
            rows={5}
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setError('');
            }}
            spellCheck={false}
            placeholder={String.raw`[Attack Name]\([Attack Roll(1d20 + X)],[Damage Roll(1d6 + [Fire(1d6)] + [Akashic(12)])])`}
          />
        </label>
        <a
          className="macro-example"
          href={`${import.meta.env.BASE_URL}examples/macro.txt`}
          download="macro.txt"
        >
          Download example macro.txt ↗
        </a>
        {preview && (
          <div className="macro-preview" aria-live="polite">
            {preview.errors.map((error, i) => (
              <p className="form-error" key={i}>
                Line {error.line}: {error.message}
              </p>
            ))}
            {preview.macros.map((m) => (
              <div key={m.line}>
                <strong>{m.name}</strong>
                <small>
                  Line {m.line} · {m.groups.map((g) => g.name).join(' · ')}
                  {m.variables.length ? ` · Inputs: ${m.variables.join(', ')}` : ''}
                </small>
                {m.repaired && (
                  <>
                    <p className="macro-repair">
                      Final closing delimiters added. Review the completed definition:
                    </p>
                    <code>{m.source}</code>
                  </>
                )}
              </div>
            ))}
          </div>
        )}
        <label>
          Imported macro visibility
          <select
            value={visibility}
            onChange={(e) => setVisibility(e.target.value as typeof visibility)}
          >
            <option value="public">Shared with the party</option>
            <option value="private">Private · author & GM</option>
          </select>
        </label>
        <button
          className="primary-button"
          disabled={
            busy ||
            (s.status !== 'live' && s.status !== 'demo') ||
            !preview?.macros.length ||
            !!preview.errors.length
          }
          onClick={() => void act({ type: 'MACRO_IMPORT', text, visibility }, () => setText(''))}
        >
          {busy
            ? 'Saving…'
            : `Import ${preview?.macros.length || 0} macro${preview?.macros.length === 1 ? '' : 's'}`}
        </button>
      </div>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {s.status !== 'live' && s.status !== 'demo' && (
        <p className="muted">Open a live campaign to save and roll macros.</p>
      )}
    </div>
  );
}
