import { useLayoutEffect, useRef } from 'react';

/** Non-modal menu: normal Tab order, Escape dismissal and focus return. */
export function usePopoverFocus(open: boolean, onClose: () => void) {
  const panel = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useLayoutEffect(() => {
    if (!open || !panel.current) return;
    const element = panel.current;
    element.querySelector<HTMLElement>('button:not([disabled]), [href]')?.focus({ preventScroll: true });
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault(); close.current(); trigger.current?.focus({ preventScroll: true });
      }
    };
    const focus = (event: FocusEvent) => {
      if (!element.contains(event.target as Node) && event.target !== trigger.current) close.current();
    };
    document.addEventListener('keydown', keydown);
    document.addEventListener('focusin', focus);
    return () => {
      document.removeEventListener('keydown', keydown);
      document.removeEventListener('focusin', focus);
      if (element.contains(document.activeElement) || document.activeElement === document.body) trigger.current?.focus({ preventScroll: true });
    };
  }, [open]);
  return { panel, trigger };
}
