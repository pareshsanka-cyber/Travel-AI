import { useLayoutEffect, useRef } from 'react';
import { useReducedMotion } from 'motion/react';
import { appendedMessageIds, motionTokens as timing } from './tokens';

/** Fade mounted content without keys, remounts, layout transforms or delayed input. */
export function useContentFade(identity: string, visible = true) {
  const ref = useRef<HTMLDivElement>(null);
  const previous = useRef({ identity, visible });
  const reduced = useReducedMotion();
  useLayoutEffect(() => {
    const changed = previous.current.identity !== identity || !previous.current.visible;
    previous.current = { identity, visible };
    if (!visible || !changed) return;
    const animation = ref.current?.animate([{ opacity: 0.65 }, { opacity: 1 }], {
      duration: (reduced ? timing.reduced : timing.content) * 1000, easing: timing.cssEase,
    });
    return () => animation?.cancel();
  }, [identity, visible, reduced]);
  return ref;
}

/** Animate appended messages only during a live request, never restored history. */
export function useMessageEntrances(ids: string[], sending: boolean, visible: boolean) {
  const ref = useRef<HTMLDivElement>(null);
  const previous = useRef({ ids, sending, visible });
  const reduced = useReducedMotion();
  useLayoutEffect(() => {
    const snapshot = previous.current;
    const appended = appendedMessageIds(snapshot.ids, ids, sending || snapshot.sending);
    previous.current = { ids, sending, visible };
    if (!visible || !snapshot.visible || !appended.length) return;
    const wanted = new Set(appended);
    const animations: Animation[] = [];
    ref.current?.querySelectorAll<HTMLElement>('[data-message-id]').forEach(node => {
      if (!wanted.has(node.dataset.messageId || '')) return;
      const frames = reduced ? [{ opacity: 0.65 }, { opacity: 1 }] :
        [{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'translateY(0)' }];
      animations.push(node.animate(frames, { duration: (reduced ? timing.reduced : timing.content) * 1000, easing: timing.cssEase }));
    });
    return () => animations.forEach(animation => animation.cancel());
  }, [ids, sending, visible, reduced]);
  return ref;
}
