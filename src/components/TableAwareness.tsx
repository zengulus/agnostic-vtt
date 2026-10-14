import { useState } from 'react';
import { useTable } from '../store.js';
import { AssetImage } from '../assets.js';
import { canControl, emptyTracker, type Token } from '../../shared/model.js';

export function focusCharacter(id: string) {
  const s = useTable.getState(),
    token = s.room.scenes[s.room.activeSceneId].tokens[id];
  const rect = document.querySelector('.tabletop canvas')?.getBoundingClientRect();
  if (!token || !rect) return;
  s.set({
    selected: id,
    selectedIds: [id],
    tool: 'select',
    dialog: null,
    camera: {
      ...s.camera,
      x: rect.width / 2 - token.x * s.camera.zoom,
      y: rect.height / 2 - token.y * s.camera.zoom,
    },
  });
}
function assigned(t: Token, id?: string) {
  return !!id && (t.owners.includes(id) || t.owners.includes('*'));
}
export function CharacterList() {
  const s = useTable(),
    scene = s.room.scenes[s.room.activeSceneId];
  const tokens = Object.values(scene.tokens).sort(
    (a, b) => Number(assigned(b, s.self?.id)) - Number(assigned(a, s.self?.id)),
  );
  const mine = tokens.filter((t) => assigned(t, s.self?.id));
  return (
    <div className="character-discovery">
      {s.self && (
        <p className="field-note">
          {mine.length
            ? 'My characters appear first.'
            : s.self.role === 'player'
              ? 'No character is assigned to you in this scene. Ask your GM to assign control or share a character.'
              : 'Assign player control in Edit token → Who can move it?'}
        </p>
      )}
      <div className="token-list">
        {tokens.map((t) => (
          <div className="character-row" key={t.id}>
            <button
              aria-label={t.name.replaceAll(' · ', ' ')}
              className={`token-list-item ${s.selected === t.id ? 'selected' : ''}`}
              onClick={() => s.set({ selected: t.id, selectedIds: [t.id], tool: 'select' })}
            >
              <AssetImage asset={t.image} alt="" style={{ borderColor: t.color }} />
              <span>
                {t.name.split(' · ')[0]}
                <small>
                  {t.visibility === 'gm'
                    ? 'GM only'
                    : t.owners.includes('*')
                      ? 'Shared control · everyone'
                      : t.owners.length > 1
                        ? `${assigned(t, s.self?.id) ? 'Yours · ' : ''}Shared control`
                        : assigned(t, s.self?.id)
                          ? 'Your character'
                          : t.name.split(' · ')[1] || 'GM assigns control'}
                </small>
              </span>
            </button>
            <button
              className="center-character"
              aria-label={`Center on ${t.name.split(' · ')[0]}`}
              title="Center on character"
              onClick={() => focusCharacter(t.id)}
            >
              ◎
            </button>
          </div>
        ))}
        {!tokens.length && <p className="field-note">No visible characters in this scene.</p>}
      </div>
    </div>
  );
}
export function FirstUseGuide() {
  const s = useTable(),
    key = `aether-first-use:${s.self?.id}:${s.self?.role}`;
  const [dismissed, setDismissed] = useState('');
  let stored = false;
  try {
    stored = localStorage.getItem(key) === 'dismissed';
  } catch {
    /* Optional local storage. */
  }
  if (!s.self || stored || dismissed === key) return null;
  return (
    <div className="first-use-guide" aria-label="Getting started">
      <div>
        <strong>
          {s.self.role === 'gm' ? 'Welcome, game master' : 'Your first turn at the table'}
        </strong>
        <button
          aria-label="Dismiss getting started"
          onClick={() => {
            setDismissed(key);
            try {
              localStorage.setItem(key, 'dismissed');
            } catch {
              /* Optional local storage. */
            }
          }}
        >
          ×
        </button>
      </div>
      <ol>
        <li>
          {s.self.role === 'gm'
            ? 'Choose a character; assign player control in Edit token.'
            : 'Find My characters in the library; ask your GM if none is assigned.'}
        </li>
        <li>Move a character you control: drag it or select it and use arrow keys.</li>
        <li>Roll with a favorite action or the Dice controls.</li>
      </ol>
      <button onClick={() => s.set({ dialog: 'library' })}>Find your character</button>
      <button onClick={() => s.set({ dialog: 'help' })}>Detailed table guide</button>
    </div>
  );
}
export function TurnAwareness() {
  const s = useTable(),
    tracker = s.room.tracker || emptyTracker(),
    scene = s.room.scenes[s.room.activeSceneId];
  const current = tracker.entries.find((e) => e.id === tracker.activeId);
  const index = tracker.entries.findIndex((e) => e.id === current?.id);
  const next =
    tracker.nextId !== undefined
      ? tracker.entries.find((e) => e.id === tracker.nextId)
      : s.self?.role === 'gm' && index >= 0 && tracker.entries.length > 1
        ? tracker.entries[(index + 1) % tracker.entries.length]
        : undefined;
  const token = current?.tokenId ? scene.tokens[current.tokenId] : undefined;
  const yours =
    token && s.self && assigned(token, s.self.id) && canControl(token, s.self.id, s.self.role);
  return (
    <div
      className={`turn-awareness ${yours ? 'your-turn' : ''}`}
      aria-label="Turn awareness"
      role="status"
    >
      <span>
        <small>Current</small>
        <strong>{current?.name || 'Awaiting participant'}</strong>
      </span>
      <span>
        <small>Up next</small>
        <strong>{next?.name || '—'}</strong>
      </span>
      {yours && (
        <strong>
          Your turn
          {token.owners.includes('*') || token.owners.length > 1 ? ' · shared control' : ''}
        </strong>
      )}
      {token && <button onClick={() => focusCharacter(token.id)}>Focus character</button>}
    </div>
  );
}
