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

export const RouteTab: React.FC<RouteTabProps> = ({ trip, days, onSwitchTab }) => {
  const [selectedDayNumber, setSelectedDayNumber] = useState<number | null>(null);

  // If a specific Day is selected, render the full DayDetailView
  if (selectedDayNumber !== null) {
    const selectedDay = days.find((d) => d.dayNumber === selectedDayNumber) || days[0];
    if (selectedDay) {
      return (
        <DayDetailView
          trip={trip}
          day={selectedDay}
          totalDays={days.length}
          onBack={() => setSelectedDayNumber(null)}
          onSelectDay={(num) => setSelectedDayNumber(num)}
        />
      );
    }
  }

  return (
    <div className="space-y-space-md animate-in fade-in duration-200">
      {/* Live Companion Mode Banner */}
      {onSwitchTab && (
        <div className="p-3 sm:p-3.5 rounded-xl bg-gradient-to-r from-emerald-500/10 via-primary/10 to-transparent border border-emerald-500/20 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-sm">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="p-2 rounded-lg bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 flex-shrink-0">
              <Compass className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-on-surface">Traveler Companion Mode</span>
                <span className="px-1.5 py-0.2 rounded-full text-[9px] font-bold uppercase bg-emerald-500/20 text-emerald-600 dark:text-emerald-400">
                  {trip?.plusAccess ? 'Ready' : 'Trip Plus'}
                </span>
              </div>
              <p className="text-[11px] text-on-surface-variant truncate">
                Track today's stops, mark complete, skip, and open turn-by-turn navigation.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => onSwitchTab('companion-tab')}
            className="self-start sm:self-auto flex-shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary hover:bg-primary/90 text-on-primary text-xs font-semibold shadow-sm transition-colors whitespace-nowrap"
          >
            <span>{trip?.plusAccess ? 'Open Companion' : 'Unlock Companion'}</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Destination Micro Hero Map & Banner */}
      <div className="relative w-full h-44 rounded-xl overflow-hidden shadow-lg border border-surface-container-highest/60">
        <div
          className="w-full h-full bg-cover bg-center"
          data-location={trip?.destination || 'Goa, India'}
          style={{
            backgroundImage: `url('${
              trip?.heroImageUrl ||
              'https://lh3.googleusercontent.com/aida-public/AB6AXuBlx7gAJoMQBXDwbj6pcwTqIFcYOsmHvoW4FP-ompYmqI5sdLnZA_V_Vo7s2KaplYKZasc62M2PUG1oCM8TH0Z07k10P6QveYrXQL7OAzs_LtZujhGa5DgZj2B1Lt83FtvfbX5cf4OzbSPNc0HxZSxA0n70yRDsXRUzj3Cs3tyKLFvOticj1qWp-a5SvwUFFe5M7wTtu3leSHjY1VvKgmhcc0WV-OM1qDNk60-lJxEzj7UZUxDQDjkCFg'
            }')`,
          }}
        />
        <div className="absolute inset-0 bg-gradient-to-t from-surface-container-lowest via-surface-container-lowest/50 to-transparent p-space-md flex flex-col justify-end">
          <div className="flex items-center justify-between">
            <div>
              <span className="px-2 py-0.5 rounded-full bg-primary/20 text-primary text-[11px] font-semibold uppercase tracking-wider border border-primary/30">
                {trip?.bespokeCircuitLabel || 'Bespoke Circuit'}
              </span>
              <div className="font-semibold text-lg sm:text-xl text-on-surface mt-1">
                {trip?.routeHeadline || 'Curated Daily Route & Highlights'}
              </div>
            </div>
            <div className="text-right">
              <div className="text-[11px] text-on-surface-variant font-medium">Click Any Day For Maps & Places</div>
              <div className="text-sm font-semibold text-tertiary flex items-center gap-1.5 justify-end">
                <span className="w-2 h-2 rounded-full bg-tertiary animate-pulse" />
                <span>{days.length} Days Available</span>
              </div>
            </div>
          </div>
        </div>
      </div>

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
                  onClick={() => setSelectedDayNumber(day.dayNumber)}
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
                          setSelectedDayNumber(day.dayNumber);
                        }}
                        className="flex items-center gap-1 text-xs font-bold text-primary group-hover:translate-x-0.5 transition-transform bg-primary/10 px-2.5 py-1 rounded-lg border border-primary/20"
                      >
                        <span>Explore Day {day.dayNumber}</span>
                        <ArrowRight className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  {/* 3 Activities Columns */}
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-2 pt-1">
                    {day.activities.map((act, actIdx) => {
                      const colorClasses = {
                        primary: 'text-primary',
                        secondary: 'text-secondary',
                        tertiary: 'text-tertiary',
                      }[act.categoryColor] || 'text-primary';

                      return (
                        <div
                          key={`${day.dayNumber || dIdx}-act-${actIdx}-${act.timeOfDay}`}
                          className="p-space-sm rounded-lg bg-surface-container-low border border-surface-container-high/40 hover:border-surface-container-high space-y-1.5 transition-all"
                        >
                          {/* Mini Thumbnail Preview */}
                          {(() => {
                            const imgUrl = resolvePlaceImage(act, trip?.destination);
                            const categoryMeta = getActivityCategoryMeta(act);
                            return (
                              <div className="w-full h-24 rounded-md overflow-hidden relative mb-1 bg-surface-container-highest">
                                {imgUrl ? (
                                  <img
                                    src={imgUrl}
                                    alt={act.title}
                                    referrerPolicy="no-referrer"
                                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                                    loading="lazy"
                                    onError={(e) => {
                                      const fallback = getCategoryFallbackImage(act, trip?.destination);
                                      if (fallback && e.currentTarget.src !== fallback) {
                                        e.currentTarget.src = fallback;
                                      } else {
                                        e.currentTarget.style.display = 'none';
                                      }
                                    }}
                                  />
                                ) : (
                                  <CategoryPlaceholder categoryMeta={categoryMeta} title={act.title} size="sm" />
                                )}
                                <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent pointer-events-none" />
                                <span className="absolute bottom-1 left-1.5 text-[9px] font-bold text-white uppercase tracking-wider">
                                  {act.timeOfDay}
                                </span>
                              </div>
                            );
                          })()}

                          <div className="flex items-center justify-between gap-1">
                            <span className={`text-[10px] sm:text-[11px] font-semibold uppercase tracking-wider ${colorClasses}`}>
                              {act.timeOfDay} • {act.time}
                            </span>
                            {act.rating && (
                              <span className="flex items-center gap-0.5 text-[10px] font-semibold text-amber-500">
                                <Star className="w-2.5 h-2.5 fill-amber-500" />
                                {act.rating}
                              </span>
                            )}
                          </div>

                          <p className="text-xs font-semibold text-on-surface line-clamp-1">
                            {act.title}
                          </p>

                          {act.location && (
                            <p className="text-[10px] text-on-surface-variant flex items-center gap-1 line-clamp-1">
                              <MapPin className="w-2.5 h-2.5 flex-shrink-0" /> {act.location}
                            </p>
                          )}

                          <p className="text-xs text-on-surface-variant leading-relaxed line-clamp-2">
                            {act.description}
                          </p>

                          {/* Interest and Fame Badges */}
                          {(act.matchType || act.fameLevel || (act.interests && act.interests.length > 0)) && (
                            <div className="flex flex-wrap gap-1 mt-2 pt-2 border-t border-surface-container-highest/30">
                              {act.matchType === 'interest_match' && (
                                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider bg-primary/10 text-primary border border-primary/20">
                                  ✨ Matches Interests
                                </span>
                              )}
                              {act.matchType === 'popular_recommendation' && (
                                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider bg-secondary/10 text-secondary border border-secondary/20">
                                  🌟 Also Popular
                                </span>
                              )}
                              {act.fameLevel === 'widely_known' && (
                                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 border border-amber-300 dark:border-amber-700">
                                  ⭐ Popular
                                </span>
                              )}
                              {act.fameLevel === 'lesser_known' && (
                                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400 border border-emerald-300 dark:border-emerald-700">
                                  💎 Lesser Known
                                </span>
                              )}
                              {act.interests && act.interests.map((interest, iIdx) => (
                                <span key={iIdx} className="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-medium bg-surface-container-highest text-on-surface-variant">
                                  {interest}
                                </span>
                              ))}
                            </div>
                          )}

                          {/* Operating Hours Status Panel */}
                          <OperatingHoursPanel act={act} />
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
