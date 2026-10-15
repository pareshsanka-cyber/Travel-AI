/** Compare server snapshots; never infer movement from list indexes or decorative labels. */
export function changedRerouteIds(original: Array<Record<string, any>>, proposed: Array<Record<string, any>>) {
  const before = new Map(original.filter(stop => stop.id).map(stop => [String(stop.id), stop]));
  return new Set(proposed.filter(stop => {
    const old = before.get(String(stop.id));
    return stop.id && (!old || ['start_time', 'end_time', 'time', 'lat', 'lon'].some(key => old[key] !== stop[key]));
  }).map(stop => String(stop.id)));
}
