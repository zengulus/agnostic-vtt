import { useEffect, useRef } from 'react';
import { useTable } from '../store.js';

export function TablePresentation() {
  const item = useTable((s) => s.tablePresentations[0]);
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!item) return;
    const previous = document.activeElement as HTMLElement | null;
    const backdrop = ref.current?.closest('.modal-backdrop');
    const background = backdrop?.parentElement
      ? [...backdrop.parentElement.children].filter(
          (node): node is HTMLElement => node instanceof HTMLElement && node !== backdrop,
        )
      : [];
    const prior = background.map((node) => node.inert);
    background.forEach((node) => {
      node.inert = true;
    });
    ref.current?.focus();
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        useTable
          .getState()
          .set({ tablePresentations: useTable.getState().tablePresentations.slice(1) });
      }
      if (event.key === 'Tab') {
        event.preventDefault();
        ref.current?.focus();
      }
    };
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('keydown', key);
      background.forEach((node, index) => {
        node.inert = prior[index];
      });
      if (previous?.isConnected) previous.focus();
    };
  }, [item]);
  if (!item) return null;
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={item.kind === 'handout' ? 'Presented handout' : 'Table result'}
      className="modal-backdrop"
    >
      <div className="modal">
        <h2>{item.kind === 'handout' ? item.handout.title : item.name}</h2>
        {item.kind === 'handout' && item.handout.imageUrl && (
          <img
            src={item.handout.imageUrl}
            alt=""
            referrerPolicy="no-referrer"
            style={{ maxWidth: '100%', maxHeight: 400 }}
          />
        )}
        <p style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
          {item.kind === 'handout' ? item.handout.text : item.result}
        </p>
        <button
          ref={ref}
          onClick={() =>
            useTable
              .getState()
              .set({ tablePresentations: useTable.getState().tablePresentations.slice(1) })
          }
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}
