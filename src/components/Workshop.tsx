import { FogActions } from './FogActions.js';
import { CharacterList, focusCharacter } from './TableAwareness.js';
import { useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  ChevronRight,
  Copy,
  Flag,
  Image,
  Plus,
  Save,
  Trash2,
  Undo2,
  Redo2,
} from 'lucide-react';
import { useTable } from '../store.js';
import { deleteImage, send } from '../connection.js';
import { AssetImage } from '../assets.js';
import {
  emptyTracker,
  zoneDigest,
  type Annotation,
  type Tracker,
  type Zone,
} from '../../shared/model.js';
import { useConfirmedAction } from '../useConfirmedAction.js';
import { TokenStatuses } from './TokenStatuses.js';
import { Encounters } from './Encounters.js';
import { ProximityEditor } from './ProximityEditor.js';
import { LightFields } from './LightFields.js';
import { LightingControls } from './Lighting.js';
import { PinList } from './Pins.js';
import { ScenePresentation } from './ScenePresentation.js';
import { useMediaQuery } from '../useMediaQuery.js';
import { lightSchema } from '../../shared/model.js';

export function HistoryControls() {
  const s = useTable();
  return s.self?.role === 'gm' ? (
    <div className="history-controls">
      <button
        aria-label="Undo"
        title={`Undo ${s.history.undoLabel} (Ctrl/Cmd+Z)`}
        disabled={!s.history.canUndo}
        onClick={() => send({ type: 'UNDO' })}
      >
        <Undo2 size={16} />
      </button>
      <button
        aria-label="Redo"
        title={`Redo ${s.history.redoLabel} (Ctrl/Cmd+Shift+Z)`}
        disabled={!s.history.canRedo}
        onClick={() => send({ type: 'REDO' })}
      >
        <Redo2 size={16} />
      </button>
    </div>
  ) : null;
}
export function ToolOptions({
  finishPolygon,
  clearDraft,
}: {
  finishPolygon: () => void;
  clearDraft: () => void;
}) {
  const s = useTable();
  const compact = useMediaQuery('(max-width: 620px)');
  const [lightX, setLightX] = useState(200),
    [lightY, setLightY] = useState(200);
  const placeAction = useConfirmedAction();
  if (!['light', 'wall', 'zone', 'fog', 'draw', 'text', 'erase', 'measure'].includes(s.tool))
    return null;
  return (
    <div className="tool-options" aria-label="Active tool options">
      {s.tool === 'light' && (
        <>
          <p>
            Click to place a light. For a directional beam, drag from its position to aim. Switch to
            Move to reposition it.
          </p>
          {compact ? (
            <details className="light-settings">
              <summary>Light settings · {s.lightDraft.name}</summary>
              <LightFields
                prefix="New light"
                value={s.lightDraft}
                onChange={(lightDraft) => s.set({ lightDraft })}
                showHint={false}
              />
            </details>
          ) : (
            <LightFields
              prefix="New light"
              value={s.lightDraft}
              onChange={(lightDraft) => s.set({ lightDraft })}
              showHint={false}
            />
          )}
          <details className="light-position">
            <summary>Place by coordinates</summary>
            <label>
              Map X{' '}
              <input
                aria-label="Light position X"
                type="number"
                value={lightX}
                onChange={(e) => setLightX(Number(e.target.value))}
              />
            </label>
            <label>
              Map Y{' '}
              <input
                aria-label="Light position Y"
                type="number"
                value={lightY}
                onChange={(e) => setLightY(Number(e.target.value))}
              />
            </label>
            <button
              type="button"
              disabled={
                !!placeAction.pending ||
                !s.lightDraft.name.trim() ||
                !lightSchema.safeParse(s.lightDraft.light).success ||
                !Number.isFinite(lightX) ||
                !Number.isFinite(lightY)
              }
              onClick={() => {
                const scene = s.room.scenes[s.viewSceneId || s.room.activeSceneId];
                void placeAction.run(
                  {
                    type: 'TOKEN_UPDATE',
                    sceneId: scene.id,
                    createOnly: true,
                    token: {
                      id: crypto.randomUUID(),
                      name: s.lightDraft.name.trim(),
                      hideLabel: true,
                      image: { kind: 'builtin', url: 'wisp.svg' },
                      x: lightX,
                      y: lightY,
                      size: 24,
                      rotation: 0,
                      color: s.lightDraft.light.color,
                      owners: [],
                      visibility: 'public',
                      light: { ...s.lightDraft.light },
                    },
                  },
                  'Placing light…',
                );
              }}
            >
              Place light
            </button>
            {placeAction.pending && <span role="status">{placeAction.pending}</span>}
            {placeAction.error && <span role="alert">{placeAction.error}</span>}
          </details>
        </>
      )}
      {s.tool === 'wall' && (
        <label>
          Wall type{' '}
          <select
            aria-label="Wall type"
            value={s.wallKind}
            onChange={(e) => s.set({ wallKind: e.target.value as typeof s.wallKind })}
          >
            <option value="wall">Opaque wall</option>
            <option value="door">Door</option>
            <option value="window">Window</option>
          </select>
          <small>Drag to draw. Windows and open doors do not block sight.</small>
        </label>
      )}
      {s.tool === 'zone' && (
        <>
          <label>
            Region name
            <input
              aria-label="New region name"
              maxLength={48}
              value={s.zoneLabel}
              onChange={(e) => s.set({ zoneLabel: e.target.value })}
            />
          </label>
          <label>
            Visibility
            <select
              aria-label="New region visibility"
              value={s.zoneVisibility}
              onChange={(e) => s.set({ zoneVisibility: e.target.value as 'public' | 'gm' })}
            >
              <option value="public">Party</option>
              <option value="gm">GM only</option>
            </select>
          </label>
          <label>
            Shape
            <select
              aria-label="Zone shape"
              value={s.zoneShape}
              onChange={(e) => {
                clearDraft();
                s.set({ zoneShape: e.target.value as typeof s.zoneShape });
              }}
            >
              {['rectangle', 'circle', 'polygon', 'line', 'cone'].map((v) => (
                <option key={v}>{v}</option>
              ))}
            </select>
          </label>
          <label>
            Colour
            <input
              type="color"
              value={s.drawColor}
              onChange={(e) => s.set({ drawColor: e.target.value })}
            />
          </label>
          <label className="check-label">
            <input
              type="checkbox"
              checked={s.zoneSnap}
              onChange={(e) => s.set({ zoneSnap: e.target.checked })}
            />
            Snap zone to grid
          </label>
        </>
      )}
      {s.tool === 'fog' && (
        <>
          <label>
            Fog action
            <select
              value={s.fogMode}
              onChange={(e) => {
                clearDraft();
                s.set({ fogMode: e.target.value as 'reveal' | 'conceal' });
              }}
            >
              <option value="reveal">Reveal</option>
              <option value="conceal">Conceal</option>
            </select>
          </label>
          <label>
            Fog shape
            <select
              value={s.fogShape}
              onChange={(e) => {
                clearDraft();
                s.set({ fogShape: e.target.value as typeof s.fogShape });
              }}
            >
              <option value="circle">Brush</option>
              <option value="rectangle">Rectangle</option>
              <option value="polygon">Polygon</option>
            </select>
          </label>
          {s.fogShape === 'circle' && (
            <label>
              Brush radius
              <input
                type="range"
                min={40}
                max={400}
                value={s.brushSize}
                onChange={(e) => s.set({ brushSize: Number(e.target.value) })}
              />
            </label>
          )}
        </>
      )}
      {(s.tool === 'draw' || s.tool === 'text') && (
        <>
          <label>
            Colour
            <input
              type="color"
              value={s.drawColor}
              onChange={(e) => s.set({ drawColor: e.target.value })}
            />
          </label>
          <label>
            Layer
            <select
              value={s.annotationVisibility}
              onChange={(e) => s.set({ annotationVisibility: e.target.value as 'public' | 'gm' })}
            >
              <option value="public">Party</option>
              <option value="gm">GM only</option>
            </select>
          </label>
          {s.tool === 'draw' ? (
            <label>
              Stroke width
              <input
                type="range"
                min={1}
                max={20}
                value={s.drawWidth}
                onChange={(e) => s.set({ drawWidth: Number(e.target.value) })}
              />
            </label>
          ) : (
            <label>
              Text
              <input
                aria-label="Annotation text"
                value={s.annotationText}
                onChange={(e) => s.set({ annotationText: e.target.value })}
                maxLength={300}
              />
            </label>
          )}
        </>
      )}
      {s.tool === 'measure' && (
        <label>
          Measurement
          <select
            value={s.measurementShape}
            onChange={(e) => {
              clearDraft();
              s.set({ measurementShape: e.target.value as typeof s.measurementShape });
            }}
          >
            {['distance', 'path', 'radius', 'cone', 'area'].map((v) => (
              <option key={v}>{v}</option>
            ))}
          </select>
        </label>
      )}
      {s.tool === 'erase' && (
        <>
          <label>
            Eraser radius
            <input
              type="range"
              min={4}
              max={160}
              value={s.eraserSize}
              onChange={(e) => s.set({ eraserSize: Number(e.target.value) })}
            />
          </label>
          <span>Drag to erase whole drawings, text or zones. Undo restores the gesture.</span>
        </>
      )}
      {((s.tool === 'fog' && s.fogShape === 'polygon') ||
        (s.tool === 'zone' && s.zoneShape === 'polygon') ||
        (s.tool === 'measure' && s.measurementShape === 'path')) && (
        <button className="subtle-button" onClick={finishPolygon}>
          Finish · Enter
          <ChevronRight size={12} />
        </button>
      )}
      <button className="subtle-button" onClick={clearDraft}>
        Clear draft
      </button>
    </div>
  );
}
export function TokenLibraryDialog() {
  const s = useTable(),
    scene = s.room.scenes[s.viewSceneId || s.room.activeSceneId],
    selected = s.selected ? scene.tokens[s.selected] : null,
    gm = s.self?.role === 'gm';
  const sceneAction = useConfirmedAction();
  return (
    <>
      <div className="library-actions">
        <button className="subtle-button" onClick={() => s.set({ dialog: 'map' })}>
          Scene settings
        </button>
        <button className="subtle-button" onClick={() => s.set({ dialog: 'grid' })}>
          Grid settings
        </button>
        {gm && (
          <>
            <button className="subtle-button" onClick={() => s.set({ dialog: 'new-scene' })}>
              New Scene
            </button>
            <button
              className="subtle-button"
              onClick={() => s.set({ dialog: 'token', selected: null, selectedIds: [] })}
            >
              New token
            </button>
            <button className="subtle-button" onClick={() => s.set({ dialog: 'assets' })}>
              Manage images
            </button>
            <button className="subtle-button" onClick={() => s.set({ dialog: 'objects' })}>
              Regions & annotations
            </button>
            <FogActions />
          </>
        )}
      </div>
      <h3>My characters & scene characters</h3>
      <CharacterList />
      <PinList />
      <LightingControls key={scene.id} scene={scene} />
      <ScenePresentation />
      <div className="scene-switcher">
        {Object.values(s.room.scenes).map((sc) => (
          <button
            key={sc.id}
            className="subtle-button"
            disabled={!gm || sc.id === s.room.activeSceneId || !!sceneAction.pending}
            onClick={async () => {
              if (
                (await sceneAction.run(
                  { type: 'SCENE_CHANGE', sceneId: sc.id, transition: s.transitionSettings },
                  `Opening ${sc.name}…`,
                )) &&
                useTable.getState().room.id === s.room.id &&
                useTable.getState().sessionNonce === s.sessionNonce &&
                useTable.getState().dialog === 'library'
              )
                s.set({ dialog: null });
            }}
          >
            {sc.name}
          </button>
        ))}
      </div>
      {sceneAction.pending && <p role="status">{sceneAction.pending}</p>}
      {sceneAction.error && (
        <p role="alert" className="form-error">
          {sceneAction.error}
        </p>
      )}
      <HistoryControls />
      <Encounters />
      {gm && selected && (
        <button
          className="primary"
          onClick={() =>
            send({ type: 'LIBRARY_SAVE', token: { ...selected, id: crypto.randomUUID() } })
          }
        >
          <Save size={15} />
          Save {selected.name.split(' · ')[0]} as a template
        </button>
      )}
      <div className="saved-library">
        {Object.values(s.room.tokenLibrary || {}).map((t) => (
          <div className="saved-token" key={t.id}>
            <AssetImage asset={t.image} alt="" />
            <span>
              <strong>{t.name}</strong>
              <small>
                {t.visibility === 'gm'
                  ? 'GM only'
                  : `${t.size}px · ${t.statuses?.length || 0} statuses`}
              </small>
            </span>
            {gm && (
              <>
                <button
                  aria-label={`Place ${t.name}`}
                  title="Place another instance"
                  onClick={() => {
                    const token = {
                      ...t,
                      id: crypto.randomUUID(),
                      groupId: undefined,
                      x: scene.width / 2,
                      y: scene.height / 2,
                    };
                    send({ type: 'TOKEN_UPDATE', sceneId: scene.id, token });
                    s.set({ dialog: null, selected: token.id, selectedIds: [token.id] });
                  }}
                >
                  <Plus size={17} />
                </button>
                <button
                  aria-label={`Delete template ${t.name}`}
                  onClick={() => send({ type: 'LIBRARY_DELETE', id: t.id })}
                >
                  <Trash2 size={15} />
                </button>
              </>
            )}
          </div>
        ))}
      </div>
      {!Object.keys(s.room.tokenLibrary || {}).length && (
        <p className="field-note">
          Select a token on the map, then save it here. You can also save a template while editing a
          token.
        </p>
      )}
    </>
  );
}
export function AssetManagerDialog() {
  const s = useTable(),
    [error, setError] = useState(''),
    [busy, setBusy] = useState('');
  const mapAction = useConfirmedAction();
  const assets = Object.values(s.room.assets || {}),
    scene = s.room.scenes[s.viewSceneId || s.room.activeSceneId];
  return (
    <>
      <p className="modal-description">
        Uploaded images are optimized WebP files in your campaign’s private storage. External links
        remain on their original host.
      </p>
      <div className="asset-summary">
        {assets.length} / 64 images ·{' '}
        {(assets.reduce((n, a) => n + a.bytes, 0) / 1048576).toFixed(1)} / 64 MiB
      </div>
      <div className="asset-gallery">
        {assets.map((a) => (
          <div key={a.id}>
            <AssetImage asset={{ kind: 'uploaded', url: a.id }} alt={a.name} />
            <strong>{a.name}</strong>
            <small>
              {a.width} × {a.height} · {Math.ceil(a.bytes / 1024)} KiB
            </small>
            <div>
              <button
                aria-label={`Use ${a.name} as map`}
                disabled={!!mapAction.pending || !!busy}
                onClick={async () => {
                  const confirmed = await mapAction.run(
                    {
                      type: 'SCENE_CONFIG',
                      sceneId: scene.id,
                      name: scene.name,
                      map: { kind: 'uploaded', url: a.id },
                      width: Math.max(200, a.width),
                      height: Math.max(200, a.height),
                      create: false,
                    },
                    'Updating map…',
                  );
                  const current = useTable.getState();
                  if (
                    confirmed &&
                    current.dialog === 'assets' &&
                    current.room.id === s.room.id &&
                    current.sessionNonce === s.sessionNonce
                  )
                    current.set({ dialog: null, fitNonce: current.fitNonce + 1 });
                }}
              >
                <Image size={13} />
                As map
              </button>
              <button
                aria-label={`Delete image ${a.name}`}
                disabled={!!busy || !!mapAction.pending}
                onClick={async () => {
                  setBusy(a.id);
                  setError('');
                  try {
                    await deleteImage(a.id);
                  } catch (e) {
                    setError((e as Error).message);
                  } finally {
                    setBusy('');
                  }
                }}
              >
                <Trash2 size={13} />
              </button>
            </div>
          </div>
        ))}
      </div>
      {busy && <p role="status">Deleting image…</p>}
      {mapAction.pending && <p role="status">{mapAction.pending}</p>}
      {mapAction.error && (
        <p role="alert" className="form-error">
          {mapAction.error}
        </p>
      )}
      {!assets.length && (
        <p className="field-note">
          Choose Upload image in a map or token dialog to add your first asset.
        </p>
      )}
      <div className="external-references">
        <span className="eyebrow">EXTERNAL MAP REFERENCES</span>
        {Object.values(s.room.scenes)
          .filter((sc) => sc.map.kind === 'external')
          .map((sc) => (
            <p key={sc.id}>
              {sc.name}
              <small>{sc.map.url}</small>
            </p>
          ))}
      </div>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </>
  );
}
export function ObjectsDialog() {
  const s = useTable(),
    scene = s.room.scenes[s.viewSceneId || s.room.activeSceneId],
    gm = s.self?.role === 'gm',
    [editing, setEditing] = useState<Zone | Annotation | null>(null),
    [tags, setTags] = useState(''),
    [expected, setExpected] = useState('');
  const action = useConfirmedAction();
  const zone = editing && 'shape' in editing ? editing : null,
    annotation = editing && 'kind' in editing ? editing : null;
  const reshape = (z: Zone, x: number, y: number, width: number, height: number): Zone => ({
    ...z,
    x,
    y,
    width,
    height,
    points: z.points?.map((p) => ({
      x: x + ((p.x - z.x) * width) / z.width,
      y: y + ((p.y - z.y) * height) / z.height,
    })),
  });
  return (
    <>
      <p className="modal-description">
        Manage the scene’s shared regions and drawing layers. Labels and tags have no built-in game
        rules.
      </p>
      <div className="object-list">
        {Object.values(scene.zones).map((z) => (
          <button
            key={z.id}
            disabled={!!action.pending}
            onClick={() => {
              setEditing(z);
              setExpected(zoneDigest(z));
              setTags((z.tags || []).join(', '));
            }}
          >
            <span style={{ background: z.color }} />
            {z.label || 'Unnamed region'}
            <small>
              {z.shape}
              {z.note ? ` · ${z.note}` : ''}
            </small>
          </button>
        ))}
        {Object.values(scene.annotations || {}).map((a) => (
          <button key={a.id} disabled={!!action.pending} onClick={() => setEditing(a)}>
            <span style={{ background: a.color }} />
            {a.kind === 'text' ? a.text.slice(0, 30) : 'Freehand drawing'}
            <small>{a.visibility === 'gm' ? 'GM only' : a.kind}</small>
          </button>
        ))}
      </div>
      {editing && (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (!gm) return;
            if (
              zone &&
              (await action.run(
                {
                  type: 'ZONE_UPDATE',
                  sceneId: scene.id,
                  expected,
                  zone: {
                    ...zone,
                    tags: tags
                      .split(',')
                      .map((t) => t.trim().slice(0, 24))
                      .filter(Boolean)
                      .slice(0, 10),
                  },
                },
                'Saving region…',
              ))
            )
              setEditing(null);
            if (
              annotation &&
              (await action.run(
                { type: 'ANNOTATION_UPDATE', sceneId: scene.id, annotation },
                'Saving drawing…',
              ))
            )
              setEditing(null);
          }}
        >
          <fieldset
            disabled={!!action.pending}
            style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}
          >
            {zone && (
              <>
                <label>
                  Region label
                  <input
                    value={zone.label}
                    maxLength={48}
                    onChange={(e) => setEditing({ ...zone, label: e.target.value })}
                  />
                </label>
                <label>
                  Tags · comma separated
                  <input value={tags} onChange={(e) => setTags(e.target.value)} maxLength={240} />
                </label>
                <label>
                  Duration or note
                  <input
                    value={zone.note || ''}
                    maxLength={120}
                    onChange={(e) => setEditing({ ...zone, note: e.target.value })}
                  />
                </label>
                <label>
                  Visibility
                  <select
                    value={zone.visibility || 'public'}
                    onChange={(e) =>
                      setEditing({ ...zone, visibility: e.target.value as 'public' | 'gm' })
                    }
                  >
                    <option value="public">Party</option>
                    <option value="gm">GM only</option>
                  </select>
                </label>
                <ProximityEditor
                  value={zone.proximity}
                  onChange={(proximity) => setEditing({ ...zone, proximity })}
                />
                <label>
                  Follow token
                  <select
                    aria-label="Region follows token"
                    value={zone.anchorTokenId || ''}
                    onChange={(e) =>
                      setEditing({ ...zone, anchorTokenId: e.target.value || undefined })
                    }
                  >
                    <option value="">Fixed region</option>
                    {Object.values(scene.tokens).map((token) => (
                      <option key={token.id} value={token.id}>
                        {token.name}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="form-row">
                  {(['x', 'y', 'width', 'height'] as const).map((key) => (
                    <label key={key}>
                      {key}
                      <input
                        aria-label={`Region ${key}`}
                        type="number"
                        step="any"
                        min={key === 'width' || key === 'height' ? 1 : undefined}
                        max={key === 'width' || key === 'height' ? 5000 : undefined}
                        value={zone[key]}
                        onChange={(e) => {
                          const value = Number(e.target.value);
                          if (
                            !Number.isFinite(value) ||
                            ((key === 'width' || key === 'height') && (value < 1 || value > 5000))
                          )
                            return;
                          const values = {
                            x: zone.x,
                            y: zone.y,
                            width: zone.width,
                            height: zone.height,
                            [key]: value,
                          };
                          setEditing(
                            reshape(zone, values.x, values.y, values.width, values.height),
                          );
                        }}
                      />
                    </label>
                  ))}
                </div>
                <label>
                  Expires on
                  <select
                    aria-label="Region expires on"
                    value={zone.duration?.participantId || ''}
                    onChange={(e) =>
                      setEditing({
                        ...zone,
                        duration: e.target.value
                          ? {
                              participantId: e.target.value,
                              remaining: zone.duration?.remaining || 1,
                              phase: zone.duration?.phase || 'start',
                            }
                          : undefined,
                      })
                    }
                  >
                    <option value="">Manually</option>
                    {(s.room.tracker?.entries || []).map((entry) => (
                      <option value={entry.id} key={entry.id}>
                        {entry.name}
                      </option>
                    ))}
                  </select>
                </label>
                {zone.duration && (
                  <div className="form-row">
                    <label>
                      Rounds
                      <input
                        aria-label="Region rounds"
                        type="number"
                        min={1}
                        max={10000}
                        value={zone.duration.remaining}
                        onChange={(e) =>
                          setEditing({
                            ...zone,
                            duration: { ...zone.duration!, remaining: Number(e.target.value) },
                          })
                        }
                      />
                    </label>
                    <label>
                      Turn phase
                      <select
                        aria-label="Region turn phase"
                        value={zone.duration.phase}
                        onChange={(e) =>
                          setEditing({
                            ...zone,
                            duration: {
                              ...zone.duration!,
                              phase: e.target.value as 'start' | 'end',
                            },
                          })
                        }
                      >
                        <option value="start">Start</option>
                        <option value="end">End</option>
                      </select>
                    </label>
                  </div>
                )}
                <label>
                  Opacity
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.05}
                    value={zone.opacity ?? 0.2}
                    onChange={(e) => setEditing({ ...zone, opacity: Number(e.target.value) })}
                  />
                </label>
              </>
            )}
            {annotation && (
              <>
                <label>
                  Text
                  <input
                    value={annotation.text}
                    maxLength={300}
                    onChange={(e) => setEditing({ ...annotation, text: e.target.value })}
                  />
                </label>
                <label>
                  Visibility
                  <select
                    value={annotation.visibility}
                    onChange={(e) =>
                      setEditing({ ...annotation, visibility: e.target.value as 'public' | 'gm' })
                    }
                  >
                    <option value="public">Party</option>
                    <option value="gm">GM only</option>
                  </select>
                </label>
              </>
            )}
            <label>
              Colour
              <input
                type="color"
                value={editing.color}
                onChange={(e) => setEditing({ ...editing, color: e.target.value })}
              />
            </label>
            {gm && (
              <div className="form-row">
                <button className="primary modal-submit">
                  <Save size={15} />
                  Save object
                </button>
                <button
                  type="button"
                  className="modal-submit"
                  onClick={async () => {
                    const request = zone
                      ? { type: 'ZONE_DELETE' as const, sceneId: scene.id, id: zone.id }
                      : annotation
                        ? {
                            type: 'ANNOTATION_DELETE' as const,
                            sceneId: scene.id,
                            id: annotation.id,
                          }
                        : null;
                    if (request && (await action.run(request, 'Deleting object…')))
                      setEditing(null);
                  }}
                >
                  <Trash2 size={15} />
                  Delete
                </button>
              </div>
            )}
          </fieldset>
          {action.pending && <p role="status">{action.pending}</p>}
          {action.error && (
            <p role="alert" className="form-error">
              {action.error}
            </p>
          )}
        </form>
      )}
      {!Object.keys(scene.zones).length && !Object.keys(scene.annotations || {}).length && (
        <p className="field-note">Use the zone, pen, or text tools to add an object.</p>
      )}
    </>
  );
}
export function TrackerPanel() {
  const s = useTable(),
    tracker = s.room.tracker || emptyTracker(),
    gm = s.self?.role === 'gm',
    [name, setName] = useState(''),
    [value, setValue] = useState(0),
    [hidden, setHidden] = useState(false),
    [editing, setEditing] = useState<string | null>(null),
    [tokenId, setTokenId] = useState<string | undefined>();
  const action = useConfirmedAction();
  const scene = s.room.scenes[s.viewSceneId || s.room.activeSceneId],
    selected = s.selected ? scene.tokens[s.selected] : undefined;
  const update = (next: Tracker) =>
    action.run({ type: 'TRACKER_UPDATE', tracker: next }, 'Updating turns…');
  const shift = (id: string, delta: number) => {
    const entries = [...tracker.entries],
      i = entries.findIndex((e) => e.id === id),
      j = i + delta;
    if (j < 0 || j >= entries.length) return;
    [entries[i], entries[j]] = [entries[j], entries[i]];
    update({ ...tracker, entries, order: 'manual' });
  };
  return (
    <div className="tracker-panel">
      {action.pending && <p role="status">{action.pending}</p>}
      {action.error && (
        <p role="alert" className="form-error">
          {action.error}
        </p>
      )}
      <fieldset
        disabled={!!action.pending}
        style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}
      >
        <div className="tracker-heading">
          <Flag size={16} />
          <span>Round {tracker.round}</span>
          {gm && (
            <div>
              <button
                aria-label="Previous turn"
                disabled={!tracker.entries.length}
                onClick={() =>
                  void action.run({ type: 'TRACKER_ADVANCE', direction: -1 }, 'Changing turn…')
                }
              >
                <ArrowUp size={15} />
              </button>
              <button
                aria-label="Next turn"
                disabled={!tracker.entries.length}
                onClick={() =>
                  void action.run({ type: 'TRACKER_ADVANCE', direction: 1 }, 'Changing turn…')
                }
              >
                <ChevronRight size={17} />
              </button>
            </div>
          )}
        </div>
        {gm && (
          <label>
            Ordering
            <select
              aria-label="Tracker ordering"
              value={tracker.order}
              onChange={(e) => {
                const order = e.target.value as Tracker['order'],
                  entries = [...tracker.entries];
                if (order !== 'manual')
                  entries.sort((a, b) =>
                    order === 'descending' ? b.value - a.value : a.value - b.value,
                  );
                update({ ...tracker, order, entries });
              }}
            >
              <option value="manual">Manual</option>
              <option value="descending">Highest first</option>
              <option value="ascending">Lowest first</option>
            </select>
          </label>
        )}
        <div className="tracker-entries">
          {tracker.entries.map((entry) => (
            <div key={entry.id} className={tracker.activeId === entry.id ? 'active' : ''}>
              <span className="tracker-value">{entry.value}</span>
              <span>
                {entry.name}
                <small>
                  {entry.hidden
                    ? 'GM only'
                    : tracker.activeId === entry.id
                      ? 'Current participant'
                      : ''}
                </small>
                {entry.tokenId && scene.tokens[entry.tokenId] && (
                  <TokenStatuses
                    key={entry.tokenId}
                    token={scene.tokens[entry.tokenId]}
                    sceneId={scene.id}
                  />
                )}
              </span>
              {entry.tokenId && scene.tokens[entry.tokenId] && (
                <button
                  aria-label={`Focus ${entry.name}`}
                  onClick={() => focusCharacter(entry.tokenId!)}
                >
                  ◎
                </button>
              )}
              {gm && (
                <div>
                  <button aria-label={`Move ${entry.name} up`} onClick={() => shift(entry.id, -1)}>
                    <ArrowUp size={11} />
                  </button>
                  <button aria-label={`Move ${entry.name} down`} onClick={() => shift(entry.id, 1)}>
                    <ArrowDown size={11} />
                  </button>
                  <button
                    aria-label={`Edit ${entry.name}`}
                    onClick={() => {
                      setEditing(entry.id);
                      setName(entry.name);
                      setValue(entry.value);
                      setHidden(entry.hidden);
                      setTokenId(entry.tokenId);
                    }}
                  >
                    <Copy size={11} />
                  </button>
                  <button
                    aria-label={`Remove ${entry.name}`}
                    onClick={() => {
                      const entries = tracker.entries.filter((e) => e.id !== entry.id);
                      update({
                        ...tracker,
                        entries,
                        activeId:
                          tracker.activeId === entry.id ? entries[0]?.id || null : tracker.activeId,
                      });
                    }}
                  >
                    <Trash2 size={11} />
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
        {!tracker.entries.length && <p className="field-note">No participants yet.</p>}
        {gm && (
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const id = editing || crypto.randomUUID(),
                entry = {
                  id,
                  name,
                  value,
                  hidden: hidden || (!!tokenId && scene.tokens[tokenId]?.visibility === 'gm'),
                  tokenId,
                },
                entries = editing
                  ? tracker.entries.map((t) => (t.id === id ? entry : t))
                  : [...tracker.entries, entry];
              if (tracker.order !== 'manual')
                entries.sort((a, b) =>
                  tracker.order === 'descending' ? b.value - a.value : a.value - b.value,
                );
              if (!(await update({ ...tracker, entries, activeId: tracker.activeId || id })))
                return;
              setEditing(null);
              setName('');
              setValue(0);
              setHidden(false);
              setTokenId(undefined);
            }}
          >
            <label>
              Participant
              <input
                aria-label="Participant name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                maxLength={48}
              />
            </label>
            <div className="form-row">
              <label>
                Value
                <input
                  aria-label="Participant value"
                  type="number"
                  value={value}
                  onChange={(e) => setValue(Number(e.target.value))}
                  min={-10000}
                  max={10000}
                />
              </label>
              <label className="check-label">
                <input
                  type="checkbox"
                  checked={hidden}
                  onChange={(e) => setHidden(e.target.checked)}
                />
                Hidden
              </label>
            </div>
            <button className="subtle-button">
              <Plus size={14} />
              {editing ? 'Save participant' : 'Add participant'}
            </button>
            {tokenId && (
              <p className="field-note">
                Linked to {scene.tokens[tokenId]?.name || 'removed character'}.{' '}
                {hidden || scene.tokens[tokenId]?.visibility === 'gm'
                  ? 'GM only · hidden from players'
                  : 'Visible only while the character is visible to players.'}
              </p>
            )}
            {selected && (
              <button
                type="button"
                className="subtle-button"
                onClick={() => {
                  setName(selected.name.split(' · ')[0]);
                  setTokenId(selected.id);
                  setHidden((wasHidden) => wasHidden || selected.visibility === 'gm');
                }}
              >
                Use selected token
              </button>
            )}
            {!!s.selectedIds.length && (
              <details className="tracker-add-selected">
                <summary>Add selected characters to turns</summary>
                <ul>
                  {s.selectedIds
                    .flatMap((id) => (scene.tokens[id] ? [scene.tokens[id]] : []))
                    .map((t) => (
                      <li key={t.id}>
                        {t.name} ·{' '}
                        {t.visibility === 'gm' ? 'GM only' : 'Visible when character is visible'}
                      </li>
                    ))}
                </ul>
                <button
                  type="button"
                  onClick={() => {
                    const additions = s.selectedIds.flatMap((id) =>
                      scene.tokens[id] && !tracker.entries.some((e) => e.tokenId === id)
                        ? [
                            {
                              id: crypto.randomUUID(),
                              tokenId: id,
                              name: scene.tokens[id].name.split(' · ')[0],
                              value: 0,
                              hidden: scene.tokens[id].visibility === 'gm',
                            },
                          ]
                        : [],
                    );
                    const entries = [...tracker.entries, ...additions];
                    if (tracker.order !== 'manual')
                      entries.sort((a, b) =>
                        tracker.order === 'descending' ? b.value - a.value : a.value - b.value,
                      );
                    update({
                      ...tracker,
                      entries,
                      activeId: tracker.activeId || entries[0]?.id || null,
                    });
                  }}
                >
                  Add selected to tracker
                </button>
              </details>
            )}
          </form>
        )}
      </fieldset>
    </div>
  );
}
