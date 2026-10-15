import { RefObject, useEffect, useRef } from 'react';

let locks = 0;
let originalOverflow = '';

/** Shared by nested preference sheets and the chat drawer. */
export function useModalFocus(ref: RefObject<HTMLElement | null>, open: boolean, onClose: () => void) {
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    if (!open || !ref.current) return;
    const panel = ref.current;
    const previous = document.activeElement as HTMLElement | null;
    if (locks++ === 0) { originalOverflow = document.body.style.overflow; document.body.style.overflow = 'hidden'; }
    const focusable = () => Array.from(panel.querySelectorAll<HTMLElement>('button:not([disabled]), [href], input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex="0"]')).filter(el => el.getClientRects().length > 0);
    (focusable()[0] || panel).focus({ preventScroll: true });
    const keydown = (event: KeyboardEvent) => {
      // A nested, portaled dialog manages its own keyboard events.
      if (!panel.contains(event.target as Node)) return;
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close.current(); }
      if (event.key === 'Tab') {
        const items = focusable();
        const first = items[0], last = items[items.length - 1];
        if (!first) { event.preventDefault(); panel.focus(); }
        else if (event.shiftKey && (document.activeElement === first || document.activeElement === panel)) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    };
    panel.addEventListener('keydown', keydown);
    return () => {
      panel.removeEventListener('keydown', keydown);
      if (--locks === 0) document.body.style.overflow = originalOverflow;
      if (previous?.isConnected) previous.focus({ preventScroll: true });
    };
  }, [open, ref]);
}
