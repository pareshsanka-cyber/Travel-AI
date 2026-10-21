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
  return planningGroups.map(group => {
    const states = group.stages.map(stage => progress.stages[stage]?.status);
    const status = states.includes('failed') ? 'failed'
      : states.every(value => value === 'done' || value === 'warning') ? (states.includes('warning') ? 'warning' : 'done')
      : states.some(Boolean) ? 'running' : 'waiting';
    return { ...group, status };
  });
}
