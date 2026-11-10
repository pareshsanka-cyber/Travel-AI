import type {
  ItinerarySnapshot,
  ItinerarySnapshotDay,
  ItinerarySnapshotActivity,
  DiffActivityItem,
  DayDiff,
  ItineraryDiffResult,
} from '../types';

function cleanTitle(str?: string): string {
  return (str || '').toLowerCase().replace(/[^a-z0-9]/g, '').trim();
}

function normalizeTime(t?: string): string {
  return (t || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * Computes a detailed visual itinerary diff between two revision snapshots.
 */
export function computeItineraryDiff(
  fromSnapshot: ItinerarySnapshot,
  toSnapshot: ItinerarySnapshot
): ItineraryDiffResult {
  const fromDays = fromSnapshot.days || [];
  const toDays = toSnapshot.days || [];

  const maxDays = Math.max(fromDays.length, toDays.length);
  const dayDiffs: DayDiff[] = [];

  let totalAdded = 0;
  let totalRemoved = 0;
  let totalRescheduled = 0;

  for (let d = 1; d <= maxDays; d++) {
    const prevDay = fromDays.find((day) => day.dayNumber === d);
    const currDay = toDays.find((day) => day.dayNumber === d);

    const prevActs = prevDay?.activities || [];
    const currActs = currDay?.activities || [];

    const matchedPrevIndices = new Set<number>();
    const matchedCurrIndices = new Set<number>();

    const items: DiffActivityItem[] = [];

    // 1. First pass: Match by exact activity ID
    for (let c = 0; c < currActs.length; c++) {
      const curr = currActs[c];
      const p = prevActs.findIndex((prev, idx) => !matchedPrevIndices.has(idx) && prev.id && curr.id && prev.id === curr.id);
      if (p !== -1) {
        matchedPrevIndices.add(p);
        matchedCurrIndices.add(c);
        const prev = prevActs[p];

        const prevTime = prev.time || (prev.startTime && prev.endTime ? `${prev.startTime} - ${prev.endTime}` : '');
        const currTime = curr.time || (curr.startTime && curr.endTime ? `${curr.startTime} - ${curr.endTime}` : '');

        const isTimeChanged = normalizeTime(prevTime) !== normalizeTime(currTime) && prevTime && currTime;
        const changeType = isTimeChanged ? 'rescheduled' : 'unchanged';

        if (isTimeChanged) totalRescheduled++;

        items.push({
          id: curr.id,
          title: curr.title,
          changeType,
          currentTime: currTime,
          previousTime: isTimeChanged ? prevTime : undefined,
          currentDuration: curr.duration,
          previousDuration: prev.duration,
          location: curr.location,
          type: curr.type,
          description: curr.description,
        });
      }
    }

    // 2. Second pass: Match by cleaned title for renamed IDs
    for (let c = 0; c < currActs.length; c++) {
      if (matchedCurrIndices.has(c)) continue;
      const curr = currActs[c];
      const currClean = cleanTitle(curr.title);

      const p = prevActs.findIndex((prev, idx) => !matchedPrevIndices.has(idx) && cleanTitle(prev.title) === currClean);
      if (p !== -1) {
        matchedPrevIndices.add(p);
        matchedCurrIndices.add(c);
        const prev = prevActs[p];

        const prevTime = prev.time || (prev.startTime && prev.endTime ? `${prev.startTime} - ${prev.endTime}` : '');
        const currTime = curr.time || (curr.startTime && curr.endTime ? `${curr.startTime} - ${curr.endTime}` : '');

        const isTimeChanged = normalizeTime(prevTime) !== normalizeTime(currTime) && prevTime && currTime;
        const changeType = isTimeChanged ? 'rescheduled' : 'unchanged';

        if (isTimeChanged) totalRescheduled++;

        items.push({
          id: curr.id,
          title: curr.title,
          changeType,
          currentTime: currTime,
          previousTime: isTimeChanged ? prevTime : undefined,
          currentDuration: curr.duration,
          previousDuration: prev.duration,
          location: curr.location,
          type: curr.type,
          description: curr.description,
        });
      }
    }

    // 3. Unmatched in curr -> ADDED (🟩 +)
    for (let c = 0; c < currActs.length; c++) {
      if (!matchedCurrIndices.has(c)) {
        const curr = currActs[c];
        const currTime = curr.time || (curr.startTime && curr.endTime ? `${curr.startTime} - ${curr.endTime}` : '');
        totalAdded++;
        items.push({
          id: curr.id,
          title: curr.title,
          changeType: 'added',
          currentTime: currTime,
          currentDuration: curr.duration,
          location: curr.location,
          type: curr.type,
          description: curr.description,
        });
      }
    }

    // 4. Unmatched in prev -> REMOVED / REPLACED (🟥 -)
    for (let p = 0; p < prevActs.length; p++) {
      if (!matchedPrevIndices.has(p)) {
        const prev = prevActs[p];
        const prevTime = prev.time || (prev.startTime && prev.endTime ? `${prev.startTime} - ${prev.endTime}` : '');
        totalRemoved++;
        items.push({
          id: prev.id,
          title: prev.title,
          changeType: 'removed',
          previousTime: prevTime,
          previousDuration: prev.duration,
          location: prev.location,
          type: prev.type,
          description: prev.description,
        });
      }
    }

    const dayAdded = items.filter((i) => i.changeType === 'added').length;
    const dayRemoved = items.filter((i) => i.changeType === 'removed').length;
    const dayRescheduled = items.filter((i) => i.changeType === 'rescheduled').length;

    dayDiffs.push({
      dayNumber: d,
      date: currDay?.date || prevDay?.date,
      title: currDay?.title || prevDay?.title || `Day ${d}`,
      items,
      addedCount: dayAdded,
      removedCount: dayRemoved,
      rescheduledCount: dayRescheduled,
    });
  }

  return {
    fromRevision: fromSnapshot.revision,
    toRevision: toSnapshot.revision,
    dayDiffs,
    totalAdded,
    totalRemoved,
    totalRescheduled,
    totalChanges: totalAdded + totalRemoved + totalRescheduled,
  };
}
