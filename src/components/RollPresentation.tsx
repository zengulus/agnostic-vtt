import { useEffect, useRef, useState } from 'react';
import { FastForward, X } from 'lucide-react';
import { useTable } from '../store.js';
import { physicalDice, predeterminedNotation } from '../../shared/dice.js';
import type DiceBox from '@3d-dice/dice-box-threejs';
import { playTone } from '../sound.js';
import type { Roll } from '../../shared/model.js';
export function RollPresentation({ roll }: { roll: Roll }) {
  const { reducedMotion: reduce, sound, dice, finishRoll } = useTable();
  const reducedMotion = reduce || dice.presentation === 'minimal';
  const [phase, setPhase] = useState<'rolling' | 'terms' | 'total'>(
      reducedMotion ? 'total' : 'rolling',
    ),
    [fallback, setFallback] = useState(false);
  const box = useRef<DiceBox | null>(null),
    container = useRef<HTMLDivElement>(null);
  const stageId = `dice-${roll.id}`;
  useEffect(() => {
    let cancelled = false,
      timer: ReturnType<typeof setTimeout> | undefined,
      deadline: ReturnType<typeof setTimeout> | undefined,
      observer: ResizeObserver | undefined;
    const complete = () => {
      if (cancelled) return;
      clearTimeout(deadline);
      setPhase('terms');
      timer = setTimeout(() => setPhase('total'), 1000 / dice.speed);
    };
    if (reducedMotion) return;
    void (async () => {
      try {
        const { createDiceEngine } = await import('../diceEngine.js');
        if (cancelled) return;
        const engine = createDiceEngine(
          `#${stageId}`,
          {
            baseScale: 75,
            framerate: 1 / 60,
            strength: dice.intensity,
            iterationLimit: 500,
            shadows: dice.performance !== 'low',
            sounds: false,
            theme_material: dice.material === 'gemstone' ? 'glass' : dice.material,
            theme_customColorset: {
              name: 'aether',
              foreground: dice.ink,
              background: dice.color,
              outline: '#152019',
              edge: dice.presentation === 'moon' ? '#a9c8d0' : '#cfa85c',
              texture: 'none',
              material: dice.material === 'gemstone' ? 'glass' : dice.material,
            },
          },
          dice,
          sound,
        );
        box.current = engine;
        await engine.initialize();
        if (cancelled) return;
        observer = new ResizeObserver(() => {
          if (container.current)
            engine.setDimensions({
              x: container.current.clientWidth,
              y: container.current.clientHeight,
            });
        });
        observer.observe(container.current!);
        const result = await engine.roll(predeterminedNotation(roll.terms));
        if (cancelled) return;
        const expected = physicalDice(roll.terms).map((d) => d.value),
          actual = result.sets.flatMap((s) => s.rolls.map((r) => r.value));
        if (expected.some((n, i) => actual[i] !== n)) {
          setFallback(true);
          console.warn('Dice renderer mismatch; displaying authoritative values.');
        }
        if (sound) playTone(dice.volume);
        complete();
      } catch {
        if (!cancelled) {
          setFallback(true);
          complete();
        }
      }
    })();
    deadline = setTimeout(() => {
      if (!cancelled) {
        setPhase('total');
        setFallback(true);
        if (box.current) {
          box.current.running = false;
        }
      }
    }, 18000 / dice.speed);
    return () => {
      cancelled = true;
      clearTimeout(deadline);
      if (timer) clearTimeout(timer);
      observer?.disconnect();
      const engine = box.current;
      if (engine) {
        engine.running = false;
        for (const die of engine.diceList) {
          die.geometry.dispose();
          for (const material of die.material) {
            material.map?.dispose();
            material.dispose();
          }
        }
        engine.renderer?.dispose();
        engine.renderer?.forceContextLoss();
      }
      box.current = null;
    };
  }, [roll.id, reducedMotion, dice, sound, stageId, roll.terms]);
  useEffect(() => {
    if (phase === 'total') {
      const timer = setTimeout(finishRoll, reducedMotion ? 2800 : 4200 / dice.speed);
      return () => clearTimeout(timer);
    }
  }, [phase, finishRoll, reducedMotion, dice.speed]);
  const contributions = roll.terms.flatMap((t) =>
    t.kind === 'dice'
      ? t.values.map((v) => ({ value: v * t.sign, label: `d${t.sides}` }))
      : [{ value: t.subtotal, label: 'modifier' }],
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
          <span className="eyebrow">
            {roll.visibility === 'private' ? 'PRIVATE · YOU & GM' : 'THE DICE HAVE SPOKEN'}
          </span>
          <strong>
            {roll.userName} rolls {roll.expression}
          </strong>
        </span>
        <div>
          <button
            aria-label="Skip dice animation"
            onClick={() => {
              if (box.current) box.current.running = false;
              setPhase('total');
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
      {phase !== 'rolling' && (
        <div className="arithmetic">
          <div className="arith-terms">
            {contributions.map((c, i) => (
              <div
                className={`arith-term ${c.value < 0 ? 'negative' : ''}`}
                key={i}
                style={{ animationDelay: `${i * 0.09}s` }}
              >
                <span>
                  {i > 0 && c.value >= 0 ? '+' : ''}
                  {c.value}
                </span>
                <small>{c.label}</small>
              </div>
            ))}
            <span className="arith-arrow">→</span>
          </div>
          {phase === 'total' && dice.particles && !reducedMotion && dice.performance !== 'low' && (
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
      )}
      <div className="roll-caption">
        {phase === 'rolling'
          ? 'A little uncertainty. A world of possibility.'
          : fallback
            ? 'Authoritative result · 3D rendering unavailable'
            : 'Server-authoritative result'}
        {phase === 'total' && (
          <button onClick={finishRoll}>
            Return to the story <span>↗</span>
          </button>
        )}
      </div>
    </div>
  );
}
