import { useState } from 'react';
import { handoutDigest, type Handout } from '../../shared/model.js';
import { send } from '../connection.js';
import { useTable } from '../store.js';
import { useConfirmedAction } from '../useConfirmedAction.js';

const blank = (kind: 'handout' | 'quest' | 'recap' = 'handout'): Handout => ({
  kind,
  ...(kind === 'quest' ? { status: 'active' as const } : {}),
  id: crypto.randomUUID(),
  title: '',
  text: '',
  imageUrl: '',
  gmNote: '',
  shared: false,
});

function HandoutEditor({
  initial,
  existing,
  close,
}: {
  initial: Handout;
  existing: boolean;
  close: () => void;
}) {
  const [draft, setDraft] = useState(initial);
  const action = useConfirmedAction();
  const update = (changes: Partial<Handout>) => setDraft((value) => ({ ...value, ...changes }));
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void action
          .run(
            {
              type: 'HANDOUT_SAVE',
              handout: draft,
              digest: existing ? handoutDigest(initial) : undefined,
            },
            'Saving handout…',
          )
          .then((ok) => {
            if (ok) close();
          });
      }}
    >
      <label>
        Title{' '}
        <input
          required
          maxLength={120}
          value={draft.title}
          onChange={(e) => update({ title: e.target.value })}
        />
      </label>
      <label>
        Text{' '}
        <textarea
          maxLength={8000}
          value={draft.text}
          onChange={(e) => update({ text: e.target.value })}
        />
      </label>
      {draft.kind === 'quest' && (
        <label>
          Status{' '}
          <select
            value={draft.status || 'active'}
            onChange={(e) =>
              update({ status: e.target.value as 'active' | 'completed' | 'paused' })
            }
          >
            <option value="active">Active</option>
            <option value="completed">Completed</option>
            <option value="paused">Paused</option>
          </select>
        </label>
      )}
      <label>
        Image URL (public HTTPS){' '}
        <input
          type="url"
          maxLength={2048}
          value={draft.imageUrl}
          onChange={(e) => update({ imageUrl: e.target.value })}
        />
      </label>
      <label>
        GM-only note{' '}
        <textarea
          maxLength={4000}
          value={draft.gmNote}
          onChange={(e) => update({ gmNote: e.target.value })}
        />
      </label>
      <label>
        <input
          type="checkbox"
          checked={draft.shared}
          onChange={(e) => update({ shared: e.target.checked })}
        />{' '}
        Share with players
      </label>
      <div className="library-actions">
        <button
          className="primary"
          disabled={!!action.pending || !draft.title.trim()}
          type="submit"
        >
          Save handout
        </button>
        <button type="button" disabled={!!action.pending} onClick={close}>
          Cancel
        </button>
        {existing && (
          <button
            type="button"
            disabled={!!action.pending}
            onClick={() => {
              if (window.confirm(`Delete “${initial.title}”?`))
                void action
                  .run(
                    { type: 'HANDOUT_DELETE', id: initial.id, digest: handoutDigest(initial) },
                    'Deleting handout…',
                  )
                  .then((ok) => {
                    if (ok) close();
                  });
            }}
          >
            Delete
          </button>
        )}
      </div>
      {action.pending && <p role="status">{action.pending}</p>}
      {action.error && <p role="alert">{action.error}</p>}
    </form>
  );
}

export function Handouts() {
  const s = useTable();
  const gm = s.self?.role === 'gm';
  const [editing, setEditing] = useState<{ handout: Handout; existing: boolean } | null>(null);
  const handouts = Object.values(s.room.handouts || {});
  const [show, setShow] = useState<'all' | 'handout' | 'quest' | 'recap'>('all');
  const visible = handouts.filter((h) => show === 'all' || (h.kind || 'handout') === show);
  return (
    <details className="handout-library">
      <summary>Handouts ({handouts.length})</summary>
      {gm && !editing && (
        <button type="button" onClick={() => setEditing({ handout: blank(), existing: false })}>
          New handout
        </button>
      )}
      {gm && !editing && (
        <>
          <button
            type="button"
            onClick={() => setEditing({ handout: blank('quest'), existing: false })}
          >
            New quest
          </button>{' '}
          <button
            type="button"
            onClick={() => setEditing({ handout: blank('recap'), existing: false })}
          >
            New recap
          </button>
        </>
      )}
      <label>
        Show{' '}
        <select
          aria-label="Handout category"
          value={show}
          onChange={(e) => setShow(e.target.value as typeof show)}
        >
          <option value="all">All</option>
          <option value="handout">Handouts</option>
          <option value="quest">Quests</option>
          <option value="recap">Recaps</option>
        </select>
      </label>
      {gm && editing && (
        <HandoutEditor
          key={editing.handout.id}
          initial={editing.handout}
          existing={editing.existing}
          close={() => setEditing(null)}
        />
      )}
      {handouts.length === 0 && <p>No handouts yet.</p>}
      {visible.map((handout) => (
        <details key={handout.id}>
          <summary>
            {handout.title}
            {handout.kind === 'quest'
              ? ` · ${handout.status || 'active'}`
              : handout.kind === 'recap'
                ? ' · recap'
                : ''}
            {gm && !handout.shared ? ' · GM only' : ''}
          </summary>
          {handout.imageUrl && (
            <img
              src={handout.imageUrl}
              alt=""
              referrerPolicy="no-referrer"
              loading="lazy"
              style={{ maxWidth: '100%', maxHeight: 400, objectFit: 'contain' }}
            />
          )}
          {handout.text && (
            <p style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{handout.text}</p>
          )}
          {gm && handout.gmNote && (
            <p style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
              <strong>GM note:</strong> {handout.gmNote}
            </p>
          )}
          {gm && <button type="button" onClick={() => send({ type: 'HANDOUT_PRESENT', id: handout.id })}>Show to everyone</button>}
          {gm && !editing && (
            <button type="button" onClick={() => setEditing({ handout, existing: true })}>
              Edit handout
            </button>
          )}
        </details>
      ))}
    </details>
  );
}
