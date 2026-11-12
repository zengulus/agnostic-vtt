import { useEffect, useState } from 'react';
import { useTable } from '../store.js';
import { useConfirmedAction } from '../useConfirmedAction.js';
import { lightSchema, type Scene, type Token } from '../../shared/model.js';
import { tokenEdits } from '../../shared/tokenEdits.js';
import { LightEditor } from './LightEditor.js';

export function LightingControls({ scene }: { scene: Scene }) {
  const s = useTable(),
    action = useConfirmedAction();
  const [lighting, setLighting] = useState(scene.lighting || { vision: false, darkness: 0 });
  const [baseline, setBaseline] = useState(scene.lighting ?? null);
  const same = (a: Scene['lighting'] | null, b: Scene['lighting'] | null) =>
    (a?.vision ?? false) === (b?.vision ?? false) && (a?.darkness ?? 0) === (b?.darkness ?? 0);
  const dirty = !same(lighting, baseline),
    changed = JSON.stringify(scene.lighting ?? null) !== JSON.stringify(baseline);
  useEffect(() => {
    if (!dirty && changed) {
      setBaseline(scene.lighting ?? null);
      setLighting(scene.lighting || { vision: false, darkness: 0 });
    }
  }, [scene.lighting, dirty, changed]);
  const [editing, setEditing] = useState<Token | null>(null);
  const [editingDirty, setEditingDirty] = useState(false);
  const lights = Object.values(scene.tokens).filter((token) => !!token.light);
  const selected = s.selected ? scene.tokens[s.selected] : undefined;
  if (s.self?.role !== 'gm') return null;
  return (
    <details className="lighting-controls">
      <summary>Walls, vision & lighting</summary>
      <p>
        Draw opaque walls, doors and windows with the Walls tool. Doors and windows can be edited
        below.
      </p>
      <label>
        <input
          type="checkbox"
          checked={lighting.vision}
          onChange={(e) => setLighting({ ...lighting, vision: e.target.checked })}
        />{' '}
        Enable shared player vision
      </label>
      <label>
        Darkness{' '}
        <input
          aria-label="Scene darkness"
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={lighting.darkness}
          onChange={(e) => setLighting({ ...lighting, darkness: Number(e.target.value) })}
        />{' '}
        {Math.round(lighting.darkness * 100)}%
      </label>
      <button
        type="button"
        disabled={!!action.pending}
        onClick={async () => {
          if (
            await action.run(
              { type: 'LIGHTING_SET', sceneId: scene.id, lighting, expected: baseline },
              'Saving lighting…',
            )
          )
            setBaseline(lighting);
        }}
      >
        Apply vision and darkness
      </button>
      {dirty && changed && (
        <p role="alert">
          Lighting changed elsewhere. Your draft is preserved.{' '}
          <button
            type="button"
            onClick={() => {
              setBaseline(scene.lighting ?? null);
              setLighting(scene.lighting || { vision: false, darkness: 0 });
            }}
          >
            Reload latest lighting
          </button>
        </p>
      )}
      {action.pending && <p role="status">{action.pending}</p>}
      {action.error && <p role="alert">{action.error}</p>}
      <p>
        Players share 360° vision from all player-controlled tokens. Configure optional NPC cones
        and lights in the token editor.
      </p>
      <div className="light-manager">
        <h3>Light sources · {lights.length}</h3>
        <button
          type="button"
          onClick={() => {
            if (editingDirty && !window.confirm('Discard the unsaved light changes?')) return;
            setEditing(null);
            setEditingDirty(false);
            s.set({ tool: 'light', ...(s.dialog === 'library' ? { dialog: null } : {}) });
          }}
        >
          Place a light on the map
        </button>
        {selected && !selected.light && (
          <button
            type="button"
            disabled={!!action.pending || !lightSchema.safeParse(s.lightDraft.light).success}
            onClick={async () => {
              if (editingDirty && !window.confirm('Discard the unsaved light changes?')) return;
              const edits = tokenEdits(selected, {
                ...selected,
                light: structuredClone(s.lightDraft.light),
              });
              if (
                await action.run(
                  { type: 'TOKEN_PATCH', sceneId: scene.id, tokenId: selected.id, edits },
                  'Adding light…',
                )
              ) {
                const latest = useTable.getState().room.scenes[scene.id]?.tokens[selected.id];
                if (latest) setEditing(latest);
              }
            }}
          >
            Add light to {selected.name}
          </button>
        )}
        <p>
          Lights are public tokens with hidden map labels. GM-only tokens do not illuminate the
          player view.
        </p>
        {lights.length === 0 && <p>No light sources in this scene yet.</p>}
        {lights.map((token) => (
          <div key={token.id}>
            <div className="light-source-row">
              <span>
                <span className="light-swatch" style={{ background: token.light!.color }} />{' '}
                {token.name} · {Math.round(token.light!.radius)} px
                {' · '}
                {Math.round(token.x)}, {Math.round(token.y)}
                {token.visibility === 'gm' ? ' · GM only' : ''}
              </span>
              <button
                type="button"
                aria-description={`At map position ${Math.round(token.x)}, ${Math.round(token.y)}`}
                onClick={() => {
                  if (editing?.id === token.id) return;
                  if (
                    editing?.id !== token.id &&
                    editingDirty &&
                    !window.confirm('Discard the unsaved light changes?')
                  )
                    return;
                  s.set({ selected: token.id, selectedIds: [token.id], tool: 'select' });
                  setEditingDirty(false);
                  setEditing(token);
                }}
              >
                Edit {token.name}
              </button>
            </div>
            {editing?.id === token.id && (
              <LightEditor
                key={`${scene.id}:${editing.id}`}
                token={editing}
                sceneId={scene.id}
                onDirtyChange={setEditingDirty}
                onClose={() => {
                  setEditing(null);
                  setEditingDirty(false);
                }}
              />
            )}
          </div>
        ))}
      </div>
      <div className="wall-list">
        {Object.values(scene.walls || {}).map((wall, index) => (
          <div key={wall.id}>
            <span>
              {wall.kind} {index + 1} · {Math.round(wall.a.x)}, {Math.round(wall.a.y)} →{' '}
              {Math.round(wall.b.x)}, {Math.round(wall.b.y)}
            </span>
            {wall.kind === 'door' && (
              <button
                type="button"
                disabled={!!action.pending}
                onClick={() =>
                  void action.run(
                    { type: 'WALL_SET', sceneId: scene.id, wall: { ...wall, open: !wall.open } },
                    'Updating door…',
                  )
                }
              >
                {wall.open ? 'Close' : 'Open'} door {index + 1}
              </button>
            )}
            <button
              type="button"
              disabled={!!action.pending}
              onClick={() =>
                void action.run(
                  { type: 'WALL_DELETE', sceneId: scene.id, id: wall.id },
                  'Removing wall…',
                )
              }
            >
              Delete {wall.kind} {index + 1}
            </button>
          </div>
        ))}
      </div>
      {action.pending && <p role="status">{action.pending}</p>}
      {action.error && <p role="alert">{action.error}</p>}
    </details>
  );
}
