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
import { emptyTracker, type Annotation, type Tracker, type Zone } from '../../shared/model.js';

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
  if (!['zone', 'fog', 'draw', 'text', 'measure'].includes(s.tool)) return null;
  return (
    <div className="tool-options" aria-label="Active tool options">
      {s.tool === 'zone' && (
        <>
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
    scene = s.room.scenes[s.room.activeSceneId],
    selected = s.selected ? scene.tokens[s.selected] : null,
    gm = s.self?.role === 'gm';
  return (
    <>
      <p className="modal-description">
        Keep reusable portraits, ownership, resources and statuses with your campaign. Place as many
        independent instances as you need.
      </p>
      <div className="library-actions">
        <button className="subtle-button" onClick={() => s.set({ dialog: 'map' })}>
          Scene settings
        </button>
        <button className="subtle-button" onClick={() => s.set({ dialog: 'grid' })}>
          Grid settings
        </button>
        {gm && (
          <>
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
            <button
              className="subtle-button"
              onClick={() =>
                send({
                  type: 'FOG_UPDATE',
                  sceneId: scene.id,
                  fog: { enabled: !scene.fog.enabled, revealed: [] },
                })
              }
            >
              {scene.fog.enabled ? 'Clear all fog' : 'Cover scene with fog'}
            </button>
          </>
        )}
      </div>
      <div className="scene-switcher">
        {Object.values(s.room.scenes).map((sc) => (
          <button
            key={sc.id}
            className="subtle-button"
            disabled={!gm || sc.id === scene.id}
            onClick={() => {
              send({ type: 'SCENE_CHANGE', sceneId: sc.id });
              s.set({ dialog: null });
            }}
          >
            {sc.name}
          </button>
        ))}
      </div>
      <HistoryControls />
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
  const assets = Object.values(s.room.assets || {}),
    scene = s.room.scenes[s.room.activeSceneId];
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
                onClick={() => {
                  send({
                    type: 'SCENE_CONFIG',
                    sceneId: scene.id,
                    name: scene.name,
                    map: { kind: 'uploaded', url: a.id },
                    width: Math.max(200, a.width),
                    height: Math.max(200, a.height),
                    create: false,
                  });
                  s.set({ dialog: null, fitNonce: s.fitNonce + 1 });
                }}
              >
                <Image size={13} />
                As map
              </button>
              <button
                aria-label={`Delete image ${a.name}`}
                disabled={!!busy}
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
    scene = s.room.scenes[s.room.activeSceneId],
    gm = s.self?.role === 'gm',
    [editing, setEditing] = useState<Zone | Annotation | null>(null),
    [tags, setTags] = useState('');
  const zone = editing && 'shape' in editing ? editing : null,
    annotation = editing && 'kind' in editing ? editing : null;
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
            onClick={() => {
              setEditing(z);
              setTags((z.tags || []).join(', '));
            }}
          >
            <span style={{ background: z.color }} />
            {z.label || 'Unnamed region'}
            <small>{z.shape}</small>
          </button>
        ))}
        {Object.values(scene.annotations || {}).map((a) => (
          <button key={a.id} onClick={() => setEditing(a)}>
            <span style={{ background: a.color }} />
            {a.kind === 'text' ? a.text.slice(0, 30) : 'Freehand drawing'}
            <small>{a.visibility === 'gm' ? 'GM only' : a.kind}</small>
          </button>
        ))}
      </div>
      {editing && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!gm) return;
            if (zone)
              send({
                type: 'ZONE_UPDATE',
                sceneId: scene.id,
                zone: {
                  ...zone,
                  tags: tags
                    .split(',')
                    .map((t) => t.trim().slice(0, 24))
                    .filter(Boolean)
                    .slice(0, 10),
                },
              });
            if (annotation) send({ type: 'ANNOTATION_UPDATE', sceneId: scene.id, annotation });
            setEditing(null);
          }}
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
                onClick={() => {
                  if (zone) send({ type: 'ZONE_DELETE', sceneId: scene.id, id: zone.id });
                  if (annotation)
                    send({ type: 'ANNOTATION_DELETE', sceneId: scene.id, id: annotation.id });
                  setEditing(null);
                }}
              >
                <Trash2 size={15} />
                Delete
              </button>
            </div>
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
    [editing, setEditing] = useState<string | null>(null);
  const update = (next: Tracker) => send({ type: 'TRACKER_UPDATE', tracker: next });
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
      <div className="tracker-heading">
        <Flag size={16} />
        <span>Round {tracker.round}</span>
        {gm && (
          <div>
            <button
              aria-label="Previous turn"
              disabled={!tracker.entries.length}
              onClick={() => send({ type: 'TRACKER_ADVANCE', direction: -1 })}
            >
              <ArrowUp size={15} />
            </button>
            <button
              aria-label="Next turn"
              disabled={!tracker.entries.length}
              onClick={() => send({ type: 'TRACKER_ADVANCE', direction: 1 })}
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
            </span>
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
      {!tracker.entries.length && (
        <p className="field-note">
          Add participants and choose the order for your game. This tracker works for turns,
          spotlight order, or any numbered sequence.
        </p>
      )}
      {gm && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const id = editing || crypto.randomUUID(),
              entry = { id, name, value, hidden },
              entries = editing
                ? tracker.entries.map((t) => (t.id === id ? entry : t))
                : [...tracker.entries, entry];
            if (tracker.order !== 'manual')
              entries.sort((a, b) =>
                tracker.order === 'descending' ? b.value - a.value : a.value - b.value,
              );
            update({ ...tracker, entries, activeId: tracker.activeId || id });
            setEditing(null);
            setName('');
            setValue(0);
            setHidden(false);
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
          {s.selected && (
            <button
              type="button"
              className="subtle-button"
              onClick={() =>
                setName(
                  s.room.scenes[s.room.activeSceneId].tokens[s.selected!].name.split(' · ')[0],
                )
              }
            >
              Use selected token
            </button>
          )}
        </form>
      )}
    </div>
  );
}
