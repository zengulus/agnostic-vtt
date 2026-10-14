import { useState } from 'react';
import { useTable } from '../store.js';
import { sendAndWait } from '../connection.js';

export function FogActions() {
  const s = useTable(),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  if (s.self?.role !== 'gm') return null;
  const change = async (enabled: boolean) => {
    const scene = s.room.scenes[s.room.activeSceneId];
    if (
      !window.confirm(
        enabled
          ? 'Cover entire scene? This resets all exploration and reveal geometry. Undo can restore it.'
          : 'Reveal entire scene to the party? This clears all exploration geometry and exposes the entire map and public tokens. Undo can restore fog.',
      )
    )
      return;
    setBusy(true);
    setError('');
    try {
      await sendAndWait({
        type: 'FOG_UPDATE',
        sceneId: scene.id,
        fog: { enabled, revealed: [], operations: [] },
      });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <details className="fog-actions">
      <summary>Scene fog</summary>
      <div>
        <button disabled={busy} onClick={() => void change(false)}>
          Reveal entire scene
        </button>
        <button disabled={busy} onClick={() => void change(true)}>
          Cover entire scene
        </button>
        <p className="field-note">
          Fog is visual concealment. The shared map image remains accessible to players.
        </p>
        {error && (
          <p role="alert" className="form-error">
            {error}
          </p>
        )}
      </div>
    </details>
  );
}
