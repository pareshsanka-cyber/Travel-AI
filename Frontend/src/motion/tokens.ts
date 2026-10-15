/** Shared seconds for Motion, milliseconds for CSS and the browser animation API. */
export const motionTokens = {
  feedback: 0.12,
  content: 0.18,
  overlay: 0.24,
  reduced: 0.08,
  route: 0.55,
  ease: [0.22, 1, 0.36, 1] as const,
  cssEase: 'cubic-bezier(0.22, 1, 0.36, 1)',
};

/** History restoration and conversation replacement must never look like new replies. */
export function appendedMessageIds(previous: readonly string[], next: readonly string[], activeRequest: boolean): string[] {
  if (!activeRequest || !previous.length || next.length <= previous.length ||
      !previous.every((id, index) => next[index] === id)) return [];
  return next.slice(previous.length);
}
