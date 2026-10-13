import { useTable } from '../store.js';
import { dicePresets, type DicePreferences } from '../../shared/diceThemes.js';
export function DiceSettings() {
  const s = useTable(),
    dice = s.dice,
    update = (value: Partial<DicePreferences>) => s.set({ dice: { ...dice, ...value } });
  return (
    <div className="dice-customization">
      <div className="theme-presets">
        {Object.entries(dicePresets).map(([name, preset]) => (
          <button
            key={name}
            type="button"
            onClick={() => s.set({ dice: preset, diceTheme: name === 'moon' ? 'moon' : 'gold' })}
          >
            <span style={{ background: preset.color, borderColor: preset.ink }} />
            {name}
          </button>
        ))}
      </div>
      <div className="form-row">
        <label>
          Dice colour
          <input
            type="color"
            value={dice.color}
            onChange={(e) => update({ color: e.target.value })}
          />
        </label>
        <label>
          Number colour
          <input type="color" value={dice.ink} onChange={(e) => update({ ink: e.target.value })} />
        </label>
        <label>
          Material
          <select
            value={dice.material}
            onChange={(e) => update({ material: e.target.value as DicePreferences['material'] })}
          >
            {['metal', 'glass', 'plastic', 'wood', 'gemstone'].map((v) => (
              <option key={v}>{v}</option>
            ))}
          </select>
        </label>
      </div>
      <label>
        Opacity · {Math.round(dice.opacity * 100)}%
        <input
          type="range"
          min={0.2}
          max={1}
          step={0.05}
          value={dice.opacity}
          onChange={(e) => update({ opacity: Number(e.target.value) })}
        />
      </label>
      <div className="form-row">
        <label>
          Tray appearance
          <select
            value={dice.tray}
            onChange={(e) => update({ tray: e.target.value as DicePreferences['tray'] })}
          >
            {['velvet', 'stone', 'astral'].map((v) => (
              <option key={v}>{v}</option>
            ))}
          </select>
        </label>
        <label>
          Arithmetic theme
          <select
            value={dice.presentation}
            onChange={(e) =>
              update({ presentation: e.target.value as DicePreferences['presentation'] })
            }
          >
            <option value="arcane">Arcane gold</option>
            <option value="moon">Moonlit silver</option>
            <option value="ember">Ember</option>
            <option value="minimal">Minimal · instant</option>
          </select>
        </label>
      </div>
      <label>
        Throw style
        <select
          value={dice.toss}
          onChange={(e) => update({ toss: e.target.value as DicePreferences['toss'] })}
        >
          <option value="scatter">Scattered tumble</option>
          <option value="cascade">Cascade from the edge</option>
          <option value="orbit">Arcane orbit</option>
        </select>
      </label>
      <div className="form-row">
        <label>
          Animation speed · {dice.speed.toFixed(1)}×
          <input
            type="range"
            min={0.5}
            max={2}
            step={0.1}
            value={dice.speed}
            onChange={(e) => update({ speed: Number(e.target.value) })}
          />
        </label>
        <label>
          Toss intensity
          <input
            type="range"
            min={0.5}
            max={1.8}
            step={0.1}
            value={dice.intensity}
            onChange={(e) => update({ intensity: Number(e.target.value) })}
          />
        </label>
      </div>
      <label>
        Performance preset
        <select
          value={dice.performance}
          onChange={(e) =>
            update({ performance: e.target.value as DicePreferences['performance'] })
          }
        >
          <option value="low">Low · no shadows or particles</option>
          <option value="balanced">Balanced</option>
          <option value="cinematic">Cinematic · sharper shadows</option>
        </select>
      </label>
      <label className="check-label">
        <input
          type="checkbox"
          checked={dice.particles}
          onChange={(e) => update({ particles: e.target.checked })}
        />
        Arithmetic particles
      </label>
      <label>
        Sound volume
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={dice.volume}
          onChange={(e) => update({ volume: Number(e.target.value) })}
        />
      </label>
    </div>
  );
}
