import { useLayoutEffect, useRef } from 'react';
import { useReducedMotion } from 'motion/react';
import { Heart } from 'lucide-react';
import { motionTokens } from './tokens';

export function SaveHeart({ saved }: { saved: boolean }) {
  const ref = useRef<SVGSVGElement>(null);
  const previous = useRef(saved);
  const reduced = useReducedMotion();
  useLayoutEffect(() => {
    const justSaved = saved && !previous.current;
    previous.current = saved;
    if (!justSaved || reduced) return;
    const animation = ref.current?.animate([{ scale: 1 }, { scale: 1.12 }, { scale: 1 }], {
      duration: motionTokens.content * 1000, easing: motionTokens.cssEase,
    });
    return () => animation?.cancel();
  }, [saved, reduced]);
  return <Heart ref={ref} className={`w-4 h-4 ${saved ? 'fill-tertiary' : ''}`} />;
}
