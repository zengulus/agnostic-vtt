import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDiceEngine } from '../src/diceEngine.js';

const frames = vi.hoisted(() => ({ throw: vi.fn(), after: vi.fn(), renderer: vi.fn() }));
vi.mock('@3d-dice/dice-box-threejs', () => ({
  default: class {
    running: number | boolean = 12;
    diceList = [];
    renderer: unknown;
    initialize() {
      this.renderer = frames.renderer();
      return Promise.resolve();
    }
    resizeWorld() {}
    swapDiceFace_D4() {}
    animateThrow = frames.throw;
    animateAfterThrow = frames.after;
  },
}));
describe('dice engine frame cancellation', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.useRealTimers());
  it('does not step or render a queued frame after stopping or replacing a throw', () => {
    const engine = createDiceEngine('#dice-test', {}) as unknown as {
      running: number | boolean;
      animateThrow: (run: number) => void;
      animateAfterThrow: (run: number) => void;
    };
    engine.animateThrow(12);
    expect(frames.throw).toHaveBeenCalledTimes(1);
    engine.running = false;
    engine.animateThrow(12);
    engine.animateAfterThrow(12);
    expect(frames.throw).toHaveBeenCalledTimes(1);
    expect(frames.after).not.toHaveBeenCalled();
    engine.running = 13;
    engine.animateThrow(12);
    engine.animateAfterThrow(12);
    expect(frames.throw).toHaveBeenCalledTimes(1);
    expect(frames.after).not.toHaveBeenCalled();
    engine.animateThrow(13);
    engine.animateAfterThrow(13);
    expect(frames.throw).toHaveBeenCalledTimes(2);
    expect(frames.after).toHaveBeenCalledTimes(1);
  });
  it('blocks the real upstream clearDice delayed render after renderer disposal', async () => {
    vi.useFakeTimers();
    const { default: UpstreamDiceBox } = await vi.importActual<
      typeof import('@3d-dice/dice-box-threejs')
    >('@3d-dice/dice-box-threejs');
    const render = vi.fn(),
      dispose = vi.fn(),
      otherRender = vi.fn();
    frames.renderer
      .mockReturnValueOnce({ render, dispose, forceContextLoss: vi.fn() })
      .mockReturnValueOnce({ render: otherRender, dispose: vi.fn(), forceContextLoss: vi.fn() });
    const engine = createDiceEngine('#first', {}),
      other = createDiceEngine('#second', {});
    await engine.initialize();
    await other.initialize();
    // Use the installed method, including its untracked 100ms setTimeout.
    UpstreamDiceBox.prototype.clearDice.call(engine);
    UpstreamDiceBox.prototype.clearDice.call(other);
    expect(render).toHaveBeenCalledTimes(1);
    expect(otherRender).toHaveBeenCalledTimes(1);
    engine.running = false;
    engine.renderer.dispose();
    engine.renderer.forceContextLoss();
    await vi.advanceTimersByTimeAsync(100);
    expect(render).toHaveBeenCalledTimes(1);
    expect(dispose).toHaveBeenCalledTimes(1);
    // The guard belongs to one renderer; active engines still redraw normally.
    expect(otherRender).toHaveBeenCalledTimes(2);
    engine.renderer.dispose();
    expect(dispose).toHaveBeenCalledTimes(1);
    other.renderer.dispose();
  });
});
