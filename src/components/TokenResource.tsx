import { useState } from 'react';
import { canControl, type Token } from '../../shared/model.js';
import { sendAndWait } from '../connection.js';
import { useTable } from '../store.js';

export function TokenResource({ token, sceneId }: { token: Token; sceneId: string }) {
  const s = useTable(),
    [amount, setAmount] = useState('1'),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  if (!token.resource) return null;
  const controlled = !!s.self && canControl(token, s.self.id, s.self.role);
  const adjust = async (direction: 1 | -1) => {
    const value = Number(amount);
    if (busy || !Number.isFinite(value) || value <= 0 || value > 10000) return;
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
      setBusy(false);
    }
  };
  return (
    <div className="token-resource">
      <span aria-live="polite">
        {token.resource.label || 'Resource'}:{' '}
        <b>
          {token.resource.value} / {token.resource.max}
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
            disabled={busy || token.resource.value <= 0}
            onClick={() => void adjust(-1)}
          >
            − Spend
          </button>
          <button
            aria-label="Heal or restore resource"
            disabled={busy || token.resource.value >= token.resource.max}
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
    </div>
  );
}
