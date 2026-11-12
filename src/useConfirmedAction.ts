import { useRef, useState } from 'react';
import type { Action } from '../shared/protocol.js';
import { sendAndWait } from './connection.js';

/** Serialize related actions and keep their pending and failure state visible. */
export function useConfirmedAction() {
  const inFlight = useRef(false);
  const [pending, setPending] = useState('');
  const [error, setError] = useState('');
  const run = async (action: Action, message: string): Promise<boolean> => {
    if (inFlight.current) return false;
    inFlight.current = true;
    setPending(message);
    setError('');
    try {
      await sendAndWait(action);
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Action failed.');
      return false;
    } finally {
      inFlight.current = false;
      setPending('');
    }
  };
  return { pending, error, run };
}
