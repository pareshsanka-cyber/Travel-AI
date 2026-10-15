import { useLayoutEffect, useRef, type ImgHTMLAttributes, type ReactNode } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { motionTokens as timing } from './tokens';

/** Local list motion. Remember revealed IDs across filtering without hiding actions. */
export function TripCardMotion({ id, index, seen, className, children }: {
  id: string; index: number; seen: Set<string>; className: string; children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node || seen.has(id)) return;
    let animation: Animation | undefined;
    const observer = new IntersectionObserver(entries => {
      if (!entries.some(entry => entry.isIntersecting)) return;
      seen.add(id); observer.disconnect();
      if (reduced || index >= 6) return;
      animation = node.animate([{ opacity: .65, translate: '0 6px' }, { opacity: 1, translate: '0 0' }], {
        duration: timing.overlay * 1000, delay: Math.min(index * 30, 150), easing: timing.cssEase,
      });
    });
    observer.observe(node);
    return () => { observer.disconnect(); animation?.cancel(); };
  }, [id, index, seen, reduced]);
  return <motion.div ref={ref} layout="position" transition={{ duration: reduced ? 0 : timing.content, ease: timing.ease }} className={className}>{children}</motion.div>;
}

/** Loaded pixels fade in; cached/error images and their reserved dimensions stay intact. */
export function MotionImage(props: ImgHTMLAttributes<HTMLImageElement>) {
  const animation = useRef<Animation | undefined>(undefined);
  const cached = useRef(false);
  const reduced = useReducedMotion();
  useLayoutEffect(() => () => animation.current?.cancel(), [props.src, reduced]);
  return <img {...props} ref={node => { cached.current = Boolean(node?.complete && node.naturalWidth); }} onLoad={event => {
    props.onLoad?.(event);
    animation.current?.cancel();
    if (!reduced && !cached.current) animation.current = event.currentTarget.animate([{ opacity: .55 }, { opacity: 1 }], {
      duration: timing.content * 1000, easing: timing.cssEase,
    });
  }} />;
}

/** Observe a confirmed state change, never initial history or a different order. */
export function useConfirmedSuccess(id?: string, status?: string, loading = false) {
  const ref = useRef<HTMLDivElement>(null);
  const previous = useRef({ id, status });
  const reduced = useReducedMotion();
  useLayoutEffect(() => {
    if (loading) return;
    const before = previous.current;
    previous.current = { id, status };
    if (!id || before.id !== id || !before.status || before.status === 'succeeded' || status !== 'succeeded' || reduced) return;
    const node = ref.current;
    const animations: Animation[] = [];
    if (node) animations.push(node.animate([{ opacity: .65, translate: '0 4px' }, { opacity: 1, translate: '0 0' }], {
      duration: timing.overlay * 1000, easing: timing.cssEase,
    }));
    node?.querySelectorAll<SVGGeometryElement>('[data-success-icon] polyline, [data-success-icon] path').forEach(path => {
      const length = path.getTotalLength();
      animations.push(path.animate([{ strokeDasharray: `${length}`, strokeDashoffset: length }, { strokeDasharray: `${length}`, strokeDashoffset: 0 }], {
        duration: timing.overlay * 1000, easing: timing.cssEase,
      }));
    });
    return () => animations.forEach(animation => animation.cancel());
  }, [id, status, loading, reduced]);
  return ref;
}
