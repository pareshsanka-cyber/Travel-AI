/** Compare server snapshots; never infer movement from list indexes or decorative labels. */
export function changedRerouteIds(original: Array<Record<string, any>>, proposed: Array<Record<string, any>>) {
  const before = new Map(original.filter(stop => stop.id).map(stop => [String(stop.id), stop]));
  return new Set(proposed.filter(stop => {
    const old = before.get(String(stop.id));
    if (!stop.id) return false;
    if (!old) return true;
    const timed = (old.start_time || old.startTime) && (stop.start_time || stop.startTime);
    const keys = ['start_time', 'end_time', 'startTime', 'endTime', 'lat', 'lon', ...(!timed ? ['time'] : [])];
    return keys.some(key => old[key] !== stop[key]);
  }).map(stop => String(stop.id)));
}
