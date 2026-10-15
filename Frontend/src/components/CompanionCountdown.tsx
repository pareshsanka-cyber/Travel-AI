import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useReducedMotion } from 'motion/react';
import type { ActivitySegment, ItineraryDay } from '../types';
import { countdownDisplay, countdownTarget } from '../motion/countdown';
import { motionTokens } from '../motion/tokens';

function CountdownDigit({ character, reduced }: { character: string; reduced: boolean }) {
  const node = useRef<HTMLSpanElement>(null), previous = useRef(character);
  useLayoutEffect(() => {
    const changed = previous.current !== character; previous.current = character;
    if (!changed || reduced) return;
    const animation = node.current?.animate([{ transform: 'translateY(30%)', opacity: 0.6 }, { transform: 'translateY(0)', opacity: 1 }],
      { duration: motionTokens.feedback * 1000, easing: motionTokens.cssEase });
    return () => animation?.cancel();
  }, [character, reduced]);
  return <span className="inline-block overflow-hidden"><span ref={node} className="inline-block">{character}</span></span>;
}

/** Clock updates stay here: the map, activity list and Companion do not rerender each second. */
export const CompanionCountdown = memo(function CompanionCountdown({ activity, day, explicitTripZone }: {
  activity: ActivitySegment; day: Pick<ItineraryDay, 'isoDate'>; explicitTripZone?: string;
}) {
  const reduced = useReducedMotion();
  const target = useMemo(() => countdownTarget(activity, day, explicitTripZone),
    [activity.scheduledDate, activity.startTime, activity.timezone, activity.type, activity.category, activity.title, day.isoDate, explicitTripZone]);
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    let timeout: ReturnType<typeof setTimeout>;
    const tick = () => {
      clearTimeout(timeout);
      const current = Date.now(); setNow(current);
      if (document.hidden || target.timestamp === null) return;
      const remaining = target.timestamp - current;
      timeout = setTimeout(tick, remaining <= 0 ? 60000 : remaining > 86400000 ? Math.min(60000, remaining - 86400000) : 1000 - current % 1000);
    };
    tick(); document.addEventListener('visibilitychange', tick);
    return () => { clearTimeout(timeout); document.removeEventListener('visibilitychange', tick); };
  }, [target]);
  const display = countdownDisplay(target, now);
  const schedule = [target.date, target.time, target.zone].filter(Boolean).join(' · ');
  return <div className="mt-3 text-xs text-on-surface-variant space-y-1" data-testid="companion-countdown" data-state={display.state}>
    <div className="flex items-baseline gap-2 flex-wrap">
      <span>{display.label}</span>
      {display.value && <span aria-hidden="true" className="inline-flex font-mono tabular-nums text-sm font-semibold text-primary overflow-hidden" data-countdown-value>
        {Array.from(display.value).map((character, index) => <CountdownDigit key={index} character={character} reduced={Boolean(reduced)} />)}
      </span>}
    </div>
    <p>{schedule ? <>Scheduled: <time dateTime={target.timestamp === null ? undefined : new Date(target.timestamp).toISOString()}>{schedule}</time></> : 'Saved activity dates, times and timezone are needed.'}</p>
  </div>;
});
