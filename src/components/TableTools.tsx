import { useState } from 'react';
import { tableToolDigest, type TableTool } from '../../shared/model.js';
import { send } from '../connection.js';
import { useTable } from '../store.js';
import { useConfirmedAction } from '../useConfirmedAction.js';

export function TableTools() {
  const { room, self } = useTable();
  const [editing, setEditing] = useState<TableTool | null>(null);
  const [kind, setKind] = useState<'clock' | 'counter' | 'table'>('clock');
  const [name, setName] = useState('');
  const [segments, setSegments] = useState(4);
  const [entries, setEntries] = useState('');
  const [error, setError] = useState('');
  const action = useConfirmedAction();
  const tools = Object.values(room.tableTools || {});
  async function create() {
    setError('');
    const id = editing?.id || crypto.randomUUID();
    let tool: TableTool;
    if (kind === 'table') {
      const rows = entries
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean);
      const parsed = rows.map((line) => {
        const match = /^(\d+)\s*\|\s*(.+)$/.exec(line);
        return { text: match ? match[2].trim() : line, weight: match ? Number(match[1]) : 1 };
      });
      if (
        !parsed.length ||
        parsed.length > 50 ||
        parsed.some(
          (row) => !row.text || row.text.length > 200 || row.weight < 1 || row.weight > 1000,
        )
      ) {
        setError('Enter 1–50 entries, each up to 200 characters, with weights from 1 to 1000.');
        return;
      }
      tool = { id, kind, name: name.trim(), entries: parsed };
    } else if (kind === 'clock')
      tool = {
        id,
        kind,
        name: name.trim(),
        value: editing?.kind === 'clock' ? Math.min(editing.value, segments) : 0,
        segments,
      };
    else
      tool = {
        id,
        kind,
        name: name.trim(),
        value: editing?.kind === 'counter' ? editing.value : 0,
      };
    if (
      await action.run(
        { type: 'TABLE_TOOL_SAVE', tool, digest: editing ? tableToolDigest(editing) : undefined },
        'Saving…',
      )
    ) {
      setEditing(null);
      setName('');
      setEntries('');
    }
  }
  return (
    <details className="table-tools">
      <summary>Table tools ({tools.length})</summary>
      {tools.map((tool) => (
        <div key={tool.id}>
          <strong>{tool.name}</strong>{' '}
          {tool.kind === 'table' ? (
            <button type="button" onClick={() => send({ type: 'TABLE_TOOL_ROLL', id: tool.id })}>
              Roll
            </button>
          ) : (
            <>
              <button
                type="button"
                aria-label={`Decrease ${tool.name}`}
                disabled={!!action.pending || tool.value <= (tool.kind === 'clock' ? 0 : -1000000)}
                onClick={() =>
                  void action.run(
                    { type: 'TABLE_TOOL_ADJUST', id: tool.id, delta: -1 },
                    'Updating…',
                  )
                }
              >
                −
              </button>{' '}
              <span
                aria-label={
                  tool.kind === 'clock' ? `${tool.value} of ${tool.segments} segments` : undefined
                }
              >
                {tool.kind === 'clock' && (
                  <span aria-hidden="true" className="clock-segments">
                    {Array.from({ length: tool.segments }, (_, i) => (
                      <span key={i} className={i < tool.value ? 'filled' : ''} />
                    ))}
                  </span>
                )}
                {tool.value}
                {tool.kind === 'clock' ? ` / ${tool.segments}` : ''}
              </span>{' '}
              <button
                type="button"
                aria-label={`Increase ${tool.name}`}
                disabled={
                  !!action.pending ||
                  tool.value >= (tool.kind === 'clock' ? tool.segments : 1000000)
                }
                onClick={() =>
                  void action.run({ type: 'TABLE_TOOL_ADJUST', id: tool.id, delta: 1 }, 'Updating…')
                }
              >
                +
              </button>
            </>
          )}
          {self?.role === 'gm' && (
            <button
              type="button"
              disabled={!!action.pending}
              onClick={() => {
                setEditing(tool);
                setKind(tool.kind);
                setName(tool.name);
                if (tool.kind === 'clock') setSegments(tool.segments);
                if (tool.kind === 'table')
                  setEntries(
                    tool.entries.map((entry) => `${entry.weight} | ${entry.text}`).join('\n'),
                  );
              }}
            >
              Edit {tool.name}
            </button>
          )}
          {self?.role === 'gm' && (
            <button
              type="button"
              aria-label={`Delete ${tool.name}`}
              onClick={() => {
                if (window.confirm(`Delete “${tool.name}”?`))
                  void action.run({ type: 'TABLE_TOOL_DELETE', id: tool.id }, 'Deleting…');
              }}
            >
              Delete
            </button>
          )}
        </div>
      ))}
      {self?.role === 'gm' && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void create();
          }}
        >
          <label>
            {editing ? 'Edit table tool' : 'New table tool'}{' '}
            <select
              disabled={!!editing}
              value={kind}
              onChange={(e) => setKind(e.target.value as typeof kind)}
            >
              <option value="clock">Progress clock</option>
              <option value="counter">Party counter</option>
              <option value="table">Rollable table</option>
            </select>
          </label>
          <label>
            Table tool name{' '}
            <input
              aria-label="Table tool name"
              required
              maxLength={80}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          {kind === 'clock' && (
            <label>
              Segments{' '}
              <input
                type="number"
                min={2}
                max={12}
                value={segments}
                onChange={(e) => setSegments(Number(e.target.value))}
              />
            </label>
          )}
          {kind === 'table' && (
            <label>
              Entries, one per line (optional weight: <code>3 | entry</code>)
              <textarea
                required
                maxLength={10500}
                value={entries}
                onChange={(e) => setEntries(e.target.value)}
              />
            </label>
          )}
          <button type="submit" disabled={!!action.pending || !name.trim()}>
            {editing ? 'Save changes' : 'Create'}
          </button>
          {editing && (
            <button
              type="button"
              disabled={!!action.pending}
              onClick={() => {
                setEditing(null);
                setName('');
                setEntries('');
              }}
            >
              Cancel edit
            </button>
          )}
        </form>
      )}
      {action.pending && <p role="status">{action.pending}</p>}
      {(error || action.error) && <p role="alert">{error || action.error}</p>}
    </details>
  );
}
