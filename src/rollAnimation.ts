import type DiceBox from '@3d-dice/dice-box-threejs';
import type { DicePreferences } from '../shared/diceThemes.js';
import type { Roll } from '../shared/model.js';
import { physicalDice, predeterminedNotation } from '../shared/dice.js';
import { playTone } from './sound.js';

/** Own one presentation's asynchronous renderer, timers and cancellation. */
export function startRollAnimation({
  selector,
  container,
  roll,
  dice,
  sound,
  onPhase,
  onFallback,
}: {
  selector: string;
  container: HTMLElement;
  roll: Roll;
  dice: DicePreferences;
  sound: boolean;
  onPhase: (phase: 'terms' | 'total') => void;
  onFallback: () => void;
}) {
  let cancelled = false,
    revealed = false,
    initializing = false,
    disposed = false,
    engine: DiceBox | undefined,
    observer: ResizeObserver | undefined,
    timer: ReturnType<typeof setTimeout> | undefined;
  const clearTimers = () => {
    clearTimeout(deadline);
    clearTimeout(timer);
  };
  const stop = () => {
    observer?.disconnect();
    if (engine) engine.running = false;
  };
  const dispose = () => {
    stop();
    // initialize() can still render after its theme promise resolves. Dispose only
    // after that promise settles, never while it can recreate GPU resources.
    if (!engine || initializing || disposed) return;
    disposed = true;
    for (const die of engine.diceList) {
      die.geometry.dispose();
      for (const material of die.material) {
        material.map?.dispose();
        material.dispose();
      }
    }
    engine.renderer?.dispose();
    engine.renderer?.forceContextLoss();
  };
  const reveal = (fallback = false) => {
    if (cancelled || revealed) return;
    revealed = true;
    clearTimers();
    stop();
    if (fallback) onFallback();
    onPhase('total');
  };
  const complete = () => {
    if (cancelled || revealed) return;
    clearTimeout(deadline);
    onPhase('terms');
    timer = setTimeout(() => reveal(), 1000 / dice.speed);
  };
  const deadline = setTimeout(() => reveal(true), 18000 / dice.speed);
  void (async () => {
    try {
      const { createDiceEngine } = await import('./diceEngine.js');
      if (cancelled || revealed) return;
      engine = createDiceEngine(
        selector,
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
      initializing = true;
      try {
        await engine.initialize();
      } finally {
        initializing = false;
      }
      if (cancelled || revealed) {
        dispose();
        return;
      }
      observer = new ResizeObserver(() => {
        if (!cancelled && !revealed)
          engine!.setDimensions({ x: container.clientWidth, y: container.clientHeight });
      });
      observer.observe(container);
      const result = await engine.roll(predeterminedNotation(roll.terms));
      if (cancelled || revealed) return;
      const expected = physicalDice(roll.terms).map((d) => d.value),
        actual = result.sets.flatMap((s) => s.rolls.map((r) => r.value));
      if (expected.length !== actual.length || expected.some((n, i) => actual[i] !== n)) {
        onFallback();
        console.warn('Dice renderer mismatch; displaying authoritative values.');
      }
      if (sound) playTone(dice.volume);
      complete();
    } catch {
      dispose();
      if (!cancelled && !revealed) {
        onFallback();
        complete();
      }
    }
  })();
  return {
    skip: () => reveal(),
    cancel: () => {
      cancelled = true;
      clearTimers();
      dispose();
    },
  };
}
