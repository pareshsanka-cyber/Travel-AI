import React, { useState, useMemo, useEffect } from 'react';
import {
  Compass,
  CheckCircle2,
  SkipForward,
  Navigation,
  Clock,
  MapPin,
  Calendar,
  AlertCircle,
  RotateCcw,
  Loader2,
  ExternalLink,
  ChevronRight,
  Sparkles,
  Award,
  ArrowRight,
  Info,
  X,
  Check,
  Utensils
} from 'lucide-react';
import {
  TripSummary,
  ItineraryDay,
  ActivitySegment,
  ExecutionState,
  RerouteProposal
} from '../../types';
import { resolvePlaceImage, getActivityCategoryMeta, CategoryPlaceholder, getCategoryFallbackImage } from './DayDetailView';
import {
  generatePersistentActivityId,
  resolveActivityExecutionRecord,
  migrateLegacyExecutionState,
  previewReroute,
  applyReroute,
} from '../../services/api';

interface CompanionModeProps {
  trip: TripSummary | null;
  days: ItineraryDay[];
  onUpdateExecutionState: (updates: Partial<ExecutionState>) => Promise<boolean>;
  onApplyRerouteResult?: (result: any) => void;
  onSwitchTab?: (tab: 'companion-tab' | 'route-tab' | 'flights-tab' | 'hotels-tab' | 'weather-tab' | 'budget-tab') => void;
}

export const CompanionMode: React.FC<CompanionModeProps> = ({
  trip,
  days,
  onUpdateExecutionState,
  onApplyRerouteResult,
  onSwitchTab,
}) => {
  // 1. Resolve Execution State with safe defaults and automated legacy migration
  const executionState: ExecutionState = useMemo(() => {
    const rawState = trip?.executionState || {
      is_active: true,
      current_day_number: 1,
      activity_log: {},
      reroute_history: [],
    };
    return migrateLegacyExecutionState(rawState, days);
  }, [trip?.executionState, days]);

  // 2. Active Day Selection (defaults to current_day_number from execution state)
  const [selectedDayNumber, setSelectedDayNumber] = useState<number>(() => {
    return executionState.current_day_number || 1;
  });

  // Keep selected day synchronized if current_day_number changes
  const activeDayNumber = executionState.current_day_number || 1;

  // 3. Loading & Error States for execution operations
  const [loadingKey, setLoadingKey] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Dynamic AI Rerouting States
  const [activeProposal, setActiveProposal] = useState<RerouteProposal | null>(null);
  const [isApplyingReroute, setIsApplyingReroute] = useState<boolean>(false);
  const [proposalError, setProposalError] = useState<string | null>(null);
  const [rerouteFeedback, setRerouteFeedback] = useState<{
    type: 'success' | 'info' | 'error';
    message: string;
  } | null>(null);

  // Traveler live GPS location for directions from current location
  const [currentLocation, setCurrentLocation] = useState<{ lat: number; lon: number } | null>(null);

  useEffect(() => {
    if (typeof window !== 'undefined' && 'geolocation' in navigator) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          setCurrentLocation({
            lat: pos.coords.latitude,
            lon: pos.coords.longitude,
          });
        },
        (err) => {
          console.debug('[CompanionMode] GPS prompt / status:', err.message);
        },
        { enableHighAccuracy: true, timeout: 5000, maximumAge: 60000 }
      );
    }
  }, []);

  // 4. Resolve Current Day Data
  const currentDay = useMemo(() => {
    return (
      days.find((d) => d.dayNumber === selectedDayNumber) ||
      days[0] || {
        dayNumber: 1,
        date: 'Day 1',
        title: `${trip?.destination || 'Destination'} Exploration`,
        transitBadge: 'Curated Itinerary',
        activities: [],
      }
    );
  }, [days, selectedDayNumber, trip?.destination]);

  const activities = currentDay.activities || [];
  const totalDays = days.length > 0 ? days.length : (trip?.daysCount || 1);

  // 5. Categorize Activities by Execution Status
  const {
    completedList,
    skippedList,
    unfinishedList,
    currentActivityObj,
    nextActivityObj,
    progressPercent,
  } = useMemo(() => {
    const completed: { act: ActivitySegment; index: number }[] = [];
    const skipped: { act: ActivitySegment; index: number }[] = [];
    const unfinished: { act: ActivitySegment; index: number }[] = [];

    activities.forEach((act, index) => {
      const { status } = resolveActivityExecutionRecord(
        act,
        selectedDayNumber,
        index,
        executionState.activity_log
      );

      if (status === 'completed') {
        completed.push({ act, index });
      } else if (status === 'skipped') {
        skipped.push({ act, index });
      } else {
        unfinished.push({ act, index });
      }
    });

    const current = unfinished.length > 0 ? unfinished[0] : null;
    const next = unfinished.length > 1 ? unfinished[1] : null;

    const completedCount = completed.length;
    const totalCount = activities.length;
    const percent = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;

    return {
      completedList: completed,
      skippedList: skipped,
      unfinishedList: unfinished,
      currentActivityObj: current,
      nextActivityObj: next,
      progressPercent: percent,
    };
  }, [activities, executionState.activity_log, selectedDayNumber]);

  // 6. Action Handlers

  // ✅ Mark Activity Complete
  const handleMarkComplete = async (act: ActivitySegment, actIndex: number) => {
    const actId = act.id || generatePersistentActivityId(act.type || act.category, act.title, act.placeId);
    const legacyKey = `${selectedDayNumber}_${actIndex}`;
    setLoadingKey(`${actId}_complete`);
    setErrorMessage(null);

    const entry = {
      status: 'completed' as const,
      activity_id: actId,
      activity_title: act.title,
      actual_end_time: new Date().toISOString(),
    };

    const updatedLog = {
      ...(executionState.activity_log || {}),
      // 1. Primary: Persistent activity ID (survives reordering & insertion)
      [actId]: entry,
      // 2. Dual-write under legacy position key with safety metadata
      [legacyKey]: entry,
    };

    const success = await onUpdateExecutionState({
      is_active: true,
      current_day_number: selectedDayNumber,
      activity_log: updatedLog,
    });

    setLoadingKey(null);
    if (!success) {
      setErrorMessage('Unable to save completion. Refresh and try again.');
    }
  };

  // ⏭️ Skip Activity & Trigger Dynamic AI Rerouting
  const handleSkip = async (act: ActivitySegment, actIndex: number) => {
    const actId = act.id || generatePersistentActivityId(act.type || act.category, act.title, act.placeId);
    const legacyKey = `${selectedDayNumber}_${actIndex}`;
    setLoadingKey(`${actId}_skip`);
    setErrorMessage(null);

    const entry = {
      status: 'skipped' as const,
      activity_id: actId,
      activity_title: act.title,
      actual_end_time: new Date().toISOString(),
    };

    const updatedLog = {
      ...(executionState.activity_log || {}),
      [actId]: entry,
      [legacyKey]: entry,
    };

    // 1. Mark the selected activity as skipped using its persistent ID & dual-write
    const success = await onUpdateExecutionState({
      is_active: true,
      current_day_number: selectedDayNumber,
      activity_log: updatedLog,
    });

    if (!success) {
      setErrorMessage('Unable to save skipped activity. Refresh and try again.');
      setLoadingKey(null);
      return;
    }

    // 2. Trigger Dynamic Rerouting Engine preview for the remaining day
    const tripId = trip?.id || (trip as any)?._id;
    if (tripId) {
      try {
        const proposal = await previewReroute(tripId, {
          day_number: selectedDayNumber,
          skipped_activity_id: actId,
          current_location: currentLocation || undefined,
        });

        if (proposal && proposal.status === 'success') {
          setActiveProposal(proposal);
          setProposalError(null);
        } else {
          setRerouteFeedback({
            type: 'info',
            message: 'Stop marked as skipped. Dynamic reroute adjustment not available for this stop.',
          });
        }
      } catch (err: any) {
        console.debug('[CompanionMode] Dynamic reroute preview notice:', err?.message || err);
        setRerouteFeedback({
          type: 'info',
          message: 'Stop skipped. Remaining schedule kept unchanged.',
        });
      }
    }

    setLoadingKey(null);
  };

  // ✅ Accept & Apply Dynamic Rerouting Proposal
  const handleAcceptProposal = async () => {
    if (!activeProposal) return;
    const tripId = trip?.id || (trip as any)?._id;
    if (!tripId) {
      setActiveProposal(null);
      return;
    }

    setIsApplyingReroute(true);
    setProposalError(null);

    try {
      const result = await applyReroute(tripId, {
        proposal_id: activeProposal.proposal_id,
        day_number: activeProposal.day_number,
        skipped_activity_id: activeProposal.skipped_activity.id,
        proposed_stops: activeProposal.proposed_stops,
        replacement_activity_id: activeProposal.replacement_activity?.id,
        reason: activeProposal.reason,
        expected_revision: activeProposal.revision,
      });

      if (result && result.status === 'success') {
        if (onApplyRerouteResult) {
          onApplyRerouteResult(result);
        }
        setActiveProposal(null);
        setRerouteFeedback({
          type: 'success',
          message: activeProposal.replacement_found
            ? `Itinerary updated! Added "${activeProposal.replacement_activity?.title || 'replacement stop'}" to your day.`
            : activeProposal.mode === 'skip_only'
              ? 'Stop marked as skipped. Your saved schedule is unchanged.'
              : 'Itinerary updated! Remaining stops were smoothly rescheduled.',
        });
      } else {
        setProposalError('Conflict: This trip was modified concurrently. Please refresh the page.');
      }
    } catch (err: any) {
      console.error('[CompanionMode] Apply reroute failed:', err);
      setProposalError(err?.message || 'Failed to apply reroute changes.');
    } finally {
      setIsApplyingReroute(false);
    }
  };

  // ❌ Cancel / Reject Dynamic Rerouting Proposal
  const handleCancelProposal = () => {
    setActiveProposal(null);
    setProposalError(null);
    setRerouteFeedback({
      type: 'info',
      message: 'Stop marked as skipped. Original schedule preserved.',
    });
  };

  // 🔄 Revert/Undo Activity Status (Reset to pending)
  const handleUndoStatus = async (act: ActivitySegment, actIndex: number) => {
    const actId = act.id || generatePersistentActivityId(act.type || act.category, act.title, act.placeId);
    const legacyKey = `${selectedDayNumber}_${actIndex}`;
    const posKey = `day_${selectedDayNumber}_act_${actIndex + 1}`;
    setLoadingKey(`${actId}_undo`);
    setErrorMessage(null);

    const updatedLog = { ...(executionState.activity_log || {}) };
    delete updatedLog[actId];
    delete updatedLog[legacyKey];
    delete updatedLog[posKey];

    const success = await onUpdateExecutionState({
      activity_log: updatedLog,
    });

    setLoadingKey(null);
    if (!success) {
      setErrorMessage('Unable to revert status. Please try again.');
    }
  };

  // 🗺️ Open Navigation Directions in Google Maps
  const handleNavigate = (act: ActivitySegment) => {
    let destParam = '';
    if (act.lat && act.lon) {
      destParam = `${act.lat},${act.lon}`;
    } else {
      const parts = [act.title, act.location, trip?.destination].filter(Boolean);
      destParam = parts.join(', ');
    }

    let url = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destParam)}&travelmode=driving`;

    // Pass destination_place_id if available to lock onto verified Google place entity
    if (act.placeId) {
      url += `&destination_place_id=${encodeURIComponent(act.placeId)}`;
    }

    // Route directly from traveler live GPS location if detected
    if (currentLocation) {
      url += `&origin=${currentLocation.lat},${currentLocation.lon}`;
    }

    window.open(url, '_blank', 'noopener,noreferrer');
  };

  // Set the selected day as the global active day in execution_state
  const handleSetCurrentDay = async (dayNum: number) => {
    setSelectedDayNumber(dayNum);
    setLoadingKey(`day_${dayNum}`);
    await onUpdateExecutionState({
      current_day_number: dayNum,
      is_active: true,
    });
    setLoadingKey(null);
  };

  return (
    <div className="w-full flex flex-col space-y-4 sm:space-y-6 pb-8 animate-in fade-in duration-300">
      {/* ERROR BANNER */}
      {errorMessage && (
        <div
          role="alert"
          className="p-3 sm:p-4 rounded-xl bg-error-container text-on-error-container border border-error/30 shadow-md flex items-center justify-between gap-3 text-xs sm:text-sm"
        >
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-error flex-shrink-0" />
            <span>{errorMessage}</span>
          </div>
          <button
            type="button"
            onClick={() => setErrorMessage(null)}
            className="text-xs font-semibold underline hover:no-underline ml-auto"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* REROUTE FEEDBACK BANNER */}
      {rerouteFeedback && (
        <div
          className={`p-3 sm:p-4 rounded-xl border shadow-sm flex items-center justify-between gap-3 text-xs sm:text-sm animate-in fade-in ${
            rerouteFeedback.type === 'success'
              ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-800 dark:text-emerald-300'
              : rerouteFeedback.type === 'error'
              ? 'bg-rose-500/10 border-rose-500/30 text-rose-800 dark:text-rose-300'
              : 'bg-primary/10 border-primary/20 text-primary'
          }`}
        >
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 flex-shrink-0" />
            <span>{rerouteFeedback.message}</span>
          </div>
          <button
            type="button"
            onClick={() => setRerouteFeedback(null)}
            className="p-1 hover:opacity-75 transition-opacity"
            title="Dismiss"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* 1. TOP HEADER / ACTIVE EXPEDITION SUMMARY */}
      <div className="p-4 sm:p-5 rounded-2xl bg-surface-container/90 border border-surface-container-high/80 shadow-md backdrop-blur-md">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="p-2.5 rounded-xl bg-primary/10 text-primary border border-primary/20">
              <Compass className="w-5 h-5 animate-[spin_10s_linear_infinite]" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-bold tracking-wider uppercase bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-ping" />
                  Live Companion Mode
                </span>
                <span className="text-xs text-on-surface-variant font-medium">
                  {trip?.destination || 'Expedition'}
                </span>
              </div>
              <h2 className="text-base sm:text-lg font-bold text-on-surface mt-0.5 tracking-tight">
                Day {selectedDayNumber}: {currentDay.title}
              </h2>
            </div>
          </div>

          {/* Quick Tab Switcher button to Route Map */}
          {onSwitchTab && (
            <button
              type="button"
              onClick={() => onSwitchTab('route-tab')}
              className="inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-xl bg-surface-container-high hover:bg-surface-bright text-xs font-medium text-on-surface border border-surface-container-highest transition-colors self-start sm:self-auto"
            >
              <Calendar className="w-3.5 h-3.5 text-primary" />
              <span>Full Route Overview</span>
            </button>
          )}
        </div>

        {/* DAY SELECTOR CHIPS */}
        <div className="mt-4 pt-3 border-t border-surface-container-high/60 flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-1">
          {Array.from({ length: totalDays }, (_, i) => i + 1).map((dayNum) => {
            const isSelected = dayNum === selectedDayNumber;
            const isToday = dayNum === activeDayNumber;
            return (
              <button
                key={dayNum}
                type="button"
                onClick={() => handleSetCurrentDay(dayNum)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-all ${
                  isSelected
                    ? 'bg-primary text-on-primary shadow-sm font-semibold'
                    : 'bg-surface-container-high/80 text-on-surface-variant hover:text-on-surface hover:bg-surface-bright border border-surface-container-highest/40'
                }`}
              >
                <span>Day {dayNum}</span>
                {isToday && (
                  <span
                    className={`px-1 py-0.2 rounded text-[9px] font-bold uppercase tracking-wider ${
                      isSelected
                        ? 'bg-on-primary/20 text-on-primary'
                        : 'bg-emerald-500/20 text-emerald-600 dark:text-emerald-400'
                    }`}
                  >
                    Current
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* DAY PROGRESS BAR */}
        <div className="mt-3.5">
          <div className="flex items-center justify-between text-xs text-on-surface-variant mb-1.5">
            <span className="font-medium">
              Today's Progress: {completedList.length} of {activities.length} completed
              {skippedList.length > 0 && ` • ${skippedList.length} skipped`}
            </span>
            <span className="font-bold text-primary">{progressPercent}%</span>
          </div>
          <div className="w-full h-2 rounded-full bg-surface-container-highest overflow-hidden flex">
            <div
              className="h-full bg-primary transition-all duration-500 rounded-full"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
        </div>
      </div>

      {/* 2. CURRENT / UP NEXT ACTIVITY HERO CARD */}
      {currentActivityObj ? (
        <div className="p-4 sm:p-6 rounded-2xl bg-gradient-to-br from-surface-container to-surface-container-low border-2 border-primary/40 shadow-xl relative overflow-hidden">
          {/* Background glowing aura */}
          <div className="absolute -top-16 -right-16 w-48 h-48 rounded-full bg-primary/10 blur-3xl pointer-events-none" />

          {/* Section Indicator */}
          <div className="flex items-center justify-between gap-2 mb-3">
            <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-primary text-on-primary text-[11px] font-bold tracking-wide uppercase shadow-sm">
              <span className="w-2 h-2 rounded-full bg-on-primary animate-pulse" />
              Up Next • Stop #{currentActivityObj.index + 1}
            </div>

            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-surface-container-highest/80 text-on-surface text-xs font-semibold border border-surface-container-highest">
              <Clock className="w-3.5 h-3.5 text-primary" />
              {currentActivityObj.act.time || '09:00 AM'}
              {currentActivityObj.act.timeOfDay && ` (${currentActivityObj.act.timeOfDay})`}
            </span>
          </div>

          {/* Main Card Content */}
          <div className="flex flex-col md:flex-row gap-4 sm:gap-6 items-start">
            {/* Image (when available) or Neutral Placeholder */}
            {(() => {
              const currentImg = resolvePlaceImage(currentActivityObj.act, trip?.destination);
              const currentMeta = getActivityCategoryMeta(currentActivityObj.act);
              return (
                <div className="w-full md:w-56 lg:w-64 h-48 sm:h-52 rounded-xl overflow-hidden bg-surface-container-highest flex-shrink-0 relative group shadow-md border border-surface-container-highest">
                  {currentImg ? (
                    <img
                      src={currentImg}
                      alt={currentActivityObj.act.title}
                      referrerPolicy="no-referrer"
                      className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                      onError={(e) => {
                        const fallback = getCategoryFallbackImage(currentActivityObj.act, trip?.destination);
                        if (fallback && e.currentTarget.src !== fallback) {
                          e.currentTarget.src = fallback;
                        } else {
                          e.currentTarget.style.display = 'none';
                        }
                      }}
                    />
                  ) : (
                    <CategoryPlaceholder categoryMeta={currentMeta} title={currentActivityObj.act.title} size="md" />
                  )}

                  {/* Category Pill Over Image */}
                  {currentActivityObj.act.category && (
                    <div className="absolute bottom-2 left-2 px-2 py-0.5 rounded-md bg-black/60 backdrop-blur-md text-white text-[10px] font-medium uppercase tracking-wider">
                      {currentActivityObj.act.category}
                    </div>
                  )}
                </div>
              );
            })()}

            {/* Details & Description */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap mb-1">
                {currentActivityObj.act.fameLevel === 'widely_known' && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300 border border-amber-300 dark:border-amber-700">
                    ⭐ Popular
                  </span>
                )}
                {currentActivityObj.act.fameLevel === 'lesser_known' && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-700">
                    💎 Lesser Known
                  </span>
                )}
                {currentActivityObj.act.matchType === 'interest_match' && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-primary/10 text-primary border border-primary/20">
                    ✨ Matches Your Interests
                  </span>
                )}
              </div>

              <h3 className="text-lg sm:text-xl font-bold text-on-surface tracking-tight leading-snug">
                {currentActivityObj.act.title}
              </h3>

              {/* Location & Distance when available */}
              <div className="flex items-center gap-1.5 text-xs text-on-surface-variant mt-1.5 flex-wrap">
                <MapPin className="w-3.5 h-3.5 text-primary flex-shrink-0" />
                <span>
                  {currentActivityObj.act.location || trip?.destination || 'Destination'}
                </span>
                {currentActivityObj.act.lat && currentActivityObj.act.lon && (
                  <span className="text-[11px] text-on-surface-variant/70 font-mono">
                    ({Number(currentActivityObj.act.lat).toFixed(4)}, {Number(currentActivityObj.act.lon).toFixed(4)})
                  </span>
                )}
              </div>

              {/* Description */}
              <p className="text-xs sm:text-sm text-on-surface-variant mt-2.5 line-clamp-3 leading-relaxed">
                {currentActivityObj.act.description}
              </p>

              {/* Interest Badges */}
              {currentActivityObj.act.interests && currentActivityObj.act.interests.length > 0 && (
                <div className="flex items-center gap-1.5 flex-wrap mt-3">
                  {currentActivityObj.act.interests.map((interest, iIdx) => (
                    <span
                      key={iIdx}
                      className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium bg-surface-container-highest text-on-surface-variant"
                    >
                      #{interest}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* ACTION BUTTONS (MOBILE-FIRST PROMINENT CONTROLS) */}
          <div className="mt-5 pt-4 border-t border-surface-container-high/80 flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5">
            {/* ✅ Mark Complete */}
            <button
              type="button"
              disabled={loadingKey !== null}
              onClick={() => handleMarkComplete(currentActivityObj.act, currentActivityObj.index)}
              className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-primary hover:bg-primary/90 text-on-primary font-semibold text-xs sm:text-sm shadow-md transition-all active:scale-[0.98] disabled:opacity-50"
            >
              {loadingKey === `${currentActivityObj.act.id || currentActivityObj.index}_complete` || loadingKey === `${selectedDayNumber}_${currentActivityObj.index}_complete` ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <CheckCircle2 className="w-4 h-4 text-emerald-300" />
              )}
              <span>Mark Complete</span>
            </button>

            {/* ⏭️ Skip */}
            <button
              type="button"
              disabled={loadingKey !== null}
              onClick={() => handleSkip(currentActivityObj.act, currentActivityObj.index)}
              className="inline-flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-surface-container-highest hover:bg-surface-bright text-on-surface font-semibold text-xs sm:text-sm border border-surface-container-highest transition-all active:scale-[0.98] disabled:opacity-50"
            >
              {loadingKey === `${currentActivityObj.act.id || currentActivityObj.index}_skip` || loadingKey === `${selectedDayNumber}_${currentActivityObj.index}_skip` ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <SkipForward className="w-4 h-4 text-amber-500" />
              )}
              <span>Skip Stop</span>
            </button>

            {/* 🗺️ Navigate */}
            <button
              type="button"
              onClick={() => handleNavigate(currentActivityObj.act)}
              className="inline-flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-surface-container-high hover:bg-surface-bright text-primary font-semibold text-xs sm:text-sm border border-primary/20 shadow-sm transition-all active:scale-[0.98]"
            >
              <Navigation className="w-4 h-4 text-primary" />
              <span>Navigate</span>
              <ExternalLink className="w-3 h-3 text-primary/70" />
            </button>
          </div>
        </div>
      ) : (
        /* ALL ACTIVITIES COMPLETED / CELEBRATION CARD */
        <div className="p-6 sm:p-8 rounded-2xl bg-surface-container border border-emerald-500/30 text-center shadow-lg relative overflow-hidden">
          <div className="w-16 h-16 rounded-full bg-emerald-500/10 text-emerald-500 border border-emerald-500/20 flex items-center justify-center mx-auto mb-3 shadow-inner">
            <Award className="w-8 h-8" />
          </div>
          <h3 className="text-lg sm:text-xl font-bold text-on-surface">
            Day {selectedDayNumber} Itinerary Complete! 🎉
          </h3>
          <p className="text-xs sm:text-sm text-on-surface-variant max-w-md mx-auto mt-1 leading-relaxed">
            All planned activities for today have been wrapped up or reviewed. Enjoy your evening or advance to the next day when ready!
          </p>

          {selectedDayNumber < totalDays && (
            <button
              type="button"
              onClick={() => handleSetCurrentDay(selectedDayNumber + 1)}
              className="mt-4 inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-primary text-on-primary text-xs sm:text-sm font-semibold shadow-md hover:bg-primary/90 transition-all active:scale-95"
            >
              <span>Advance to Day {selectedDayNumber + 1}</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          )}
        </div>
      )}

      {/* 3. NEXT ACTIVITY PREVIEW (UPCOMING AFTER CURRENT) */}
      {nextActivityObj && (
        <div className="p-3.5 sm:p-4 rounded-xl bg-surface-container/60 border border-surface-container-high/60 shadow-sm">
          <div className="flex items-center justify-between text-xs text-on-surface-variant mb-2">
            <span className="font-semibold uppercase tracking-wider text-[10px] text-primary">
              Upcoming Next (Stop #{nextActivityObj.index + 1})
            </span>
            <span className="inline-flex items-center gap-1 text-[11px] font-medium">
              <Clock className="w-3 h-3" />
              {nextActivityObj.act.time || '13:30 PM'}
            </span>
          </div>

          <div className="flex items-center gap-3">
            {(() => {
              const nextImg = resolvePlaceImage(nextActivityObj.act, trip?.destination);
              const nextMeta = getActivityCategoryMeta(nextActivityObj.act);
              return (
                <div className="w-12 h-12 rounded-lg bg-surface-container-highest overflow-hidden flex-shrink-0 border border-surface-container-highest flex items-center justify-center">
                  {nextImg ? (
                    <img
                      src={nextImg}
                      alt={nextActivityObj.act.title}
                      referrerPolicy="no-referrer"
                      className="w-full h-full object-cover"
                      onError={(e) => {
                        const fallback = getCategoryFallbackImage(nextActivityObj.act, trip?.destination);
                        if (fallback && e.currentTarget.src !== fallback) {
                          e.currentTarget.src = fallback;
                        } else {
                          e.currentTarget.style.display = 'none';
                        }
                      }}
                    />
                  ) : (
                    <CategoryPlaceholder categoryMeta={nextMeta} title={nextActivityObj.act.title} size="sm" />
                  )}
                </div>
              );
            })()}

            <div className="flex-1 min-w-0">
              <h4 className="text-xs sm:text-sm font-bold text-on-surface truncate">
                {nextActivityObj.act.title}
              </h4>
              <p className="text-[11px] text-on-surface-variant truncate mt-0.5">
                {nextActivityObj.act.description}
              </p>
            </div>

            <button
              type="button"
              onClick={() => handleNavigate(nextActivityObj.act)}
              title="Preview Directions"
              className="p-2 rounded-lg bg-surface-container-high hover:bg-surface-bright text-on-surface-variant hover:text-primary transition-colors flex-shrink-0"
            >
              <Navigation className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* 4. FULL TODAY'S TIMELINE / ALL ACTIVITIES STATUS */}
      <div className="p-4 sm:p-5 rounded-2xl bg-surface-container/80 border border-surface-container-high/60 shadow-md">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-bold text-on-surface flex items-center gap-2">
            <span>Day {selectedDayNumber} Timeline & Stops</span>
            <span className="px-2 py-0.5 rounded-full bg-surface-container-highest text-on-surface-variant text-[10px] font-medium">
              {activities.length} stops
            </span>
          </h3>

          <span className="text-[11px] text-on-surface-variant">
            Tap stop to view or adjust status
          </span>
        </div>

        {activities.length === 0 ? (
          <div className="p-6 text-center text-xs text-on-surface-variant">
            No scheduled stops found for this day.
          </div>
        ) : (
          <div className="space-y-3">
            {activities.map((act, idx) => {
              const { status } = resolveActivityExecutionRecord(
                act,
                selectedDayNumber,
                idx,
                executionState.activity_log
              );
              const isCurrent = currentActivityObj?.index === idx;

              return (
                <div
                  key={idx}
                  className={`p-3 rounded-xl border transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
                    isCurrent
                      ? 'bg-primary/5 border-primary shadow-sm'
                      : status === 'completed'
                      ? 'bg-emerald-500/5 border-emerald-500/20'
                      : status === 'skipped'
                      ? 'bg-amber-500/5 border-amber-500/20 opacity-75'
                      : 'bg-surface-container border-surface-container-high/50'
                  }`}
                >
                  <div className="flex items-start sm:items-center gap-3 min-w-0">
                    {/* Status Icon Indicator */}
                    <div className="mt-0.5 sm:mt-0 flex-shrink-0">
                      {status === 'completed' ? (
                        <div className="w-7 h-7 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30 flex items-center justify-center">
                          <CheckCircle2 className="w-4 h-4" />
                        </div>
                      ) : status === 'skipped' ? (
                        <div className="w-7 h-7 rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/30 flex items-center justify-center">
                          <SkipForward className="w-3.5 h-3.5" />
                        </div>
                      ) : isCurrent ? (
                        <div className="w-7 h-7 rounded-full bg-primary text-on-primary flex items-center justify-center shadow-sm">
                          <span className="w-2 h-2 rounded-full bg-on-primary animate-ping" />
                        </div>
                      ) : (
                        <div className="w-7 h-7 rounded-full bg-surface-container-highest text-on-surface-variant flex items-center justify-center text-xs font-bold">
                          {idx + 1}
                        </div>
                      )}
                    </div>

                    {/* Title & Metadata */}
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-[10px] font-semibold text-on-surface-variant">
                          {act.time || 'Scheduled'}
                        </span>
                        {status === 'completed' && (
                          <span className="px-1.5 py-0.2 rounded text-[9px] font-bold uppercase tracking-wider bg-emerald-500/20 text-emerald-600 dark:text-emerald-400">
                            Completed
                          </span>
                        )}
                        {status === 'skipped' && (
                          <span className="px-1.5 py-0.2 rounded text-[9px] font-bold uppercase tracking-wider bg-amber-500/20 text-amber-600 dark:text-amber-400">
                            Skipped
                          </span>
                        )}
                        {isCurrent && (
                          <span className="px-1.5 py-0.2 rounded text-[9px] font-bold uppercase tracking-wider bg-primary text-on-primary">
                            In Progress
                          </span>
                        )}
                      </div>

                      <h4
                        className={`text-xs sm:text-sm font-semibold truncate mt-0.5 ${
                          status === 'completed'
                            ? 'line-through text-on-surface-variant'
                            : status === 'skipped'
                            ? 'text-on-surface-variant italic'
                            : 'text-on-surface'
                        }`}
                      >
                        {act.title}
                      </h4>

                      <div className="flex items-center gap-1 text-[11px] text-on-surface-variant truncate">
                        <MapPin className="w-3 h-3 text-on-surface-variant/70 flex-shrink-0" />
                        <span>{act.location || trip?.destination || 'Location'}</span>
                      </div>
                    </div>
                  </div>

                  {/* Actions for this timeline item */}
                  <div className="flex items-center gap-1.5 self-end sm:self-center">
                    {/* Navigation Button */}
                    <button
                      type="button"
                      onClick={() => handleNavigate(act)}
                      title="Navigate"
                      className="p-1.5 rounded-lg bg-surface-container-high hover:bg-surface-bright text-on-surface-variant hover:text-primary transition-colors text-xs"
                    >
                      <Navigation className="w-3.5 h-3.5" />
                    </button>

                    {/* Quick Complete / Skip if pending */}
                    {status !== 'completed' && status !== 'skipped' && (
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          disabled={loadingKey !== null}
                          onClick={() => handleMarkComplete(act, idx)}
                          className="px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-[11px] font-medium transition-colors"
                        >
                          {loadingKey === `${act.id || idx}_complete` || loadingKey === `${selectedDayNumber}_${idx}_complete` ? (
                            <Loader2 className="w-3 h-3 animate-spin" />
                          ) : (
                            'Done'
                          )}
                        </button>
                        <button
                          type="button"
                          disabled={loadingKey !== null}
                          onClick={() => handleSkip(act, idx)}
                          title="Skip stop & suggest reroute"
                          className="px-2 py-1 rounded-lg bg-surface-container-highest hover:bg-surface-bright text-on-surface-variant hover:text-amber-500 text-[11px] font-medium transition-colors inline-flex items-center gap-1"
                        >
                          {loadingKey === `${act.id || idx}_skip` || loadingKey === `${selectedDayNumber}_${idx}_skip` ? (
                            <Loader2 className="w-3 h-3 animate-spin" />
                          ) : (
                            <>
                              <SkipForward className="w-3 h-3 text-amber-500" />
                              <span>Skip</span>
                            </>
                          )}
                        </button>
                      </div>
                    )}

                    {/* Undo option if completed or skipped */}
                    {(status === 'completed' || status === 'skipped') && (
                      <button
                        type="button"
                        disabled={loadingKey !== null}
                        onClick={() => handleUndoStatus(act, idx)}
                        title="Revert stop status"
                        className="p-1.5 rounded-lg hover:bg-surface-container-highest text-on-surface-variant hover:text-on-surface transition-colors text-xs inline-flex items-center gap-1"
                      >
                        {loadingKey === `${act.id || idx}_undo` || loadingKey === `${selectedDayNumber}_${idx}_undo` ? (
                          <Loader2 className="w-3 h-3 animate-spin" />
                        ) : (
                          <>
                            <RotateCcw className="w-3 h-3" />
                            <span className="text-[10px]">Undo</span>
                          </>
                        )}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* 4. DYNAMIC AI REROUTING PROPOSAL MODAL */}
      {activeProposal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4 animate-in fade-in">
          <div className="bg-surface-container border border-surface-container-high rounded-2xl max-w-xl w-full max-h-[90vh] flex flex-col shadow-2xl overflow-hidden">
            {/* Modal Header */}
            <div className="px-5 py-4 border-b border-surface-container-high/80 flex items-center justify-between bg-surface-container-low">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-primary/10 border border-primary/20 text-primary flex items-center justify-center shadow-sm">
                  <Sparkles className="w-5 h-5 text-primary animate-pulse" />
                </div>
                <div>
                  <h3 className="text-sm sm:text-base font-bold text-on-surface flex items-center gap-2">
                    Dynamic AI Rerouting
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-primary/15 text-primary border border-primary/20 uppercase tracking-wider">
                      Day {activeProposal.day_number}
                    </span>
                  </h3>
                  <p className="text-[11px] text-on-surface-variant">
                    {activeProposal.mode === 'skip_only' ? 'Skip stop without changing timings' : activeProposal.replacement_found ? 'Verified replacement found' : 'Schedule rebalanced'}
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={handleCancelProposal}
                className="w-8 h-8 rounded-lg hover:bg-surface-container-highest text-on-surface-variant hover:text-on-surface flex items-center justify-center transition-colors"
                title="Close"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-5 overflow-y-auto space-y-4">
              {/* Proposal Reason */}
              {activeProposal.reason && (
                <div className="p-3 rounded-xl bg-surface-container-high/60 border border-surface-container-highest text-xs text-on-surface-variant flex items-start gap-2.5">
                  <Info className="w-4 h-4 text-primary mt-0.5 flex-shrink-0" />
                  <p className="leading-relaxed">{activeProposal.reason}</p>
                </div>
              )}

              {/* Skipped Activity Indicator */}
              <div className="p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="w-7 h-7 rounded-lg bg-amber-500/20 text-amber-600 dark:text-amber-400 flex items-center justify-center flex-shrink-0">
                    <SkipForward className="w-4 h-4" />
                  </div>
                  <div className="min-w-0">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-amber-700 dark:text-amber-300">
                      Skipped Stop
                    </span>
                    <h4 className="text-xs sm:text-sm font-semibold text-on-surface line-through opacity-80 truncate">
                      {activeProposal.skipped_activity.title}
                    </h4>
                  </div>
                </div>
                {activeProposal.skipped_activity.time && (
                  <span className="text-[11px] font-medium text-amber-700 dark:text-amber-300 whitespace-nowrap">
                    {activeProposal.skipped_activity.time}
                  </span>
                )}
              </div>

              {/* Replacement Card OR Meal Break OR Graceful Notice */}
              {activeProposal.replacement_found && activeProposal.replacement_activity ? (() => {
                const repl = activeProposal.replacement_activity;
                const isMealBreak = Boolean((repl as any).is_meal_break || repl.isMealBreak || (repl as any).status_label === 'Meal Break' || repl.statusLabel === 'Meal Break');
                return (
                  <div className={`p-4 rounded-xl border space-y-2.5 shadow-sm ${
                    isMealBreak
                      ? 'bg-amber-500/10 border-amber-500/30'
                      : 'bg-emerald-500/10 border-emerald-500/30'
                  }`}>
                    <div className="flex items-center justify-between gap-2">
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider border ${
                        isMealBreak
                          ? 'bg-amber-500/20 text-amber-700 dark:text-amber-300 border-amber-500/30'
                          : 'bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 border-emerald-500/30'
                      }`}>
                        {isMealBreak ? (
                          <>
                            <Utensils className="w-3 h-3 text-amber-500" />
                            Dedicated Meal Break Preserved
                          </>
                        ) : (
                          <>
                            <Sparkles className="w-3 h-3 text-emerald-500" />
                            Verified Replacement Added
                          </>
                        )}
                      </span>
                      {repl.time && (
                        <span className={`inline-flex items-center gap-1 text-[11px] font-semibold ${
                          isMealBreak
                            ? 'text-amber-700 dark:text-amber-300'
                            : 'text-emerald-700 dark:text-emerald-300'
                        }`}>
                          <Clock className="w-3 h-3" />
                          {repl.time}
                        </span>
                      )}
                    </div>

                    <div>
                      <h4 className="text-sm sm:text-base font-bold text-on-surface">
                        {repl.title || (repl as any).name}
                      </h4>
                      <div className="flex items-center gap-2 text-xs text-on-surface-variant mt-0.5 flex-wrap">
                        {repl.category && (
                          <span className="capitalize">{repl.category}</span>
                        )}
                        {repl.rating && (
                          <span>• ⭐ {repl.rating}</span>
                        )}
                        {repl.location && (
                          <span>• {repl.location}</span>
                        )}
                      </div>
                    </div>

                    {repl.description && (
                      <p className="text-xs text-on-surface-variant leading-relaxed line-clamp-2">
                        {repl.description}
                      </p>
                    )}

                    {repl.whyVisit && (
                      <p className={`text-[11px] italic p-2 rounded-lg border ${
                        isMealBreak
                          ? 'text-amber-800 dark:text-amber-300/90 bg-amber-500/5 border-amber-500/20'
                          : 'text-emerald-800 dark:text-emerald-300/90 bg-emerald-500/5 border-emerald-500/20'
                      }`}>
                        💡 {repl.whyVisit}
                      </p>
                    )}
                  </div>
                );
              })() : (
                <div className="p-3.5 rounded-xl bg-blue-500/10 border border-blue-500/25 flex items-start gap-2.5">
                  <Info className="w-4 h-4 text-blue-500 mt-0.5 flex-shrink-0" />
                  <div className="text-xs text-on-surface-variant leading-relaxed">
                    {activeProposal.mode === 'skip_only'
                      ? 'Activity timings are unavailable for this older itinerary. No replacement or new timings will be added; your other stops stay as planned.'
                      : <><strong className="text-on-surface font-semibold">No replacement needed:</strong> No verified alternative fits the remaining schedule before evening without rushing. Your remaining stops have been smoothly advanced.</>}
                  </div>
                </div>
              )}

              {/* Proposed Schedule Preview */}
              <div>
                <h5 className="text-xs font-bold uppercase tracking-wider text-on-surface-variant mb-2">
                  Proposed Schedule for Day {activeProposal.day_number}
                </h5>
                <div className="space-y-1.5 max-h-56 overflow-y-auto pr-1">
                  {activeProposal.proposed_stops.map((stop: any, sIdx: number) => {
                    const stopTitle = stop.title || stop.name || 'Scheduled Activity';
                    const rawStatus = stop.status_label || (stop.id === activeProposal.replacement_activity?.id ? (stop.is_meal_break ? 'Meal Break' : 'Replacement') : (stop.rescheduled ? 'Rescheduled' : 'Unchanged'));
                    const isMealBreak = rawStatus === 'Meal Break' || Boolean(stop.is_meal_break);
                    const isReplacement = rawStatus === 'Replacement' && !isMealBreak;
                    const isRescheduled = rawStatus === 'Rescheduled';
                    const isUnchanged = rawStatus === 'Unchanged' || (!isReplacement && !isMealBreak && !isRescheduled);

                    const transitMins = stop.travel_time_from_prev_minutes || (stop.travel_time_from_prev ? parseInt(stop.travel_time_from_prev, 10) : undefined);
                    const transitText = stop.travel_time_from_prev || (transitMins ? `${transitMins} mins` : undefined);

                    return (
                      <div
                        key={stop.id || sIdx}
                        className={`p-2.5 rounded-lg border text-xs flex items-center justify-between gap-2.5 ${
                          isReplacement
                            ? 'bg-emerald-500/10 border-emerald-500/30'
                            : isMealBreak
                            ? 'bg-amber-500/10 border-amber-500/30'
                            : isRescheduled
                            ? 'bg-blue-500/10 border-blue-500/25'
                            : 'bg-surface-container-high/60 border-surface-container-highest'
                        }`}
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <div className="flex flex-col flex-shrink-0 w-24">
                            <span className="font-mono text-[11px] font-medium text-on-surface-variant">
                              {stop.time || `${sIdx + 1}`}
                            </span>
                            {sIdx > 0 && transitText && (
                              <span className="text-[10px] text-on-surface-variant/60 flex items-center gap-0.5">
                                <Navigation className="w-2.5 h-2.5" />
                                {transitText}
                              </span>
                            )}
                          </div>
                          <div className="min-w-0">
                            <span className="font-semibold text-on-surface truncate block">
                              {stopTitle}
                            </span>
                            {(stop.category || stop.type) && (
                              <span className="text-[10px] text-on-surface-variant/70 capitalize block">
                                {stop.category || stop.type}
                              </span>
                            )}
                          </div>
                        </div>

                        {isReplacement && (
                          <span className="px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30 flex-shrink-0">
                            Replacement
                          </span>
                        )}
                        {isMealBreak && (
                          <span className="px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider bg-amber-500/20 text-amber-700 dark:text-amber-300 border border-amber-500/30 flex-shrink-0">
                            Meal Break
                          </span>
                        )}
                        {isRescheduled && (
                          <span className="px-1.5 py-0.5 rounded text-[9px] font-semibold bg-blue-500/20 text-blue-700 dark:text-blue-300 border border-blue-500/30 flex-shrink-0">
                            Rescheduled
                          </span>
                        )}
                        {isUnchanged && (
                          <span className="px-1.5 py-0.5 rounded text-[9px] font-medium bg-surface-container-highest text-on-surface-variant flex-shrink-0">
                            Unchanged
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Conflict / Proposal Error */}
              {proposalError && (
                <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-700 dark:text-rose-300 text-xs flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 flex-shrink-0" />
                  <span>{proposalError}</span>
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div className="px-5 py-3.5 border-t border-surface-container-high/80 bg-surface-container-low flex flex-col sm:flex-row items-center justify-end gap-2.5">
              <button
                type="button"
                onClick={handleCancelProposal}
                disabled={isApplyingReroute}
                className="w-full sm:w-auto px-4 py-2.5 rounded-xl bg-surface-container-highest hover:bg-surface-bright text-on-surface text-xs font-semibold border border-surface-container-highest transition-all disabled:opacity-50"
              >
                Keep Schedule as is (Cancel)
              </button>

              <button
                type="button"
                onClick={handleAcceptProposal}
                disabled={isApplyingReroute}
                className="w-full sm:w-auto px-4 py-2.5 rounded-xl bg-primary hover:bg-primary/90 text-on-primary text-xs font-semibold shadow-md transition-all flex items-center justify-center gap-2 disabled:opacity-50"
              >
                {isApplyingReroute ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>Applying Changes...</span>
                  </>
                ) : (
                  <>
                    <Check className="w-3.5 h-3.5" />
                    <span>Accept & Update Schedule</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
