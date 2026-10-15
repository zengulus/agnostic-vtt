import { useEffect, useMemo, useState } from 'react';
import { BookOpen, Download, Plus, RefreshCw, Upload } from 'lucide-react';
import { useTable } from '../store.js';
import { sendAndWait } from '../connection.js';
import type { Action } from '../../shared/protocol.js';
import type { Roll } from '../../shared/model.js';
import {
  characterControlled,
  characterDigest,
  exportCharacter,
  parseCharacter,
  refreshNames,
  unavailableAbility,
  type CharacterAbility,
  type CharacterSheet,
} from '../../shared/characters.js';
import { parseMacro } from '../../shared/macros.js';
import { MacroResults } from './Macros.js';
import { DiscordShare } from './DiscordSettings.js';

export function openCharacter(id: string | null = null) {
  useTable.getState().set({ characterId: id, panel: 'character', activityOpen: true });
}
export function importCharacter(id: string | null = null) {
  useTable.getState().set({ characterEditId: id, dialog: 'character-import' });
}
export function CharacterNavigation() {
  const s = useTable();
  if (!s.self) return null;
  const sheets = Object.values(s.room.characters || {}).sort(
    (a, b) =>
      Number(b.ownerId === s.self?.id) - Number(a.ownerId === s.self?.id) ||
      a.name.localeCompare(b.name),
  );
  return (
    <section className="character-navigation" aria-label="Campaign characters">
      <div className="section-heading">
        <h2>Characters</h2>
        <button
          aria-label="Import character"
          title="Import character from text"
          onClick={() => importCharacter()}
        >
          <Plus size={18} />
        </button>
      </div>
      {sheets.length ? (
        <div className="sheet-links">
          {sheets.map((sheet) => (
            <button
              key={sheet.id}
              aria-label={`Open ${sheet.name} sheet`}
              className={s.panel === 'character' && s.characterId === sheet.id ? 'active' : ''}
              onClick={() => openCharacter(sheet.id)}
            >
              <BookOpen size={18} />
              <span>
                <strong>{sheet.name}</strong>
                <small>
                  {sheet.ownerId === s.self?.id
                    ? 'Your character'
                    : sheet.visibility === 'private'
                      ? 'Private'
                      : 'Party character'}{' '}
                  · {sheet.abilities.filter((a) => !unavailableAbility(sheet, a)).length} ready
                </small>
              </span>
            </button>
          ))}
        </div>
      ) : (
        <button className="sheet-empty-link" onClick={() => importCharacter()}>
          <Upload size={18} />
          <span>
            Import a character<small>Resources, spells & maneuvers</small>
          </span>
        </button>
      )}
    </section>
  );
}
export function CharacterActionDetails({
  roll,
  compact = false,
}: {
  roll: Roll;
  compact?: boolean;
}) {
  if (!roll.character) return null;
  const c = roll.character;
  return (
    <div className="character-action-details">
      <strong>{c.name}</strong>
      {!compact && c.text && !roll.macro?.groups.some((g) => g.selections?.includes(c.text)) && (
        <p>{c.text}</p>
      )}
      <small>
        {c.remainingUses === null ? 'At will' : `${c.remainingUses} / ${c.maxUses} uses remaining`}
        {c.resources
          .map((r) => ` · ${r.name}: ${r.current} / ${r.max} (spent ${r.spent})`)
          .join('')}
      </small>
    </div>
  );
}
function ResourceControl({
  sheet,
  resource,
  busy,
  act,
  controlled,
}: {
  sheet: CharacterSheet;
  resource: CharacterSheet['resources'][number];
  busy: boolean;
  act: (action: Action) => Promise<boolean>;
  controlled: boolean;
}) {
  const [amount, setAmount] = useState('1');
  const value = Number(amount),
    valid = Number.isInteger(value) && value > 0 && value <= 10000;
  return (
    <div className="sheet-resource">
      <div>
        <strong>{resource.name}</strong>
        <span aria-live="polite">
          {resource.current} / {resource.max}
        </span>
      </div>
      <progress
        aria-label={`${resource.name} remaining`}
        value={resource.current}
        max={resource.max}
      />
      {controlled && (
        <details className="sheet-resource-adjust">
          <summary aria-label={`Adjust ${resource.name}`}>
            Adjust · {refreshNames[resource.refresh]}
          </summary>
          <div className="sheet-resource-actions">
            <input
              aria-label={`${resource.name} adjustment`}
              type="number"
              min={1}
              max={10000}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
            <button
              disabled={busy || !valid || !resource.current}
              onClick={() =>
                void act({
                  type: 'CHARACTER_RESOURCE_ADJUST',
                  id: sheet.id,
                  resourceId: resource.id,
                  delta: -value,
                })
              }
            >
              − Spend
            </button>
            <button
              disabled={busy || !valid || resource.current === resource.max}
              onClick={() =>
                void act({
                  type: 'CHARACTER_RESOURCE_ADJUST',
                  id: sheet.id,
                  resourceId: resource.id,
                  delta: value,
                })
              }
            >
              + Restore
            </button>
          </div>
        </details>
      )}
      {!controlled && <small>Refresh: {refreshNames[resource.refresh]}</small>}
    </div>
  );
}
export function CharacterWorkspace() {
  const s = useTable(),
    sheets = Object.values(s.room.characters || {}).sort(
      (a, b) =>
        Number(b.ownerId === s.self?.id) - Number(a.ownerId === s.self?.id) ||
        a.name.localeCompare(b.name),
    );
  const sheet = sheets.find((c) => c.id === s.characterId) || sheets[0];
  const controlled = !!sheet && !!s.self && characterControlled(sheet, s.self.id, s.self.role);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [filter, setFilter] = useState(''),
    [availability, setAvailability] = useState('all'),
    [prepared, setPrepared] = useState<CharacterAbility | null>(null),
    [inputs, setInputs] = useState<Record<string, string>>({}),
    [privateResult, setPrivateResult] = useState(true);
  const [deleting, setDeleting] = useState(false);
  useEffect(() => {
    setPrepared(null);
    setInputs({});
    setError('');
    setFilter('');
    setDeleting(false);
    setPrivateResult(sheet?.visibility === 'private');
  }, [sheet?.id, sheet?.visibility, s.room.id, s.self?.id, s.self?.role]);
  useEffect(() => {
    if (prepared && sheet?.abilities.find((a) => a.id === prepared.id) !== prepared)
      setPrepared(null);
  }, [sheet, prepared]);
  const connected = s.status === 'live' || s.status === 'demo';
  const act = async (action: Action) => {
    if (busy) return false;
    setBusy(true);
    setError('');
    try {
      await sendAndWait(action);
      return true;
    } catch (error) {
      setError((error as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  };
  const useAbility = async (ability: CharacterAbility, values: Record<string, number> = {}) => {
    if (!sheet) return;
    const definition = ability.macro ? parseMacro(ability.macro) : null;
    const missing = definition?.variables.filter((name) => !Object.hasOwn(sheet.stats, name)) || [];
    if (missing.length && !Object.keys(values).length) {
      setPrepared(ability);
      setInputs(Object.fromEntries(missing.map((name) => [name, '0'])));
      return;
    }
    if (
      await act({
        type: 'CHARACTER_ABILITY_USE',
        id: sheet.id,
        abilityId: ability.id,
        variables: values,
        visibility: privateResult ? 'private' : 'public',
      })
    )
      setPrepared(null);
  };
  const latest = [...s.room.rolls].reverse().find((r) => r.character?.characterId === sheet?.id);
  if (!sheet)
    return (
      <div className="sheet-empty">
        <BookOpen size={36} strokeWidth={1.3} />
        <h2>Your character, ready to play</h2>
        <p>
          Keep your stats, resources, prepared spells and maneuvers together. Use an ability to run
          its macro and spend its uses.
        </p>
        <button className="primary-button" disabled={!s.self} onClick={() => importCharacter()}>
          <Upload size={18} />
          Import character text
        </button>
        <p className="field-note">Sheets stay with the campaign when the scene changes.</p>
      </div>
    );
  const abilities = sheet.abilities.filter(
    (a) =>
      `${a.name} ${a.group} ${a.text}`.toLowerCase().includes(filter.toLowerCase()) &&
      (availability === 'all' ||
        (availability === 'ready'
          ? !unavailableAbility(sheet, a)
          : !!unavailableAbility(sheet, a))),
  );
  const groups = [...new Set(abilities.map((a) => a.group))];
  const variables = prepared?.macro
    ? parseMacro(prepared.macro).variables.filter((name) => !Object.hasOwn(sheet.stats, name))
    : [];
  const owners = [...new Map([...s.members, ...s.presence].map((p) => [p.id, p])).values()];
  return (
    <div className="character-workspace" aria-label="Character sheet">
      <div className="sheet-picker">
        <label>
          Character
          <select
            aria-label="Active character sheet"
            value={sheet.id}
            onChange={(e) => s.set({ characterId: e.target.value })}
          >
            {sheets.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <button
          aria-label="Import another character"
          title="Import another character"
          onClick={() => importCharacter()}
        >
          <Plus size={20} />
        </button>
      </div>
      <div className="sheet-heading">
        <div>
          <h2>{sheet.name}</h2>
          <small>
            {controlled
              ? 'You can use and manage this character'
              : 'View only · controlled by its owner'}{' '}
            · {sheet.visibility === 'private' ? 'Private sheet' : 'Party sheet'}
          </small>
        </div>
      </div>
      {(sheet.description || Object.keys(sheet.stats).length > 0) && (
        <details className="sheet-overview">
          <summary>Stats & character notes</summary>
          {sheet.description && <p className="sheet-description">{sheet.description}</p>}
          {Object.keys(sheet.stats).length > 0 && (
            <dl className="sheet-stats">
              {Object.entries(sheet.stats).map(([key, value]) => (
                <div key={key}>
                  <dt>{key}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
          )}
        </details>
      )}
      {sheet.resources.length > 0 && (
        <section aria-label="Character resources">
          <h3>Resources</h3>
          <div className="sheet-resources">
            {sheet.resources.map((r) => (
              <ResourceControl
                key={sheet.id + r.id}
                sheet={sheet}
                resource={r}
                controlled={controlled}
                busy={busy || !connected}
                act={act}
              />
            ))}
          </div>
        </section>
      )}
      {controlled && (
        <div className="sheet-recovery" aria-label="Refresh character resources">
          {(['recovery', 'encounter', 'rest'] as const)
            .filter(
              (kind) =>
                sheet.resources.some((r) => r.refresh === kind) ||
                sheet.abilities.some((a) => a.refresh === kind && a.maxUses),
            )
            .map((kind) => (
              <button
                key={kind}
                disabled={busy || !connected}
                title={`Restore only resources and abilities marked ${refreshNames[kind]}`}
                onClick={() => void act({ type: 'CHARACTER_REFRESH', id: sheet.id, refresh: kind })}
              >
                <RefreshCw size={15} />
                {kind === 'recovery' ? 'Recover' : kind === 'encounter' ? 'Encounter' : 'Rest'}
              </button>
            ))}
          <small>Each button restores only its matching refresh group.</small>
        </div>
      )}
      <section className="sheet-abilities" aria-label="Character abilities">
        <h3>Actions & abilities</h3>
        <div className="sheet-filters">
          <input
            aria-label="Find character ability"
            placeholder="Find an ability…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
          <select
            aria-label="Ability availability"
            value={availability}
            onChange={(e) => setAvailability(e.target.value)}
          >
            <option value="all">All</option>
            <option value="ready">Ready</option>
            <option value="expended">Unavailable</option>
          </select>
        </div>
        {controlled && (
          <label className="sheet-visibility">
            Result visibility
            <select
              aria-label="Character result visibility"
              value={privateResult ? 'private' : 'public'}
              onChange={(e) => setPrivateResult(e.target.value === 'private')}
            >
              <option value="public">
                {s.discord.enabled && s.discord.mode === 'automatic' ? 'Party + Discord' : 'Party'}
              </option>
              <option value="private">Private · you & GM</option>
            </select>
          </label>
        )}
        {!abilities.length && (
          <p className="field-note">
            {sheet.abilities.length
              ? 'No abilities match this filter.'
              : 'Add abilities in Edit character text.'}
          </p>
        )}
        {groups.map((group) => (
          <div className="sheet-ability-group" key={group}>
            <h4>{group}</h4>
            {abilities
              .filter((a) => a.group === group)
              .map((ability) => {
                const unavailable = unavailableAbility(sheet, ability);
                return (
                  <article
                    key={ability.id}
                    className={`sheet-ability ${unavailable ? 'unavailable' : ''}`}
                  >
                    <div className="ability-heading">
                      <strong>{ability.name}</strong>
                      <span className={`ability-availability ${unavailable ? 'spent' : 'ready'}`}>
                        {unavailable || 'Ready'}
                        {ability.maxUses
                          ? ` · ${ability.remainingUses}/${ability.maxUses}`
                          : ' · at will'}
                      </span>
                    </div>
                    {ability.text && <p>{ability.text}</p>}
                    <small>
                      {ability.costs
                        .map(
                          (c) =>
                            `${c.amount} ${sheet.resources.find((r) => r.id === c.resourceId)?.name}`,
                        )
                        .join(' + ') || 'No resource cost'}
                      {ability.maxUses ? ` · Refresh: ${refreshNames[ability.refresh]}` : ''}
                    </small>
                    {controlled && (
                      <div className="ability-actions">
                        <button
                          className="primary-button"
                          disabled={busy || !connected || !!unavailable}
                          aria-label={`Use ${ability.name}`}
                          onClick={() => void useAbility(ability)}
                        >
                          Use{ability.macro ? ' & roll' : ''}
                        </button>
                        <button
                          disabled={busy || !connected}
                          aria-label={`${ability.prepared ? 'Unprepare' : 'Prepare'} ${ability.name}`}
                          onClick={() =>
                            void act({
                              type: 'CHARACTER_ABILITY_STATE',
                              id: sheet.id,
                              abilityId: ability.id,
                              operation: ability.prepared ? 'unprepare' : 'prepare',
                            })
                          }
                        >
                          {ability.prepared ? 'Unprepare' : 'Prepare'}
                        </button>
                        {ability.maxUses > 0 && ability.remainingUses < ability.maxUses && (
                          <button
                            disabled={busy || !connected}
                            aria-label={`Recover ${ability.name}`}
                            onClick={() =>
                              void act({
                                type: 'CHARACTER_ABILITY_STATE',
                                id: sheet.id,
                                abilityId: ability.id,
                                operation: 'recover',
                              })
                            }
                          >
                            <RefreshCw size={14} />
                            Recover
                          </button>
                        )}
                      </div>
                    )}
                    {prepared?.id === ability.id && (
                      <form
                        className="sheet-inputs"
                        onSubmit={(e) => {
                          e.preventDefault();
                          void useAbility(
                            ability,
                            Object.fromEntries(
                              variables.map((name) => [name, Number(inputs[name])]),
                            ),
                          );
                        }}
                      >
                        <strong>Complete {ability.name}</strong>
                        {variables.map((name) => (
                          <label key={name}>
                            {name}
                            <input
                              aria-label={`Ability input ${name}`}
                              required
                              type="number"
                              step="any"
                              min={-10000}
                              max={10000}
                              value={inputs[name] || ''}
                              onChange={(e) => setInputs({ ...inputs, [name]: e.target.value })}
                            />
                          </label>
                        ))}
                        <button className="primary-button" disabled={busy || !connected}>
                          Use ability
                        </button>
                        <button type="button" onClick={() => setPrepared(null)}>
                          Cancel
                        </button>
                      </form>
                    )}
                    {latest?.character?.abilityId === ability.id && (
                      <div
                        className="sheet-last-action"
                        aria-label="Last character action"
                        role="status"
                      >
                        <h4>Latest result</h4>
                        <CharacterActionDetails roll={latest} compact />
                        {latest.macro && <MacroResults result={latest.macro} />}
                        <DiscordShare roll={latest} />
                      </div>
                    )}
                  </article>
                );
              })}
          </div>
        ))}
      </section>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {!connected && (
        <p className="connection-guidance">
          Reconnecting. Resource changes and abilities are unavailable until the table is connected.
        </p>
      )}
      <details className="sheet-management">
        <summary>Character settings & text</summary>
        <button onClick={() => downloadCharacter(sheet)}>
          <Download size={16} />
          Export current character.txt
        </button>
        {controlled && (
          <button onClick={() => importCharacter(sheet.id)}>Edit character text</button>
        )}
        {controlled &&
          (deleting ? (
            <div className="sheet-delete-confirm">
              <p>Remove {sheet.name} from this campaign? Past action results stay in history.</p>
              <button
                disabled={busy || !connected}
                onClick={async () => {
                  if (
                    await act({
                      type: 'CHARACTER_DELETE',
                      id: sheet.id,
                      digest: characterDigest(sheet),
                    })
                  )
                    s.set({ characterId: null });
                }}
              >
                Delete this character
              </button>
              <button onClick={() => setDeleting(false)}>Cancel</button>
            </div>
          ) : (
            <button disabled={busy || !connected} onClick={() => setDeleting(true)}>
              Delete character
            </button>
          ))}
        {s.self?.role === 'gm' && (
          <label>
            Controlled by
            <select
              aria-label="Character owner"
              disabled={busy || !connected}
              value={sheet.ownerId}
              onChange={(e) =>
                void act({ type: 'CHARACTER_ASSIGN', id: sheet.id, ownerId: e.target.value })
              }
            >
              {!owners.some((p) => p.id === sheet.ownerId) && (
                <option value={sheet.ownerId}>Previous owner</option>
              )}
              {owners.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
        )}
      </details>
    </div>
  );
}
function downloadCharacter(sheet: CharacterSheet) {
  const url = URL.createObjectURL(
    new Blob([exportCharacter(sheet)], { type: 'text/plain;charset=utf-8' }),
  );
  const link = document.createElement('a');
  link.href = url;
  link.download = `${sheet.name.replace(/[^a-zA-Z0-9_-]/g, '_')}-character.txt`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function CharacterImportDialog() {
  const s = useTable();
  const [context] = useState(() => ({ roomId: s.room.id, userId: s.self?.id, role: s.self?.role }));
  const [original] = useState(() =>
    s.characterEditId ? s.room.characters?.[s.characterEditId] : undefined,
  );
  const [text, setText] = useState(() => (original ? exportCharacter(original) : '')),
    [visibility, setVisibility] = useState<'public' | 'private'>(original?.visibility || 'private'),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const preview = useMemo(() => {
    if (!text.trim()) return null;
    try {
      return { sheet: parseCharacter(text), error: '' };
    } catch (error) {
      return { sheet: null, error: (error as Error).message };
    }
  }, [text]);
  const validContext = () => {
    const now = useTable.getState();
    return (
      now.room.id === context.roomId &&
      now.self?.id === context.userId &&
      now.self?.role === context.role &&
      now.dialog === 'character-import'
    );
  };
  const stale =
    original &&
    characterDigest(original) !==
      (s.room.characters?.[original.id] ? characterDigest(s.room.characters[original.id]) : '');
  return (
    <form
      className="character-import"
      onSubmit={async (e) => {
        e.preventDefault();
        if (busy || !preview?.sheet || !validContext()) return;
        setBusy(true);
        setError('');
        const id = original?.id || crypto.randomUUID();
        try {
          await sendAndWait({
            type: 'CHARACTER_IMPORT',
            id,
            text,
            visibility,
            digest: original ? characterDigest(original) : undefined,
          });
          if (validContext())
            s.set({ characterId: id, panel: 'character', activityOpen: true, dialog: null });
        } catch (error) {
          setError((error as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <p className="dialog-intro">
        Import a small character sheet with stats, resource pools and prepared abilities. Ability
        macros use the same syntax as your saved macros.
      </p>
      <div className="character-import-tools">
        <label className="file-import">
          <span>
            <Upload size={16} />
            Choose character.txt
          </span>
          <input
            aria-label="Import character file"
            type="file"
            accept=".txt,text/plain"
            disabled={busy}
            onChange={async (e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (!file) return;
              try {
                if (file.size > 65536) throw new Error('Import character files up to 64 KiB.');
                setText(await file.text());
                setError('');
              } catch (error) {
                setError((error as Error).message);
              }
            }}
          />
        </label>
        <button
          type="button"
          disabled={busy || !!text.trim()}
          onClick={async () => {
            try {
              const response = await fetch(`${import.meta.env.BASE_URL}examples/character.txt`);
              if (!response.ok) throw new Error('Example could not be loaded.');
              const example = await response.text();
              setText((current) => (current.trim() ? current : example));
            } catch (error) {
              setError((error as Error).message);
            }
          }}
        >
          Use example character
        </button>
        <a href={`${import.meta.env.BASE_URL}examples/character.txt`} download="character.txt">
          Download text template ↗
        </a>
      </div>
      <label>
        Character text
        <textarea
          aria-label="Character text"
          rows={13}
          spellCheck={false}
          value={text}
          disabled={busy}
          onChange={(e) => setText(e.target.value)}
        />
      </label>
      <details className="character-format">
        <summary>Text format guide</summary>
        <p>
          Use [character] for name and description, [stats] for numeric macro inputs, [resource id]
          for current, max and refresh, and [ability id] for name, group, text, uses, remaining,
          prepared, refresh, cost and macro.
        </p>
        <p>
          uses = unlimited makes an at-will action. cost = focus:1 spends a resource. Refresh can be
          manual, recovery, encounter or rest. A prepared spell with uses = 2 can be cast twice. Set
          prepared = false to keep an ability in the sheet without making it available.
        </p>
        <p>
          Use double-quoted values with <code>{'\\n'}</code> for multiline descriptions. Reimporting
          an existing sheet replaces its text and counters; export includes the current counters.
        </p>
      </details>
      {preview?.error && (
        <p className="form-error" role="alert">
          {preview.error}
        </p>
      )}
      {preview?.sheet && (
        <div className="character-import-preview" aria-live="polite">
          <strong>{preview.sheet.name}</strong>
          <p>
            {Object.keys(preview.sheet.stats).length} stats · {preview.sheet.resources.length}{' '}
            resource pools · {preview.sheet.abilities.length} abilities
          </p>
          <ul>
            {preview.sheet.abilities.map((a) => (
              <li key={a.id}>
                {a.name} · {a.maxUses ? `${a.remainingUses}/${a.maxUses} uses` : 'at will'} ·{' '}
                {refreshNames[a.refresh]}
                {a.macro ? ' · macro' : ''}
              </li>
            ))}
          </ul>
        </div>
      )}
      <label>
        Sheet visibility
        <select
          aria-label="Character sheet visibility"
          disabled={busy}
          value={visibility}
          onChange={(e) => setVisibility(e.target.value as typeof visibility)}
        >
          <option value="private">Private · owner & GM</option>
          <option value="public">Party can view · owner & GM can use</option>
        </select>
      </label>
      {stale && (
        <p className="form-error" role="alert">
          This character changed while this text was open. Close this dialog and reopen Edit
          character text to preserve the latest resources.
        </p>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <button
        className="primary-button"
        disabled={
          busy || !preview?.sheet || !!stale || (s.status !== 'live' && s.status !== 'demo')
        }
      >
        {busy ? 'Saving…' : original ? 'Replace character from text' : 'Import character'}
      </button>
    </form>
  );
}
