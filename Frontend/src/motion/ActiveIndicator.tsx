import { motion, useReducedMotion } from 'motion/react';
import { motionTokens as timing } from './tokens';

export function ActiveIndicator({ id, className = '' }: { id: string; className?: string }) {
  const reduced = useReducedMotion();
  return <motion.span aria-hidden="true" className={`motion-active-indicator ${className}`}
    layoutId={id} initial={false}
    transition={{ duration: reduced ? 0 : timing.content, ease: timing.ease }} />;
}
