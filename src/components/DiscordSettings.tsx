import { useState } from 'react';
import { configureDiscord, shareDiscord } from '../connection.js';
import { useTable } from '../store.js';
import type { Roll } from '../../shared/model.js';

export function DiscordSettings() {
  const s = useTable(),
    [url, setUrl] = useState(''),
    [enabled, setEnabled] = useState(s.discord.configured ? s.discord.enabled : true),
    [mode, setMode] = useState(s.discord.mode),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(''),
    [error, setError] = useState('');
  const save = async (remove = false) => {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await configureDiscord(remove ? null : { url, enabled, mode });
      setUrl('');
      setMessage(remove ? 'Webhook removed.' : 'Discord settings saved.');
      if (remove) setEnabled(false);
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <p className="dialog-intro">
        Share public dice and macro results with your Discord channel. Private results stay inside
        the table.
      </p>
      <p className="muted">
        {s.discord.configured
          ? 'A webhook is configured. Leave the URL blank to keep it.'
          : 'Create a webhook in your Discord channel’s integration settings and paste its URL here.'}{' '}
        The saved URL is kept on the server.
      </p>
      {s.discord.canManage ? (
        <>
          <label>
            Discord webhook URL
            <input
              type="password"
              autoComplete="new-password"
              value={url}
              maxLength={512}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://discord.com/api/webhooks/…"
              required={!s.discord.configured}
            />
          </label>
          <label>
            Discord delivery
            <select
              aria-label="Discord delivery"
              value={mode}
              onChange={(e) => setMode(e.target.value as typeof mode)}
            >
              <option value="automatic">Automatically post public results</option>
              <option value="manual">Send from roll history when clicked</option>
            </select>
          </label>
          <label className="check-label">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
            />
            Enable Discord delivery
          </label>
          <div className="dialog-actions">
            <button className="primary-button" disabled={busy || s.status !== 'live'}>
              {busy ? 'Saving…' : 'Save Discord settings'}
            </button>
            {s.discord.configured && (
              <button
                type="button"
                className="secondary-button"
                disabled={busy || s.status !== 'live'}
                onClick={() => void save(true)}
              >
                Remove webhook
              </button>
            )}
          </div>
        </>
      ) : (
        <p className="muted">Only the campaign owner can configure Discord.</p>
      )}
      {message && (
        <p role="status" className="muted">
          {message}
        </p>
      )}
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
    </form>
  );
}
export function DiscordShare({ roll }: { roll: Roll }) {
  const s = useTable(),
    [busy, setBusy] = useState(false),
    delivery = s.deliveries[roll.id];
  if (
    roll.visibility !== 'public' ||
    !s.discord.enabled ||
    (roll.userId !== s.self?.id && s.self?.role !== 'gm')
  )
    return null;
  return (
    <button
      className={`discord-share ${delivery?.status || ''}`}
      title={delivery?.message || 'Send this public result to Discord'}
      disabled={
        busy || s.status !== 'live' || delivery?.status === 'queued' || delivery?.status === 'sent'
      }
      onClick={async () => {
        setBusy(true);
        try {
          await shareDiscord(roll.id);
        } catch (error) {
          s.set({ error: (error as Error).message });
        } finally {
          setBusy(false);
        }
      }}
    >
      {busy || delivery?.status === 'queued'
        ? 'Queued for Discord…'
        : delivery?.status === 'sent'
          ? 'Sent to Discord ✓'
          : delivery?.status === 'failed'
            ? 'Retry Discord delivery'
            : 'Send to Discord ↗'}
    </button>
  );
}
