import { useEffect, useState } from 'react';
import { pinDigest, type ScenePin } from '../../shared/model.js';
import { useTable } from '../store.js';
import { useConfirmedAction } from '../useConfirmedAction.js';
import { ProximityEditor } from './ProximityEditor.js';

export function PinList() {
  const s = useTable(),
    scene = s.room.scenes[s.viewSceneId || s.room.activeSceneId];
  const [x, setX] = useState(0),
    [y, setY] = useState(0);
  const pins = Object.values(scene.pins || {});
  return (
    <details className="pin-list">
      <summary>Map pins · {pins.length}</summary>
      {s.self?.role === 'gm' && (
        <button
          type="button"
          onClick={() =>
            s.set({
              tool: 'pin',
              selectedPin: null,
              ...(s.dialog === 'library' ? { dialog: null } : {}),
            })
          }
        >
          Place a pin on the map
        </button>
      )}
      {s.self?.role === 'gm' && (
        <details>
          <summary>Place pin by coordinates</summary>
          <label>
            Pin X{' '}
            <input
              type="number"
              min={0}
              max={scene.width}
              value={x}
              onChange={(e) => setX(Number(e.target.value))}
            />
          </label>
          <label>
            Pin Y{' '}
            <input
              type="number"
              min={0}
              max={scene.height}
              value={y}
              onChange={(e) => setY(Number(e.target.value))}
            />
          </label>
          <button
            type="button"
            onClick={() =>
              s.set({
                tool: 'select',
                selectedPin: ':new',
                pinDraftPoint: {
                  x: Math.max(0, Math.min(scene.width, x)),
                  y: Math.max(0, Math.min(scene.height, y)),
                },
                ...(s.dialog === 'library' ? { dialog: null } : {}),
              })
            }
          >
            Create pin
          </button>
        </details>
      )}
      {pins.map((pin) => (
        <button
          type="button"
          key={pin.id}
          onClick={() =>
            s.set({
              selectedPin: pin.id,
              pinDraftPoint: null,
              ...(s.dialog === 'library' ? { dialog: null } : {}),
            })
          }
        >
          {pin.label}
          {pin.visibility === 'gm' ? ' · GM only' : ''}
        </button>
      ))}
    </details>
  );
}

function PinEditor({ initial, isNew }: { initial: ScenePin; isNew: boolean }) {
  const s = useTable(),
    action = useConfirmedAction();
  const [draft, setDraft] = useState(initial);
  const scene = s.room.scenes[s.viewSceneId || s.room.activeSceneId];
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        if (
          await action.run(
            {
              type: 'PIN_SET',
              sceneId: scene.id,
              pin: draft,
              ...(isNew ? {} : { expected: pinDigest(initial) }),
            },
            'Saving pin…',
          )
        )
          s.set({ selectedPin: null, pinDraftPoint: null });
      }}
    >
      <label>
        Label{' '}
        <input
          required
          maxLength={60}
          value={draft.label}
          onChange={(e) => setDraft({ ...draft, label: e.target.value })}
        />
      </label>
      <label>
        Description{' '}
        <textarea
          maxLength={1000}
          value={draft.description}
          onChange={(e) => setDraft({ ...draft, description: e.target.value })}
        />
      </label>
      <label>
        GM note{' '}
        <textarea
          maxLength={1000}
          value={draft.gmNote || ''}
          onChange={(e) => setDraft({ ...draft, gmNote: e.target.value })}
        />
      </label>
      <label>
        Visibility{' '}
        <select
          value={draft.visibility}
          onChange={(e) =>
            setDraft({ ...draft, visibility: e.target.value as ScenePin['visibility'] })
          }
        >
          <option value="public">Party</option>
          <option value="gm">GM only</option>
        </select>
      </label>
      <label>
        Destination{' '}
        <select
          value={draft.destinationSceneId || ''}
          onChange={(e) => setDraft({ ...draft, destinationSceneId: e.target.value || undefined })}
        >
          <option value="">None</option>
          {Object.values(s.room.scenes)
            .filter((item) => item.id !== scene.id)
            .map((item) => (
              <option value={item.id} key={item.id}>
                {item.name}
              </option>
            ))}
        </select>
      </label>
      <div className="form-row">
        <label>
          X{' '}
          <input
            type="number"
            min={0}
            max={scene.width}
            value={draft.x}
            onChange={(e) => setDraft({ ...draft, x: Number(e.target.value) })}
          />
        </label>
        <label>
          Y{' '}
          <input
            type="number"
            min={0}
            max={scene.height}
            value={draft.y}
            onChange={(e) => setDraft({ ...draft, y: Number(e.target.value) })}
          />
        </label>
      </div>
      <ProximityEditor
        value={draft.proximity}
        onChange={(proximity) => setDraft({ ...draft, proximity })}
      />
      <button type="submit" disabled={!!action.pending}>
        Save pin
      </button>
      {!isNew && (
        <button
          type="button"
          disabled={!!action.pending}
          onClick={async () => {
            if (
              await action.run(
                { type: 'PIN_DELETE', sceneId: scene.id, id: initial.id },
                'Deleting pin…',
              )
            )
              s.set({ selectedPin: null });
          }}
        >
          Delete pin
        </button>
      )}
      {action.pending && <p role="status">{action.pending}</p>}
      {action.error && <p role="alert">{action.error}</p>}
    </form>
  );
}

export function PinPanel() {
  const s = useTable(),
    action = useConfirmedAction();
  const [editing, setEditing] = useState(false);
  useEffect(() => setEditing(false), [s.selectedPin, s.viewSceneId, s.room.activeSceneId]);
  const scene = s.room.scenes[s.viewSceneId || s.room.activeSceneId];
  const isNew = s.selectedPin === ':new' && !!s.pinDraftPoint;
  const pin: ScenePin | undefined = isNew
    ? { id: crypto.randomUUID(), ...s.pinDraftPoint!, label: '', description: '', visibility: 'gm' }
    : s.selectedPin
      ? scene.pins?.[s.selectedPin]
      : undefined;
  if (!pin) return null;
  return (
    <section
      className="pin-panel"
      aria-label="Map pin details"
      key={`${scene.id}:${s.selectedPin}`}
    >
      <button
        type="button"
        aria-label="Close pin"
        onClick={() => {
          s.set({ selectedPin: null, pinDraftPoint: null });
          setEditing(false);
        }}
      >
        ×
      </button>
      {s.self?.role === 'gm' && (isNew || editing) ? (
        <PinEditor key={`${scene.id}:${s.selectedPin}`} initial={pin} isNew={isNew} />
      ) : (
        <>
          <h3>{pin.label}</h3>
          <p>{pin.description}</p>
          {s.self?.role === 'gm' && (
            <>
              <p>{pin.gmNote}</p>
              <button type="button" onClick={() => setEditing(true)}>
                Edit pin
              </button>
              {pin.destinationSceneId && (
                <button
                  type="button"
                  disabled={!!action.pending}
                  onClick={() =>
                    void action.run(
                      {
                        type: 'SCENE_CHANGE',
                        sceneId: pin.destinationSceneId!,
                        transition: s.transitionSettings,
                      },
                      'Opening destination…',
                    )
                  }
                >
                  Open destination
                </button>
              )}
            </>
          )}
          {action.pending && <p role="status">{action.pending}</p>}
          {action.error && <p role="alert">{action.error}</p>}
        </>
      )}
    </section>
  );
}
