import { useRef, useState } from 'react';
import { canControl, type Token } from '../../shared/model.js';
import { sendAndWait } from '../connection.js';
import { useTable } from '../store.js';
import { characterControlled } from '../../shared/characters.js';

export function TokenResource({ token, sceneId }: { token: Token; sceneId: string }) {
  const s = useTable(),
    [amount, setAmount] = useState('1'),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const inFlight = useRef(false);
  const sheet = token.characterId ? s.room.characters?.[token.characterId] : undefined;
  const linked = token.resourceId
    ? sheet?.resources.find((r) => r.id === token.resourceId)
    : undefined;
  const resource = token.resourceId
    ? linked && { label: linked.name, value: linked.current, max: linked.max, min: linked.min }
    : token.resource;
  if (!resource) return null;
  const controlled =
    !!s.self &&
    canControl(token, s.self.id, s.self.role) &&
    (!token.resourceId || (!!sheet && characterControlled(sheet, s.self.id, s.self.role)));
  const adjust = async (direction: 1 | -1) => {
    const value = Number(amount);
    if (inFlight.current || !Number.isFinite(value) || value <= 0 || value > 10000) return;
    inFlight.current = true;
    setBusy(true);
    setError('');
    try {
      await sendAndWait({
        type: 'TOKEN_RESOURCE_ADJUST',
        sceneId,
        tokenId: token.id,
        delta: direction * value,
      });
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Resource change failed.');
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };
  return (
    <div className="token-resource">
      <span aria-live="polite">
        {resource.label || 'Resource'}:{' '}
        <b>
          {resource.value} / {resource.max}
        </b>
      </span>
      {controlled && (
        <div className="resource-actions">
          <input
            aria-label="Resource adjustment amount"
            type="number"
            min={1}
            max={10000}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
          <button
            aria-label="Damage or spend resource"
            disabled={busy || resource.value <= (resource.min ?? 0)}
            onClick={() => void adjust(-1)}
          >
            − Spend
          </button>
          <button
            aria-label="Heal or restore resource"
            disabled={busy || resource.value >= resource.max}
            onClick={() => void adjust(1)}
          >
            + Restore
          </button>
        </div>
      )}
      {error && (
        <span className="form-error" role="alert">
          {error}
        </span>
      )}
      {busy && <span role="status">Updating {resource.label || 'resource'}…</span>}
    </div>
  );
}
