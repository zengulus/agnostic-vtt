import { useState } from 'react';
import { useTable } from '../store.js';
import { send } from '../connection.js';
import { useConfirmedAction } from '../useConfirmedAction.js';
import type { Token } from '../../shared/model.js';

function BossEditor({ selected, sceneId }: { selected: Token; sceneId: string }) {
  const action = useConfirmedAction();
  const [title, setTitle] = useState(selected.boss?.title || selected.name);
  const [phase, setPhase] = useState(selected.boss?.phase || '');
  return (
    <>
      <p>Selected: {selected.name}</p>
      <label>
        Boss title <input maxLength={80} value={title} onChange={(e) => setTitle(e.target.value)} />
      </label>
      <label>
        Phase <input maxLength={48} value={phase} onChange={(e) => setPhase(e.target.value)} />
      </label>
      <button
        disabled={!!action.pending || !title.trim()}
        onClick={() =>
          void action.run(
            {
              type: 'BOSS_SET',
              sceneId,
              tokenId: selected.id,
              boss: { title: title.trim(), phase },
            },
            'Updating boss…',
          )
        }
      >
        Set boss / phase
      </button>
      {selected.boss && (
        <button
          disabled={!!action.pending}
          onClick={() =>
            void action.run(
              { type: 'BOSS_SET', sceneId, tokenId: selected.id, boss: null },
              'Removing boss…',
            )
          }
        >
          Remove boss
        </button>
      )}
      {action.pending && <span role="status">{action.pending}</span>}
      {action.error && <span role="alert">{action.error}</span>}
    </>
  );
}

export function BossAndCues() {
  const s = useTable();
  const scene = s.room.scenes[s.viewSceneId || s.room.activeSceneId];
  const selected = s.selected && scene.tokens[s.selected];
  const boss = Object.values(scene.tokens).find((t) => t.boss);
  const linked =
    boss?.characterId && boss.resourceId
      ? s.room.characters?.[boss.characterId]?.resources.find((r) => r.id === boss.resourceId)
      : undefined;
  const resource = boss?.resourceId
    ? linked && { value: linked.current, max: linked.max, label: linked.name }
    : boss?.resource;
  const gm = s.self?.role === 'gm';
  const [sending, setSending] = useState(false);
  return (
    <>
      {boss?.boss && (
        <div className="boss-hud" aria-label="Boss health">
          <strong>{boss.boss.title}</strong>
          {boss.boss.phase && <span>{boss.boss.phase}</span>}
          {resource ? (
            <>
              <progress
                value={Math.max(0, resource.value)}
                max={resource.max}
                aria-label={`${resource.label}: ${resource.value} of ${resource.max}`}
              />
              <small>
                {resource.label}: {resource.value} / {resource.max}
              </small>
            </>
          ) : (
            <small>No visible resource</small>
          )}
        </div>
      )}
      {gm && (
        <details className="boss-controls">
          <summary>Boss & dramatic cues</summary>
          {selected ? (
            <BossEditor key={selected.id} selected={selected} sceneId={scene.id} />
          ) : (
            <p>Select a visible token to designate the boss.</p>
          )}
          <p>Dramatic cues</p>
          {['PHASE TWO', 'THE CASTLE AWAKENS', 'VAMPIRE VANQUISHED'].map((text) => (
            <button
              key={text}
              onClick={() => {
                const id = send({ type: 'DRAMATIC_CUE', text });
                if (id) {
                  setSending(true);
                  setTimeout(() => setSending(false), 1000);
                }
              }}
            >
              {text}
            </button>
          ))}
          {sending && <span role="status">Sending cue…</span>}
        </details>
      )}
      {s.dramaticCue && (
        <div
          key={s.dramaticCue.id}
          className={`dramatic-cue${s.reducedMotion ? ' reduced' : ''}`}
          role="status"
        >
          {s.dramaticCue.text}
        </div>
      )}
    </>
  );
}
