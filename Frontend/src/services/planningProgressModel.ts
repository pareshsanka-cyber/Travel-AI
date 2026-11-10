import type { PlanningProgress } from './planningProgress';

export const planningGroups = [
  { id: 'analysis', label: 'Understanding your request', stages: ['analysis'] },
  { id: 'outline', label: 'Planning your days', stages: ['parser', 'planner'] },
  { id: 'discovery', label: 'Checking places and travel options', stages: ['attractions', 'restaurants', 'flights', 'hotels', 'weather'] },
  { id: 'budget', label: 'Checking known costs', stages: ['budget'] },
  { id: 'schedule', label: 'Building your schedule', stages: ['route'] },
  { id: 'validation', label: 'Checking hours and itinerary', stages: ['opening_hours', 'reviewer'] },
  { id: 'saving', label: 'Preparing and saving your itinerary', stages: ['synthesis', 'saving'] },
];

export function planningSteps(progress: PlanningProgress) {
  const isSucceeded = progress.status === 'succeeded';
  return planningGroups.map(group => {
    if (isSucceeded) {
      return { ...group, status: 'done' as const };
    }
    const states = group.stages.map(stage => progress.stages[stage]?.status);
    const status = states.includes('failed') ? 'failed'
      : states.every(value => value === 'done' || value === 'warning') ? (states.includes('warning') ? 'warning' : 'done')
      : states.some(Boolean) ? 'running' : 'waiting';
    return { ...group, status };
  });
}

export interface ServiceCheck {
  id: string;
  name: string;
  icon: 'map-pin' | 'plane-hotel' | 'calendar' | 'clock';
  status: 'done' | 'running' | 'waiting' | 'warning' | 'failed';
  note?: string | null;
}

export function getCoreServiceChecks(progress: PlanningProgress): ServiceCheck[] {
  const stages = progress.stages || {};
  const isSucceeded = progress.status === 'succeeded';

  // 1. Attraction Discovery
  const attrStatus = isSucceeded ? 'done' : stages.attractions?.status || stages.restaurants?.status || 'waiting';
  const attrNote = stages.attractions?.note || stages.restaurants?.note;

  // 2. Flights & Hotels
  const travelStatus = isSucceeded ? 'done' : (
    stages.flights?.status === 'failed' || stages.hotels?.status === 'failed' ? 'failed' :
    stages.flights?.status === 'running' || stages.hotels?.status === 'running' ? 'running' :
    (stages.flights?.status === 'done' || stages.flights?.status === 'warning') &&
    (stages.hotels?.status === 'done' || stages.hotels?.status === 'warning') ? 'done' :
    stages.flights?.status || stages.hotels?.status || 'waiting'
  );
  const travelNote = stages.flights?.note || stages.hotels?.note;

  // 3. Itinerary Scheduling & Route
  const routeStatus = isSucceeded ? 'done' : stages.route?.status || stages.budget?.status || 'waiting';
  const routeNote = stages.route?.note || stages.budget?.note;

  // 4. Opening Hours & Validation
  const valStatus = isSucceeded ? 'done' : (
    stages.reviewer?.status === 'failed' || stages.opening_hours?.status === 'failed' ? 'failed' :
    stages.reviewer?.status === 'running' || stages.opening_hours?.status === 'running' ? 'running' :
    stages.reviewer?.status === 'done' || stages.opening_hours?.status === 'done' ? 'done' :
    stages.opening_hours?.status || stages.reviewer?.status || 'waiting'
  );
  const valNote = stages.reviewer?.note || stages.opening_hours?.note;

  return [
    { id: 'attractions', name: 'Attraction Discovery', icon: 'map-pin', status: attrStatus, note: attrNote },
    { id: 'flights-hotels', name: 'Flights & Hotels', icon: 'plane-hotel', status: travelStatus, note: travelNote },
    { id: 'schedule', name: 'Itinerary Scheduling', icon: 'calendar', status: routeStatus, note: routeNote },
    { id: 'opening-hours', name: 'Hours & Validation', icon: 'clock', status: valStatus, note: valNote },
  ];
}

export function calculateProgressPercentage(progress: PlanningProgress): number {
  if (progress.status === 'succeeded') return 100;
  if (progress.status === 'failed' || progress.status === 'interrupted') return 0;
  if (progress.status === 'restoring') return 10;
  if (progress.status === 'queued') return 15;

  const steps = planningSteps(progress);
  let totalScore = 0;
  for (const step of steps) {
    if (step.status === 'done' || step.status === 'warning') totalScore += 1;
    else if (step.status === 'running') totalScore += 0.5;
  }
  const pct = Math.round((totalScore / steps.length) * 100);
  return Math.min(95, Math.max(20, pct));
}

export function getStageDescription(progress: PlanningProgress): string {
  if (progress.status === 'succeeded') {
    return 'Your bespoke itinerary is ready with verified travel times, places, and stays.';
  }
  if (progress.status === 'failed' || progress.status === 'interrupted') {
    return progress.error || 'The planning request was interrupted. You can retry with saved context.';
  }
  if (progress.status === 'connection_lost') {
    return 'Connection check paused. Restore network connection or check API status.';
  }
  if (progress.status === 'queued') {
    return 'Queued with autonomous TravelAI agent worker...';
  }

  const stages = progress.stages || {};
  if (stages.synthesis?.status === 'running' || stages.saving?.status === 'running') {
    return 'Assembling and finalizing your day-by-day travel schedule...';
  }
  if (stages.reviewer?.status === 'running' || stages.opening_hours?.status === 'running') {
    return 'Verifying landmark opening hours, transit feasibility & time constraints...';
  }
  if (stages.route?.status === 'running' || stages.budget?.status === 'running') {
    return 'Calculating optimal routes, geographic transit & estimated expenses...';
  }
  if (stages.attractions?.status === 'running' || stages.restaurants?.status === 'running') {
    return 'Discovering top attractions, cultural sights & culinary experiences...';
  }
  if (stages.flights?.status === 'running' || stages.hotels?.status === 'running') {
    return 'Searching available flight routes and premier hotel accommodations...';
  }
  if (stages.parser?.status === 'running' || stages.planner?.status === 'running') {
    return 'Analyzing travel preferences, party size and pacing...';
  }
  return 'Architecting your personalized trip itinerary...';
}
