import { useEffect, useRef } from 'react';
import { useTable } from './store.js';

/** A compact activity drawer covers the page, so keep keyboard access inside it. */
export function useActivityFocus(open: boolean, compact: boolean) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!open || !compact || !el) return;
    const previous = document.activeElement as HTMLElement | null;
    const background = [...(el.parentElement?.children || [])].filter(
      (node): node is HTMLElement =>
        node instanceof HTMLElement &&
        node !== el &&
        !node.classList.contains('modal-backdrop') &&
        node.getAttribute('role') !== 'alert',
    );
    const states = background.map((node) => node.inert);
    background.forEach((node) => {
      node.inert = true;
    });
    el.querySelector<HTMLElement>('.chronicle-tabs [aria-pressed="true"]')?.focus();
    const key = (event: KeyboardEvent) => {
      if (event.key !== 'Tab' || useTable.getState().dialog) return;
      const items = [
        ...el.querySelectorAll<HTMLElement>('button,input,select,textarea,a[href],[tabindex]'),
      ].filter(
        (node) =>
          !node.matches(':disabled') && node.tabIndex >= 0 && node.getClientRects().length > 0,
      );
      const first = items[0],
        last = items.at(-1);
      if (
        !el.contains(document.activeElement) ||
        (!event.shiftKey && document.activeElement === last) ||
        (event.shiftKey && document.activeElement === first)
      ) {
        event.preventDefault();
        (event.shiftKey ? last : first)?.focus();
      }
    };
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('keydown', key);
      background.forEach((node, index) => {
        node.inert = states[index];
      });
      if (previous?.isConnected && !useTable.getState().dialog) previous.focus();
    };
  }, [open, compact]);
  return ref;
}
