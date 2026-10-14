import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Asset } from '../shared/model.js';

const { resolveAsset } = vi.hoisted(() => ({ resolveAsset: vi.fn() }));
vi.mock('../src/assets.js', () => ({ resolveAsset }));

class ImageSource {
  static instances: ImageSource[] = [];
  width = 800;
  height = 600;
  naturalWidth = 800;
  naturalHeight = 600;
  src = '';
  referrerPolicy = '';
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor() {
    ImageSource.instances.push(this);
  }
}

describe('renderer image recovery', () => {
  let table: typeof import('../src/store.js');
  let rendering: typeof import('../src/rendering.js');
  let renderer: InstanceType<typeof import('../src/rendering.js').SceneRenderer>;
  let context: CanvasRenderingContext2D;
  let redraw: ReturnType<typeof vi.fn<() => void>>;
  const asset: Asset = { kind: 'external', url: 'https://images.example.test/map.png' };
  function draw() {
    const scene = structuredClone(table.demoState.scenes.hollow);
    scene.map = asset;
    scene.tokens = {};
    scene.grid.enabled = false;
    scene.fog.enabled = false;
    renderer.draw(context, {
      scene,
      roomId: 'campaign',
      camera: { x: 0, y: 0, zoom: 1 },
      width: 800,
      height: 600,
      dpr: 1,
      gm: true,
      selected: [],
      previews: {},
      localDragging: new Set(),
      reducedMotion: true,
      pings: [],
      draft: null,
      tool: 'select',
      zoneShape: 'rectangle',
      fogShape: 'circle',
      fogMode: 'reveal',
      brushSize: 100,
      drawColor: '#fff',
      drawWidth: 1,
      measurementShape: 'distance',
      redraw,
    });
  }
  beforeEach(async () => {
    vi.resetModules();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
    vi.stubGlobal('localStorage', { getItem: () => null });
    vi.stubGlobal('matchMedia', () => ({ matches: false }));
    vi.stubGlobal('Image', ImageSource);
    ImageSource.instances = [];
    resolveAsset.mockReset().mockResolvedValue(asset.url);
    context = new Proxy({} as CanvasRenderingContext2D, {
      get(target, key) {
        return Reflect.get(target, key) ?? vi.fn();
      },
    });
    vi.stubGlobal('document', {
      createElement: vi.fn(() => ({ width: 0, height: 0, getContext: () => context })),
    });
    redraw = vi.fn();
    table = await import('../src/store.js');
    rendering = await import('../src/rendering.js');
    renderer = new rendering.SceneRenderer();
  });
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });
  it('retries transient failures with bounded backoff instead of on every frame', async () => {
    draw();
    await Promise.resolve();
    ImageSource.instances[0].onerror?.();
    for (let i = 0; i < 100; i++) draw();
    expect(ImageSource.instances).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1000);
    draw();
    expect(ImageSource.instances).toHaveLength(2);
    ImageSource.instances[1].onerror?.();
    await vi.advanceTimersByTimeAsync(3999);
    draw();
    expect(ImageSource.instances).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1);
    draw();
    expect(ImageSource.instances).toHaveLength(3);
    ImageSource.instances[2].onerror?.();
    await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
    for (let i = 0; i < 100; i++) draw();
    expect(ImageSource.instances).toHaveLength(3);
    expect(vi.getTimerCount()).toBe(0);
  });
  it('lets a successful preview invalidate a failed entry for the identical URL', async () => {
    draw();
    await Promise.resolve();
    ImageSource.instances[0].onerror?.();
    rendering.invalidateImage(asset, 'campaign');
    draw();
    await Promise.resolve();
    expect(ImageSource.instances).toHaveLength(2);
    ImageSource.instances[1].onload?.();
    draw();
    expect(ImageSource.instances).toHaveLength(2);
    expect(document.createElement).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
  it('retries failed assets when the same campaign reconnects, keeping successful ones cached', async () => {
    table.useTable.getState().set({ status: 'live' });
    draw();
    await Promise.resolve();
    ImageSource.instances[0].onerror?.();
    table.useTable.getState().set({ status: 'reconnecting' });
    table.useTable.getState().set({ status: 'live' });
    draw();
    await Promise.resolve();
    expect(ImageSource.instances).toHaveLength(2);
    ImageSource.instances[1].onload?.();
    table.useTable.getState().set({ status: 'reconnecting' });
    table.useTable.getState().set({ status: 'live' });
    draw();
    expect(ImageSource.instances).toHaveLength(2);
  });
  it('ignores late load and error callbacks after invalidation', async () => {
    draw();
    await Promise.resolve();
    const oldLoad = ImageSource.instances[0].onload!;
    const oldError = ImageSource.instances[0].onerror!;
    rendering.invalidateImage(asset, 'campaign');
    draw();
    redraw.mockClear();
    oldLoad();
    oldError();
    expect(redraw).not.toHaveBeenCalled();
    expect(document.createElement).not.toHaveBeenCalled();
    expect(ImageSource.instances).toHaveLength(2);
  });
  it('does not start an image request when asset resolution finishes after invalidation', async () => {
    let resolve!: (value: string) => void;
    resolveAsset.mockReturnValueOnce(
      new Promise<string>((yes) => {
        resolve = yes;
      }),
    );
    draw();
    rendering.invalidateImage(asset, 'campaign');
    resolve(asset.url);
    await Promise.resolve();
    expect(ImageSource.instances[0].src).toBe('');
    expect(redraw).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
  it('recovers from a timed-out image while ignoring its late successful load', async () => {
    draw();
    await Promise.resolve();
    const oldLoad = ImageSource.instances[0].onload!;
    await vi.advanceTimersByTimeAsync(12000);
    oldLoad();
    expect(document.createElement).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1000);
    draw();
    await Promise.resolve();
    ImageSource.instances[1].onload?.();
    expect(document.createElement).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
  it('retries asset resolution errors and stops retrying rejected oversized images', async () => {
    resolveAsset.mockRejectedValueOnce(new Error('Temporary network failure'));
    draw();
    await Promise.resolve();
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(1000);
    draw();
    await Promise.resolve();
    expect(ImageSource.instances).toHaveLength(2);
    ImageSource.instances[1].naturalWidth = 10000;
    ImageSource.instances[1].naturalHeight = 10000;
    ImageSource.instances[1].onload?.();
    await vi.advanceTimersByTimeAsync(60000);
    draw();
    expect(ImageSource.instances).toHaveLength(2);
    expect(vi.getTimerCount()).toBe(0);
  });
  it('disposes pending requests and backoff timers when changing identity', async () => {
    draw();
    await Promise.resolve();
    ImageSource.instances[0].onerror?.();
    expect(vi.getTimerCount()).toBe(1);
    table.useTable
      .getState()
      .set({ self: { id: 'other-user', name: 'Other', color: '#fff', role: 'player' } });
    expect(vi.getTimerCount()).toBe(0);
    draw();
    expect(ImageSource.instances).toHaveLength(2);
    expect(ImageSource.instances[1].referrerPolicy).toBe('no-referrer');
  });
});
