import { useLayoutEffect, useRef, useState } from 'react';
import { useReducedMotion } from 'motion/react';
import { motionTokens as timing } from './tokens';

type JourneyEvent = { kind: 'complete' | 'undo' | 'reroute'; id?: string; fromPercent: number;
  before?: Map<string, number>; changed?: Set<string>; identity: string };

/** Local feedback is requested only after the existing API handler confirms a write. */
export function useCompanionMotion(identity: string, percent: number) {
  const rows = useRef(new Map<string, HTMLDivElement>());
  const progress = useRef<HTMLDivElement>(null), hero = useRef<HTMLDivElement>(null);
  const [event, setEvent] = useState<JourneyEvent | null>(null);
  const consumed = useRef<JourneyEvent | null>(null);
  const reduced = useReducedMotion();
  const capture = () => new Map([...rows.current].map(([id, node]) => [id, node.getBoundingClientRect().top]));
  const confirm = (change: Omit<JourneyEvent, 'identity' | 'fromPercent'>) => setEvent({ ...change, identity, fromPercent: percent });
  useLayoutEffect(() => {
    if (!event || event.identity !== identity || consumed.current === event) return;
    consumed.current = event;
    if (reduced) return;
    const animations: Animation[] = [];
    const run = (node: Element | null | undefined, frames: Keyframe[], duration = timing.overlay * 1000) => {
      if (node) animations.push(node.animate(frames, { duration, easing: timing.cssEase }));
    };
    run(progress.current, [{ transform: `scaleX(${event.fromPercent / 100})` }, { transform: `scaleX(${percent / 100})` }]);
    if (event.kind === 'complete') {
      const row = rows.current.get(event.id || '');
      row?.querySelectorAll<SVGPathElement>('[data-completion-check] path').forEach(path => {
        const length = path.getTotalLength();
        run(path, [{ strokeDasharray: `${length}`, strokeDashoffset: `${length}` }, { strokeDasharray: `${length}`, strokeDashoffset: '0' }]);
      });
      run(hero.current, [{ opacity: 0.75, transform: 'translateY(4px)' }, { opacity: 1, transform: 'translateY(0)' }]);
    } else if (event.kind === 'undo') {
      run(rows.current.get(event.id || ''), [{ opacity: 0.6 }, { opacity: 1 }]);
    } else {
      rows.current.forEach((node, id) => {
        if (node.dataset.status === 'completed' || node.dataset.status === 'in_progress') return;
        const before = event.before?.get(id);
        if (before === undefined) run(node, [{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'translateY(0)' }]);
        else if (event.changed?.has(id)) {
          const delta = before - node.getBoundingClientRect().top;
          run(node, [{ transform: `translateY(${delta}px)`, backgroundColor: 'var(--sys-primary-container)' }, { transform: 'translateY(0)', backgroundColor: getComputedStyle(node).backgroundColor }]);
        }
      });
    }
    return () => animations.forEach(animation => animation.cancel());
  }, [event, identity, reduced]);
  return { rows, progress, hero, capture, confirm };
}
