import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DiceResult } from '@3d-dice/dice-box-threejs';
import { dicePreferencesSchema } from '../shared/diceThemes.js';
import { evaluateDice } from '../shared/dice.js';
import type { Roll } from '../shared/model.js';
import { startRollAnimation } from '../src/rollAnimation.js';

const mocks = vi.hoisted(() => ({ create: vi.fn(), sound: vi.fn() }));
vi.mock('../src/diceEngine.js', () => ({ createDiceEngine: mocks.create }));
vi.mock('../src/sound.js', () => ({ playTone: mocks.sound }));
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
const result: DiceResult = { total: 14, sets: [{ rolls: [{ value: 14, sides: 20 }] }] };
const roll: Roll = {
  id: 'authoritative-roll',
  actionId: 'roll-action',
  userId: 'gm',
  userName: 'GM',
  expression: '1d20',
  ...evaluateDice('1d20', () => 14),
  visibility: 'public',
  createdAt: '2026-10-14T00:00:00Z',
};

describe('roll animation lifecycle', () => {
  let initialization: ReturnType<typeof deferred<void>>;
  let animation: ReturnType<typeof deferred<DiceResult>>;
  let engine: {
    initialize: ReturnType<typeof vi.fn>;
    roll: ReturnType<typeof vi.fn>;
    setDimensions: ReturnType<typeof vi.fn>;
    running: number | boolean;
    diceList: [];
    renderer: { dispose: ReturnType<typeof vi.fn>; forceContextLoss: ReturnType<typeof vi.fn> };
  };
  const onPhase = vi.fn(),
    onFallback = vi.fn(),
    disconnect = vi.fn();
  function start(speed = 1) {
    return startRollAnimation({
      selector: '#dice-test',
      container: { clientWidth: 800, clientHeight: 500 } as HTMLElement,
      roll,
      dice: dicePreferencesSchema.parse({ speed }),
      sound: true,
      onPhase,
      onFallback,
    });
  }
  async function initialized() {
    await vi.dynamicImportSettled();
    initialization.resolve();
    await Promise.resolve();
  }
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    initialization = deferred<void>();
    animation = deferred<DiceResult>();
    engine = {
      initialize: vi.fn(() => initialization.promise),
      roll: vi.fn(() => animation.promise),
      setDimensions: vi.fn(),
      running: 1,
      diceList: [],
      renderer: { dispose: vi.fn(), forceContextLoss: vi.fn() },
    };
    mocks.create.mockReturnValue(engine);
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe = vi.fn();
        disconnect = disconnect;
      },
    );
  });
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });
  it('shows contributions then the total and cancels the fallback deadline on success', async () => {
    const presentation = start(2);
    await initialized();
    expect(engine.roll).toHaveBeenCalledWith('1d20@14');
    animation.resolve(result);
    await Promise.resolve();
    expect(onPhase.mock.calls).toEqual([['terms']]);
    await vi.advanceTimersByTimeAsync(499);
    expect(onPhase).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(onPhase.mock.calls).toEqual([['terms'], ['total']]);
    await vi.advanceTimersByTimeAsync(18000);
    expect(onFallback).not.toHaveBeenCalled();
    expect(mocks.sound).toHaveBeenCalledTimes(1);
    presentation.cancel();
    presentation.cancel();
    expect(engine.renderer.dispose).toHaveBeenCalledTimes(1);
  });
  it('skips before the lazy module loads without creating a renderer', async () => {
    const presentation = start();
    presentation.skip();
    presentation.skip();
    await vi.dynamicImportSettled();
    await vi.advanceTimersByTimeAsync(20000);
    expect(mocks.create).not.toHaveBeenCalled();
    expect(onPhase.mock.calls).toEqual([['total']]);
    expect(onFallback).not.toHaveBeenCalled();
    presentation.cancel();
  });
  it('does not roll or regress from total when initialization finishes after Skip', async () => {
    const presentation = start();
    await vi.dynamicImportSettled();
    presentation.skip();
    expect(engine.running).toBe(false);
    expect(engine.renderer.dispose).not.toHaveBeenCalled();
    initialization.resolve();
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(20000);
    expect(engine.roll).not.toHaveBeenCalled();
    expect(engine.renderer.dispose).toHaveBeenCalledTimes(1);
    expect(onPhase.mock.calls).toEqual([['total']]);
    expect(onFallback).not.toHaveBeenCalled();
    presentation.cancel();
  });
  it('ignores a late roll completion after Skip', async () => {
    const presentation = start();
    await initialized();
    presentation.skip();
    animation.resolve(result);
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(20000);
    expect(onPhase.mock.calls).toEqual([['total']]);
    expect(mocks.sound).not.toHaveBeenCalled();
    expect(onFallback).not.toHaveBeenCalled();
    expect(disconnect).toHaveBeenCalled();
    presentation.cancel();
  });
  it('keeps fallback total visible when a stalled roll later resolves', async () => {
    const presentation = start();
    await initialized();
    await vi.advanceTimersByTimeAsync(18000);
    expect(onFallback).toHaveBeenCalledTimes(1);
    animation.resolve(result);
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(1000);
    expect(onPhase.mock.calls).toEqual([['total']]);
    expect(mocks.sound).not.toHaveBeenCalled();
    presentation.cancel();
  });
  it('cleans up after cancellation while initialization is still pending', async () => {
    const presentation = start();
    await vi.dynamicImportSettled();
    presentation.cancel();
    expect(engine.renderer.dispose).not.toHaveBeenCalled();
    initialization.resolve();
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(20000);
    expect(engine.renderer.dispose).toHaveBeenCalledTimes(1);
    expect(engine.roll).not.toHaveBeenCalled();
    expect(onPhase).not.toHaveBeenCalled();
    expect(onFallback).not.toHaveBeenCalled();
  });
  it('cancels the contribution reveal timer when dismissed', async () => {
    const presentation = start();
    await initialized();
    animation.resolve(result);
    await Promise.resolve();
    presentation.cancel();
    await vi.advanceTimersByTimeAsync(20000);
    expect(onPhase.mock.calls).toEqual([['terms']]);
    expect(engine.renderer.dispose).toHaveBeenCalledTimes(1);
  });
  it('falls back after renderer failure without replacing authoritative results', async () => {
    const presentation = start();
    await initialized();
    animation.reject(new Error('WebGL context lost'));
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(1000);
    expect(onFallback).toHaveBeenCalledTimes(1);
    expect(onPhase.mock.calls).toEqual([['terms'], ['total']]);
    expect(engine.renderer.dispose).toHaveBeenCalledTimes(1);
    presentation.cancel();
  });
});
