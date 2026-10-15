import { MotionConfig } from 'motion/react';
import { ReactNode } from 'react';
import { motionTokens as timing } from './tokens';

export function MotionProvider({ children }: { children: ReactNode }) {
  return <MotionConfig reducedMotion="user" transition={{ duration: timing.content, ease: timing.ease }}>
    <style>{`:root { --motion-feedback: ${timing.feedback * 1000}ms; --motion-content: ${timing.content * 1000}ms; --motion-overlay: ${timing.overlay * 1000}ms; --motion-reduced: ${timing.reduced * 1000}ms; --motion-ease: ${timing.cssEase}; }`}</style>
    {children}
  </MotionConfig>;
}
