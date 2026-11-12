import { lightPresets, type LightDraft } from '../lightPresets.js';
import { LightEffects } from './LightEffects.js';

export function LightFields({
  value,
  onChange,
  prefix,
  preserveName = false,
  showHint = true,
}: {
  value: LightDraft;
  onChange: (value: LightDraft) => void;
  prefix: string;
  preserveName?: boolean;
  showHint?: boolean;
}) {
  const matchingPreset = Object.entries(lightPresets).find(([, preset]) =>
    (preserveName || value.name === preset.name) &&
    value.light.radius === preset.light.radius && value.light.color === preset.light.color &&
    value.light.intensity === preset.light.intensity && (value.light.angle ?? 360) === (preset.light.angle ?? 360) &&
    (value.light.direction ?? 0) === (preset.light.direction ?? 0) && !value.light.effects,
  )?.[0] ?? 'custom';
  return (
    <div className="light-fields">
      <label>
        Preset{' '}
        <select
          aria-label={`${prefix} preset`}
          value={matchingPreset}
          onChange={(e) => {
            const preset = lightPresets[e.target.value];
            if (preset)
              onChange({
                ...structuredClone(preset),
                ...(preserveName ? { name: value.name } : {}),
              });
          }}
        >
          <option value="custom">Custom</option>
          <option value="torch">Torch</option>
          <option value="candle">Candle</option>
          <option value="lantern">Lantern</option>
          <option value="arcane">Arcane light</option>
          <option value="sconce">Directional sconce</option>
        </select>
      </label>
      <label>
        Name{' '}
        <input
          aria-label={`${prefix} name`}
          maxLength={48}
          value={value.name}
          onChange={(e) => onChange({ ...value, name: e.target.value })}
        />
      </label>
      <label>
        Radius · map pixels{' '}
        <input
          aria-label={`${prefix} radius`}
          type="number"
          min={0}
          max={5000}
          step={10}
          value={value.light.radius}
          onChange={(e) =>
            onChange({ ...value, light: { ...value.light, radius: Number(e.target.value) } })
          }
        />
      </label>
      <label>
        Colour{' '}
        <input
          aria-label={`${prefix} colour`}
          type="color"
          value={value.light.color}
          onChange={(e) => onChange({ ...value, light: { ...value.light, color: e.target.value } })}
        />
      </label>
      <label>
        Intensity · {Math.round(value.light.intensity * 100)}%{' '}
        <input
          aria-label={`${prefix} intensity`}
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={value.light.intensity}
          onChange={(e) =>
            onChange({ ...value, light: { ...value.light, intensity: Number(e.target.value) } })
          }
        />
      </label>
      <label>
        Shape{' '}
        <select
          aria-label={`${prefix} shape`}
          value={(value.light.angle ?? 360) < 360 ? 'directional' : 'radial'}
          onChange={(e) =>
            onChange({
              ...value,
              light: { ...value.light, angle: e.target.value === 'radial' ? 360 : 90 },
            })
          }
        >
          <option value="radial">Radial · 360°</option>
          <option value="directional">Directional</option>
        </select>
      </label>
      {(value.light.angle ?? 360) < 360 && (
        <label>
          Beam width · degrees{' '}
          <input
            aria-label={`${prefix} beam width`}
            type="number"
            min={1}
            max={359}
            value={value.light.angle}
            onChange={(e) =>
              onChange({ ...value, light: { ...value.light, angle: Number(e.target.value) } })
            }
          />
        </label>
      )}
      {(value.light.angle ?? 360) < 360 && (
        <label>
          Direction offset · degrees{' '}
          <input
            aria-label={`${prefix} direction`}
            type="number"
            min={-360}
            max={360}
            value={value.light.direction ?? 0}
            onChange={(e) =>
              onChange({ ...value, light: { ...value.light, direction: Number(e.target.value) } })
            }
          />
        </label>
      )}
      <LightEffects
        prefix={prefix}
        light={value.light}
        onChange={(light) => onChange({ ...value, light })}
      />
      {showHint && (value.light.angle ?? 360) < 360 && (
        <small>The beam follows token rotation; 0° points right.</small>
      )}
    </div>
  );
}
