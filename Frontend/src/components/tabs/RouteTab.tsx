import React, { useState } from 'react';
import { 
  CalendarDays, 
  Clock, 
  ChevronDown, 
  ChevronUp, 
  AlertTriangle, 
  CheckCircle, 
  HelpCircle, 
  MapPin, 
  ArrowRight, 
  Compass,
  Star
} from 'lucide-react';
import { TripSummary, ItineraryDay, ActivitySegment } from '../../types';
import { DayDetailView, resolvePlaceImage, getActivityCategoryMeta, CategoryPlaceholder, getCategoryFallbackImage } from './DayDetailView';

interface RouteTabProps {
  mode?: 'overview' | 'days';
  onOverview?: () => void; onOpenDay?: () => void;
  trip: TripSummary | null;
  days: ItineraryDay[];
  onSwitchTab?: (tab: 'companion-tab' | 'route-tab' | 'flights-tab' | 'hotels-tab' | 'weather-tab' | 'budget-tab') => void;
}

function StatusBadge({ status }: { status?: string }) {
  if (!status) return null;
  const upper = status.toUpperCase();
  if (upper === 'OPEN') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-emerald-100 text-emerald-700 border border-emerald-300 dark:bg-emerald-900/30 dark:text-emerald-400 dark:border-emerald-700">
        <CheckCircle className="w-3 h-3" /> Open
      </span>
    );
  }
  if (upper === 'CLOSED') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-rose-100 text-rose-700 border border-rose-300 dark:bg-rose-900/30 dark:text-rose-400 dark:border-rose-700">
        <AlertTriangle className="w-3 h-3" /> Closed
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-amber-100 text-amber-700 border border-amber-300 dark:bg-amber-900/30 dark:text-amber-400 dark:border-amber-700">
      <HelpCircle className="w-3 h-3" /> Unverified
    </span>
  );
}

function OperatingHoursPanel({ act }: { act: ActivitySegment }) {
  const [expanded, setExpanded] = useState(false);

  const hasHours = act.operatingHours && act.operatingHours.length > 0;
  const hasScheduledDate = act.scheduledDate || act.dayOfWeek;

  if (!act.operatingStatus && !hasHours && !hasScheduledDate) return null;

  return (
    <div className="mt-1.5 border-t border-surface-container-highest/50 pt-1.5">
      {/* Status row */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 flex-wrap">
          <StatusBadge status={act.operatingStatus} />
          {hasScheduledDate && (
            <span className="text-[10px] text-on-surface-variant">
              {act.dayOfWeek && <span>{act.dayOfWeek}</span>}
              {act.scheduledDate && <span> • {act.scheduledDate}</span>}
            </span>
          )}
        </div>

        {hasHours && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setExpanded(!expanded);
            }}
            className="flex items-center gap-0.5 text-[10px] font-medium text-primary hover:text-primary/80 transition-colors"
          >
            <Clock className="w-3 h-3" />
            Hours
            {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          </button>
        )}
      </div>

      {/* Warning for UNKNOWN */}
      {act.operatingStatus?.toUpperCase() === 'UNKNOWN' && (
        <p className="text-[10px] text-amber-600 dark:text-amber-400 mt-1 flex items-start gap-1">
          <AlertTriangle className="w-3 h-3 flex-shrink-0 mt-px" />
          Live hours unavailable — verify locally before visiting.
        </p>
      )}

      {/* Expandable hours list */}
      {expanded && hasHours && (
        <div className="mt-1.5 p-2 rounded-md bg-surface-container-lowest border border-surface-container-highest/40 text-[10px] text-on-surface-variant space-y-0.5 animate-in fade-in slide-in-from-top-1 duration-150">
          {act.operatingHours!.map((line: string, idx: number) => (
            <div key={idx} className="flex items-center gap-1">
              <Clock className="w-2.5 h-2.5 text-on-surface-variant/60 flex-shrink-0" />
              {line}
            </div>
          ))}
          {act.statusReason && (
            <div className="text-[9px] text-on-surface-variant/70 italic pt-1 border-t border-surface-container-highest/30">
              Source: {act.statusReason}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export const RouteTab: React.FC<RouteTabProps> = ({ trip, days, onSwitchTab, mode = 'overview', onOverview, onOpenDay }) => {
  const [selectedDayNumber, setSelectedDayNumber] = useState<number | null>(() => { const value = sessionStorage.getItem(`TRAVELAI_DAY:${trip?.id}`); return value ? Number(value) : null; });

  const selectDay = (day: number | null) => {
    setSelectedDayNumber(day);
    if (day === null) sessionStorage.removeItem(`TRAVELAI_DAY:${trip?.id}`);
    else sessionStorage.setItem(`TRAVELAI_DAY:${trip?.id}`, String(day));
  };
  // If a specific Day is selected, render the full DayDetailView
  if (mode === 'days') {
    const selectedDay = days.find((d) => d.dayNumber === selectedDayNumber) || days[0];
    if (selectedDay) {
      return (
        <><nav aria-label="Trip days" className="flex flex-wrap gap-2 mb-4">{days.map(day => <button type="button" key={day.dayNumber} aria-pressed={day.dayNumber === (selectedDayNumber || days[0]?.dayNumber)} onClick={() => { selectDay(day.dayNumber); onOpenDay?.(); }} className="px-4 py-2 rounded-xl border border-primary/30 text-sm text-primary">Day {day.dayNumber}</button>)}</nav><DayDetailView
          trip={trip}
          day={selectedDay}
          totalDays={days.length}
          onBack={() => { onOverview?.(); }}
          onSelectDay={selectDay}
        /></>
      );
    }
  }

  return (
    <div className="space-y-space-md animate-in fade-in duration-200">
      {/* Vertical Timeline Architecture */}
      {(!days || days.length === 0) ? (
        <div className="flex flex-col items-center justify-center p-12 rounded-2xl bg-surface-container border border-surface-container-highest/60 text-center space-y-3">
          <div className="w-12 h-12 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
            <CalendarDays className="w-6 h-6" />
          </div>
          <h3 className="text-base font-semibold text-on-surface">No route timeline yet</h3>
          <p className="text-xs text-on-surface-variant max-w-sm">
            Daily activities and travel waypoints have not been generated yet. Use the chat desk to draft a complete day-by-day itinerary.
          </p>
        </div>
      ) : (
        <div className="space-y-space-md relative before:absolute before:left-4 before:top-4 before:bottom-4 before:w-0.5 before:bg-surface-container-highest">
          {days.map((day, dIdx) => {
            const isDayOne = day.dayNumber === 1;
            return (
              <div key={day.dayNumber || `day-${dIdx}`} className="relative pl-10">
                {/* Day Number Badge */}
                <div
                  className={`absolute left-2 top-2.5 -translate-x-1/2 w-5 h-5 rounded-full flex items-center justify-center text-[11px] font-semibold shadow-md ${
                    isDayOne
                      ? 'bg-primary-container text-on-primary ring-2 ring-primary/40'
                      : 'bg-surface-container-highest text-on-surface'
                  }`}
                >
                  {day.dayNumber}
                </div>

                {/* Day Card (Clickable to open Detail Page) */}
                <div 
                  onClick={() => { selectDay(day.dayNumber); onOpenDay?.(); }}
                  className="cursor-pointer group rounded-xl bg-surface-container p-space-md shadow-md border border-surface-container-highest/40 hover:border-primary/60 hover:shadow-xl transition-all duration-200 space-y-space-sm"
                >
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h2 className="text-sm sm:text-base font-semibold text-on-surface group-hover:text-primary transition-colors">
                        {day.title}
                      </h2>
                      <span
                        className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${
                          isDayOne
                            ? 'bg-primary/10 text-primary border border-primary/20'
                            : 'bg-surface-container-highest text-on-surface-variant'
                        }`}
                      >
                        {day.date}
                      </span>
                    </div>

                    <div className="flex items-center gap-2 self-end sm:self-auto">
                      <span className="text-xs text-on-surface-variant font-medium">
                        {day.transitBadge}
                      </span>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          selectDay(day.dayNumber); onOpenDay?.();
                        }}
                        className="flex items-center gap-1 text-xs font-bold text-primary group-hover:translate-x-0.5 transition-transform bg-primary/10 px-2.5 py-1 rounded-lg border border-primary/20"
                      >
                        <span>Explore Day {day.dayNumber}</span>
                        <ArrowRight className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  <ol className="divide-y divide-surface-container-highest/40">
                    {day.activities.slice(0, 3).map((activity, index) => <li key={activity.id || index} className="flex items-start gap-3 py-3 text-sm"><span className="text-primary shrink-0 w-24">{activity.startTime || activity.time}</span><span className="min-w-0"><span className="font-medium">{activity.title}</span>{activity.location && <span className="block text-xs text-on-surface-variant mt-1">{activity.location}</span>}</span></li>)}
                  </ol>
                  {day.activities.length > 3 && <p className="text-xs text-primary">+{day.activities.length - 3} more stops ? Explore this day to see all</p>}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
