import type { Token } from '../../shared/model.js';
type Light = NonNullable<Token['light']>;
export function LightEffects({
  light,
  onChange,
  prefix,
}: {
  light: Light;
  onChange: (light: Light) => void;
  prefix: string;
}) {
  const effects = light.effects || {};
  const set = (patch: Partial<NonNullable<Light['effects']>>) => {
    const next = { ...effects, ...patch };
    onChange({ ...light, effects: next.hueShift || next.onOff || next.dimming ? next : undefined });
  };
  return (
    <details className="light-effects">
      <summary>
        Animated effects{effects.hueShift || effects.onOff || effects.dimming ? ' · on' : ''}
      </summary>
      <label>
        <input
          aria-label={`${prefix} hue shifting`}
          type="checkbox"
          checked={!!effects.hueShift}
          onChange={(e) => set({ hueShift: e.target.checked })}
        />{' '}
        Hue shifting
      </label>
      <label>
        <input
          aria-label={`${prefix} on-off flicker`}
          type="checkbox"
          checked={!!effects.onOff}
          onChange={(e) => set({ onOff: e.target.checked })}
        />{' '}
        On/off flicker
      </label>
      <label>
        <input
          aria-label={`${prefix} dimming flicker`}
          type="checkbox"
          checked={!!effects.dimming}
          onChange={(e) => set({ dimming: e.target.checked })}
        />{' '}
        Brightness flicker
      </label>
      {effects.dimming && (
        <label>
          Minimum brightness · {Math.round((effects.minBrightness ?? 0.35) * 100)}%
          <input
            aria-label={`${prefix} minimum brightness`}
            type="range"
            min={0.05}
            max={1}
            step={0.05}
            value={effects.minBrightness ?? 0.35}
            onChange={(e) => set({ minBrightness: Number(e.target.value) })}
          />
        </label>
      )}
      {(effects.onOff || effects.dimming) && (
        <label>
          Flicker frequency jitter ± (Hz)
          <input
            aria-label={`${prefix} flicker frequency jitter (Hz)`}
            type="number"
            min={0}
            max={3}
            step={0.01}
            value={effects.jitterHz ?? (effects.jitter ?? 0.5) * 0.1}
            onChange={(e) => set({ jitterHz: e.target.valueAsNumber })}
          />
        </label>
      )}
      {(
        [
          ['onOff', 'onOffHz', 'On/off frequency', ((effects.speed ?? 1) * 1.3) / (2 * Math.PI)],
          [
            'dimming',
            'dimmingHz',
            'Brightness frequency',
            ((effects.speed ?? 1) * 0.8) / (2 * Math.PI),
          ],
          ['hueShift', 'hueHz', 'Hue frequency', (effects.speed ?? 1) / 30],
        ] as const
      ).map(
        ([enabled, key, label, fallback]) =>
          effects[enabled] && (
            <label key={key}>
              {label} (Hz)
              <input
                aria-label={`${prefix} ${label.toLowerCase()} (Hz)`}
                type="number"
                min={0.01}
                max={3}
                step={0.01}
                value={effects[key] ?? Number(fallback.toFixed(2))}
                onChange={(e) => set({ [key]: e.target.valueAsNumber })}
              />
            </label>
          ),
      )}
      <small>
        On/off flicker reaches zero. Brightness flicker stays above the minimum and its radius
        follows brightness. Frequency is cycles per second; one hue cycle spans the colour wheel.
        Jitter is limited to each flicker's frequency so its rate cannot fall below zero. Reduced
        motion shows the steady light.
      </small>
    </details>
  );
}
