import DiceBox from '@3d-dice/dice-box-threejs';
import type { DicePreferences } from '../shared/diceThemes.js';
import { playTone } from './sound.js';
/** Isolate upstream lifecycle and forced-d4 fixes from the presentation layer. */
export function createDiceEngine(
  selector: string,
  options: Record<string, unknown>,
  appearance?: DicePreferences,
  sound = false,
): DiceBox {
  const engine = new DiceBox(selector, options);
  const internal = engine as unknown as {
    resizeWorld: () => void;
    swapDiceFace_D4: (die: { result: unknown[] }, value: number) => void;
  };
  // Observe container sizing in React instead of leaking the library's window listener.
  internal.resizeWorld = () => {};
  const forceD4 = internal.swapDiceFace_D4.bind(engine);
  internal.swapDiceFace_D4 = (die, value) => {
    forceD4(die, value);
    // Upstream rotates the geometry/materials but leaves the simulated old result.
    // Clear it so the replay records the value of the actual forced face.
    die.result = [];
    if (appearance)
      for (const material of (
        die as unknown as {
          material: Array<{ opacity: number; transparent: boolean; needsUpdate: boolean }>;
        }
      ).material) {
        material.opacity = appearance.opacity;
        material.transparent = appearance.opacity < 1;
        material.needsUpdate = true;
      }
  };
  if (appearance) {
    type Die = {
      material: Array<{
        opacity: number;
        transparent: boolean;
        roughness?: number;
        metalness?: number;
        needsUpdate: boolean;
      }>;
    };
    const lifecycle = engine as unknown as {
      diceList: Die[];
      spawnDice: (...args: unknown[]) => void;
      animateThrow: (...args: unknown[]) => void;
      last_time: number;
      eventCollide: (...args: unknown[]) => void;
      animstate: string;
    };
    const display = engine as unknown as {
      setDimensions: (...args: unknown[]) => void;
      renderer?: { setPixelRatio: (ratio: number) => void };
      light?: {
        shadow: { mapSize: { width: number; height: number }; map: { dispose: () => void } | null };
      };
    };
    const dimensions = display.setDimensions.bind(engine);
    display.setDimensions = (...args) => {
      display.light?.shadow.map?.dispose();
      dimensions(...args);
      display.renderer?.setPixelRatio(
        appearance.performance === 'cinematic' ? Math.min(devicePixelRatio, 2) : 1,
      );
      if (display.light) {
        display.light.shadow.mapSize.width = appearance.performance === 'cinematic' ? 2048 : 1024;
        display.light.shadow.mapSize.height = display.light.shadow.mapSize.width;
        if (appearance.performance === 'cinematic') {
          display.light.shadow.map?.dispose();
          display.light.shadow.map = null;
        }
      }
    };
    const spawn = lifecycle.spawnDice.bind(engine);
    lifecycle.spawnDice = (...args) => {
      spawn(...args);
      const die = (args[1] || lifecycle.diceList.at(-1)) as Die | undefined;
      if (die)
        for (const material of die.material) {
          material.opacity = appearance.opacity;
          material.transparent = appearance.opacity < 1;
          if (appearance.material === 'gemstone') {
            material.roughness = 0.12;
            material.metalness = 0.15;
          }
          material.needsUpdate = true;
        }
    };
    const animate = lifecycle.animateThrow.bind(engine);
    let lastTick = 0;
    lifecycle.animateThrow = (...args) => {
      if (lifecycle.last_time) {
        const now = Date.now();
        const remaining = Math.max(0, lastTick - lifecycle.last_time);
        lifecycle.last_time =
          now -
          remaining -
          Math.min(100, Math.max(0, now - (lastTick || lifecycle.last_time))) * appearance.speed;
        lastTick = now;
      } else lastTick = Date.now();
      animate(...args);
    };
    if (appearance.toss !== 'scatter') {
      type Vector = {
        pos: { x: number; y: number; z: number };
        velocity: { x: number; y: number; z: number };
      };
      const notation = engine as unknown as {
        getNotationVectors: (...args: unknown[]) => { vectors: Vector[] };
        display: { containerWidth: number; containerHeight: number };
      };
      const get = notation.getNotationVectors.bind(engine);
      notation.getNotationVectors = (...args) => {
        const result = get(...args);
        result.vectors.forEach((v, i) => {
          if (appearance.toss === 'cascade') {
            v.pos.x = -notation.display.containerWidth * 0.8;
            v.pos.y =
              (i / Math.max(1, result.vectors.length - 1) - 0.5) * notation.display.containerHeight;
            v.velocity.x = Math.abs(v.velocity.x) || 700;
          } else {
            const a = (i / result.vectors.length) * Math.PI * 2;
            v.pos.x = Math.cos(a) * notation.display.containerWidth * 0.75;
            v.pos.y = Math.sin(a) * notation.display.containerHeight * 0.75;
            v.velocity.x = (-Math.sin(a) * 700 - Math.cos(a) * 600) * appearance.intensity;
            v.velocity.y = (Math.cos(a) * 700 - Math.sin(a) * 600) * appearance.intensity;
          }
          v.pos.z = 220 + (i % 5) * 35;
        });
        return result;
      };
    }
    const collide = lifecycle.eventCollide.bind(engine);
    lifecycle.eventCollide = (...args) => {
      collide(...args);
      if (sound && lifecycle.animstate === 'throw') playTone(appearance.volume, true);
    };
  }
  return engine;
}
