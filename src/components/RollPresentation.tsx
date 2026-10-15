import { useEffect, useRef, useState } from 'react';
import { FastForward, X } from 'lucide-react';
import { useTable } from '../store.js';
import { physicalDice } from '../../shared/dice.js';
import { startRollAnimation } from '../rollAnimation.js';
import type { Roll } from '../../shared/model.js';
import { MacroResults } from './Macros.js';
import { CharacterActionDetails } from './Characters.js';
export function RollPresentation({ roll }: { roll: Roll }) {
  const { reducedMotion: reduce, sound, dice, finishRoll } = useTable();
  const reducedMotion =
    reduce || dice.presentation === 'minimal' || !physicalDice(roll.terms).length;
  const [phase, setPhase] = useState<'rolling' | 'terms' | 'total'>(
      reducedMotion ? 'total' : 'rolling',
    ),
    [fallback, setFallback] = useState(false);
  const animation = useRef<ReturnType<typeof startRollAnimation> | null>(null),
    container = useRef<HTMLDivElement>(null);
  const stageId = `dice-${roll.id}`;
  useEffect(() => {
    if (reducedMotion) {
      setPhase('total');
      return;
    }
    setPhase('rolling');
    setFallback(false);
    const current = startRollAnimation({
      selector: `#${stageId}`,
      container: container.current!,
      roll,
      dice,
      sound,
      onPhase: setPhase,
      onFallback: () => setFallback(true),
    });
    animation.current = current;
    return () => {
      current.cancel();
      if (animation.current === current) animation.current = null;
    };
  }, [roll.id, reducedMotion, dice, sound, stageId, roll.terms]);
  useEffect(() => {
    if (phase === 'total') {
      const timer = setTimeout(
        finishRoll,
        roll.macro
          ? 7000 + roll.macro.groups.length * 1000
          : reducedMotion
            ? 2800
            : 4200 / dice.speed,
      );
      return () => clearTimeout(timer);
    }
  }, [phase, finishRoll, reducedMotion, dice.speed, roll.macro]);
  const contributions = roll.terms.flatMap((t) =>
    t.kind === 'dice'
      ? t.values.map((v, i) => ({
          value: v * t.sign,
          dropped: t.kept?.[i] === false,
          label: `${t.label}${t.kept?.[i] === false ? ' · dropped' : ''}${t.rerolls?.[i].length ? ` · ${t.rerolls[i].join(' → ')} → ${v} (rerolled)` : ''}`,
        }))
      : [{ value: t.subtotal, label: 'modifier', dropped: false }],
  );
  return (
    <div
      className={`roll-overlay phase-${phase} tray-${dice.tray} arithmetic-${dice.presentation} ${reducedMotion ? 'minimal' : ''}`}
      style={{ '--dice-ink': dice.ink } as React.CSSProperties}
      role="status"
      aria-live="polite"
    >
      <div className="roll-topline">
        <span>
          <span className="eyebrow">{roll.visibility === 'private' ? 'Private roll' : 'Dice'}</span>
          <strong>
            {roll.userName} rolls {roll.expression}
          </strong>
        </span>
        <div>
          <button
            aria-label="Skip dice animation"
            onClick={() => {
              animation.current?.skip();
            }}
          >
            <FastForward size={17} />
          </button>
          <button aria-label="Dismiss roll" onClick={finishRoll}>
            <X size={18} />
          </button>
        </div>
      </div>
      {!reducedMotion && <div id={stageId} className="physical-dice" ref={container} />}
      {phase !== 'rolling' &&
        (roll.macro ? (
          <div className="arithmetic macro-arithmetic">
            <CharacterActionDetails roll={roll} />
            <MacroResults result={roll.macro} details reveal={phase === 'total'} />
          </div>
        ) : (
          <div className="arithmetic">
            <div className="arith-terms">
              {contributions.map((c, i) => (
                <div
                  className={`arith-term ${c.value < 0 ? 'negative' : ''} ${c.dropped ? 'dropped' : ''}`}
                  key={i}
                  style={{ animationDelay: `${i * 0.09}s` }}
                >
                  <span>
                    {!c.dropped && i > 0 && c.value >= 0 ? '+' : ''}
                    {c.value}
                  </span>
                  <small>{c.label}</small>
                </div>
              ))}
              <span className="arith-arrow">→</span>
            </div>
            {phase === 'total' &&
              dice.particles &&
              !reducedMotion &&
              dice.performance !== 'low' && (
                <div className="roll-particles" aria-hidden="true">
                  {Array.from({ length: dice.performance === 'cinematic' ? 24 : 12 }, (_, i) => (
                    <span
                      key={i}
                      style={
                        {
                          '--angle': `${i * 137.5}deg`,
                          '--travel': `${70 + (i % 4) * 22}px`,
                          animationDelay: `${(i % 5) * 0.04}s`,
                        } as React.CSSProperties
                      }
                    >
                      ✦
                    </span>
                  ))}
                </div>
              )}
            {phase === 'total' && (
              <div className="arith-total" data-testid="roll-total">
                <span className="total-rune" aria-hidden="true">
                  ◇
                </span>
                <strong>{roll.total}</strong>
                <span className="eyebrow">TOTAL</span>
              </div>
            )}
          </div>
        ))}
      <div className="roll-caption">
        {fallback && <span>Shown without animation.</span>}
        {phase === 'total' && <button onClick={finishRoll}>Continue</button>}
      </div>
    </div>
  );
}
