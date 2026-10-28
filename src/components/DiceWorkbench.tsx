import { useMemo, useRef, useState } from 'react';
import {
  ChevronDown,
  Feather,
  HelpCircle,
  Lock,
  Settings2,
  Star,
  Users,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { useTable } from '../store.js';
import { sendAndWait } from '../connection.js';
import { parseDice } from '../../shared/dice.js';
import { FavoriteActions } from './FavoriteActions.js';
import { unlockSound } from '../sound.js';

export function DiceWorkbench() {
  const s = useTable();
  const [expression, setExpression] = useState('1d20 + 5 - 2');
  const [privateRoll, setPrivate] = useState(false);
  const [pending, setPending] = useState(false);
  const submitting = useRef(false);
  const [presets, setPresets] = useState<string[]>(() => {
    const defaults = ['1d20 + 5', '2d6', '1d100'];
    try {
      const stored: unknown = JSON.parse(localStorage.getItem('aether-presets') || 'null');
      if (!Array.isArray(stored)) return defaults;
      return [
        ...new Set(
          stored.filter((value): value is string => {
            if (typeof value !== 'string' || value.length > 120) return false;
            try {
              parseDice(value);
              return true;
            } catch {
              return false;
            }
          }),
        ),
      ].slice(-6);
    } catch {
      return defaults;
    }
  });
  const validation = useMemo(() => {
    try {
      return { terms: parseDice(expression), error: '' };
    } catch (error) {
      return { terms: [], error: (error as Error).message };
    }
  }, [expression]);
  const roll = async () => {
    if (!s.self) {
      s.set({ dialog: 'launch' });
      return;
    }
    if (validation.error || submitting.current) return;
    submitting.current = true;
    setPending(true);
    try {
      await sendAndWait({
        type: 'DICE_ROLL_REQUEST',
        expression,
        visibility: privateRoll ? 'private' : 'public',
      });
    } catch (error) {
      const current = useTable.getState();
      if (
        current.room.id === s.room.id &&
        current.self?.id === s.self.id &&
        current.self?.role === s.self.role &&
        current.sessionNonce === s.sessionNonce
      )
        current.set({ error: (error as Error).message });
    } finally {
      submitting.current = false;
      setPending(false);
    }
  };
  return (
    <div className="dice-workbench">
      <FavoriteActions privateRoll={privateRoll} />
      <div className="macro-tools">
        <button aria-label="Macros · import .txt" onClick={() => s.set({ dialog: 'macros' })}>
          <Feather size={13} />
          Manage macros
        </button>
        {s.discord.canManage && (
          <button onClick={() => s.set({ dialog: 'discord' })}>Discord webhook ↗</button>
        )}
      </div>
      <div className="section-heading">
        <h2>Dice</h2>
        <button
          title="Dice presentation settings"
          aria-label="Dice presentation settings"
          onClick={() => s.set({ dialog: 'settings' })}
        >
          <Settings2 size={15} /> Presentation
        </button>
      </div>
      <details className="quick-dice-preferences">
        <summary>Dice preferences</summary>
        <label>
          Presentation
          <select
            aria-label="Presentation"
            value={s.dice.presentation}
            onChange={(e) =>
              s.set({
                dice: { ...s.dice, presentation: e.target.value as typeof s.dice.presentation },
              })
            }
          >
            <option value="arcane">Arcane gold</option>
            <option value="moon">Moonlit silver</option>
            <option value="ember">Ember</option>
            <option value="minimal">Minimal · instant</option>
          </select>
        </label>
        <label className="check-label">
          <input
            type="checkbox"
            checked={s.reducedMotion}
            onChange={(e) => s.set({ reducedMotion: e.target.checked })}
          />
          Reduced motion
        </label>
        <button onClick={() => s.set({ dialog: 'settings' })}>All dice preferences</button>
      </details>
      <div className="dice-types">
        {[4, 6, 8, 10, 12, 20, 100].map((n) => (
          <button
            key={n}
            aria-label={`Select d${n}`}
            aria-pressed={validation.terms[0]?.kind === 'dice' && validation.terms[0].sides === n}
            className={
              validation.terms[0]?.kind === 'dice' && validation.terms[0].sides === n
                ? 'selected'
                : ''
            }
            onClick={() => setExpression(`1d${n}`)}
          >
            <span className={`die-icon die-${n}`}>{n === 100 ? '%' : n}</span>
            <small>d{n === 100 ? '%' : n}</small>
          </button>
        ))}
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void roll();
        }}
      >
        <label className="expression-label" htmlFor="dice-expression">
          <span className="sr-only">Dice expression</span>
          <button
            type="button"
            title="Save this roll preset"
            aria-label="Save roll preset"
            onClick={() => {
              try {
                parseDice(expression);
                const next = [...new Set([...presets, expression])].slice(-6);
                setPresets(next);
                try {
                  localStorage.setItem('aether-presets', JSON.stringify(next));
                  s.set({ error: 'Roll preset saved.' });
                } catch {
                  s.set({ error: 'Preset saved for this visit. Browser storage is unavailable.' });
                }
              } catch (e) {
                s.set({ error: (e as Error).message });
              }
            }}
          >
            <Star size={14} /> Save preset
          </button>
        </label>
        <div className="expression-input">
          <input
            id="dice-expression"
            aria-label="Dice expression"
            value={expression}
            onChange={(e) => setExpression(e.target.value)}
            maxLength={120}
            autoComplete="off"
            spellCheck={false}
            aria-invalid={!!validation.error}
            aria-describedby={validation.error ? 'dice-expression-error' : undefined}
          />
          <button
            type="button"
            aria-label="Expression help"
            onClick={() => s.set({ dialog: 'help' })}
          >
            <HelpCircle size={14} />
          </button>
        </div>
        {validation.error && (
          <p className="expression-error" id="dice-expression-error" aria-live="polite">
            {validation.error}
          </p>
        )}
        <div className="roll-options">
          <button
            type="button"
            className={privateRoll ? 'enabled' : ''}
            aria-pressed={privateRoll}
            onClick={() => setPrivate(!privateRoll)}
          >
            {privateRoll ? <Lock size={12} /> : <Users size={12} />}{' '}
            {privateRoll ? 'Private' : 'Party'}
            <ChevronDown size={12} />
          </button>
          <button
            type="button"
            title={s.sound ? 'Mute roll sound' : 'Enable roll sound'}
            aria-label={s.sound ? 'Mute roll sound' : 'Enable roll sound'}
            aria-pressed={s.sound}
            onClick={() => {
              unlockSound();
              s.set({ sound: !s.sound });
            }}
          >
            {s.sound ? <Volume2 size={14} /> : <VolumeX size={14} />}
          </button>
        </div>
        <button
          aria-label="Roll the dice"
          className="roll-button"
          aria-busy={pending}
          disabled={
            pending ||
            !!validation.error ||
            s.status === 'reconnecting' ||
            s.status === 'connecting'
          }
        >
          {pending ? 'Rolling…' : 'Roll'}
        </button>
      </form>
      <div className="presets">
        <div>
          {presets.map((p) => (
            <button key={p} title={`Use ${p}`} onClick={() => setExpression(p)}>
              {p}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
