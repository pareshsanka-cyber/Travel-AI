export function reviewSnapshot(revision: number, original: any[], proposed: any[], skipOnly = false, trigger = 'skip') {
  return { version: 2, status: 'success', proposal_id: 'owned-proposal', revision, day_number: 1,
    target_activity_id: original[0]?.id || 'a', trigger, origin_location_label: 'Planned starting point: Sydney Harbour',
    original_stops: original, warnings: skipOnly ? ['Saved schedule stays unchanged. No new timings are calculated.'] : [],
    expires_at: '2026-10-22T12:15:00Z', server_time: '2026-10-22T12:00:00Z', timezone: 'Australia/Sydney',
    options: [{ id: 'option-1', kind: skipOnly ? 'skip_only' : 'replacement', recommended: true,
      title: skipOnly ? 'Skip only — keep saved timings' : 'Suggested replacement: Sydney Observatory',
      reason: 'Preserves the remaining visits.', proposed_stops: proposed, replacement_activity: skipOnly ? null : proposed[0], warnings: [],
      travel: [{ to_id: proposed[0]?.id, duration_minutes: 4, distance_km: 1.1, source: 'road', confidence: 'Road estimate; no live traffic' }],
      impact: { changed_stops: skipOnly ? [] : proposed.filter(s => !original.some(o => o.id === s.id && o.start_time === s.start_time)).map(s => ({ id: s.id, title: s.name,
        before_start: original.find(o => o.id === s.id)?.start_time, before_end: original.find(o => o.id === s.id)?.end_time,
        after_start: s.start_time, after_end: s.end_time })), finish_time: '14:00', original_finish: '14:00', travel_minutes: 4,
        price_difference: null, currency: 'INR', opening_hours: 'Unknown — verify opening hours before travel' } }] };
}

export function directionsSnapshot(revision: number, stops: any[], fallback = false, flight = false) {
  return { version: 2, revision, day_number: 1, legs: stops.slice(1).map((to, i) => {
    const from = stops[i], unavailable = from.lat == null || from.lon == null || to.lat == null || to.lon == null;
    const flying = flight && i === 0;
    return { from_id: from.id, to_id: to.id, from_title: from.name, to_title: to.name,
      from_coords: from.lat == null ? null : [from.lat, from.lon], to_coords: to.lat == null ? null : [to.lat, to.lon],
      duration_minutes: 4, distance_km: 1.1, source: unavailable ? 'unavailable' : flying ? 'flight' : fallback ? 'distance_estimate' : 'road',
      confidence: unavailable ? 'Location coordinates unavailable' : fallback ? 'Straight-line distance estimate' : 'Road estimate; no live traffic',
      geometry: unavailable ? [] : [[from.lat, from.lon], [to.lat, to.lon]] };
  }) };
}
