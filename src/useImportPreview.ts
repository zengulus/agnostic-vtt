import { useEffect, useState } from 'react';
import type { PreviewRequest } from './preview.worker.js';

/** A fresh worker per input cancels stale work and keeps parsing off the UI thread. */
export function useImportPreview<T>(request: PreviewRequest | null) {
  const [result, setResult] = useState<{ request: PreviewRequest; value: T } | null>(null);
  const [failed, setFailed] = useState<PreviewRequest | null>(null);
  useEffect(() => {
    if (!request) return;
    let worker: Worker | undefined;
    let cancelled = false;
    try {
      worker = new Worker(new URL('./preview.worker.ts', import.meta.url), { type: 'module' });
      worker.onmessage = (event: MessageEvent<T>) => {
        if (!cancelled) setResult({ request, value: event.data });
      };
      worker.onerror = () => {
        if (!cancelled) setFailed(request);
      };
      worker.postMessage(request);
    } catch {
      if (!cancelled) setFailed(request);
    }
    return () => {
      cancelled = true;
      worker?.terminate();
    };
  }, [request]);
  return {
    value: request && result?.request === request ? result.value : null,
    pending: !!request && result?.request !== request && failed !== request,
    error: request && failed === request ? 'Could not prepare the preview. Try again.' : '',
  };
}
