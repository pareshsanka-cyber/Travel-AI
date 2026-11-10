import React, { useEffect, useState, useMemo, useRef } from 'react';
import {
  History,
  X,
  GitCompare,
  RotateCcw,
  PlusCircle,
  Clock,
  MinusCircle,
  CheckCircle2,
  Calendar,
  MapPin,
  Sparkles,
  ArrowRight,
  Filter,
  Layers,
  AlertCircle,
} from 'lucide-react';
import type {
  ItinerarySnapshot,
  ItineraryDiffResult,
  DiffActivityItem,
  DayDiff,
} from '../types';
import { computeItineraryDiff } from '../services/itineraryDiff';

interface RevisionHistoryDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  tripId: string;
  currentRevision: number;
  revisions: ItinerarySnapshot[];
  isLoading?: boolean;
  onRestoreRevision: (targetRevision: number) => Promise<boolean>;
}

type FilterMode = 'all' | 'changes_only' | 'added' | 'rescheduled' | 'removed';

export const RevisionHistoryDrawer: React.FC<RevisionHistoryDrawerProps> = ({
  isOpen,
  onClose,
  tripId,
  currentRevision,
  revisions,
  isLoading = false,
  onRestoreRevision,
}) => {
  const drawerRef = useRef<HTMLElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);

  // Selected revision to inspect
  const [selectedRevNum, setSelectedRevNum] = useState<number>(currentRevision);
  const [filterMode, setFilterMode] = useState<FilterMode>('all');
  const [isRestoring, setIsRestoring] = useState(false);
  const [confirmRestoreRev, setConfirmRestoreRev] = useState<number | null>(null);

  // Update selected revision when currentRevision changes or modal opens
  useEffect(() => {
    if (isOpen) {
      setSelectedRevNum(currentRevision);
      setConfirmRestoreRev(null);
    }
  }, [isOpen, currentRevision]);

  // Focus and Escape management
  useEffect(() => {
    if (!isOpen) return;

    previouslyFocused.current = document.activeElement as HTMLElement | null;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      if (previouslyFocused.current) {
        previouslyFocused.current.focus();
      }
    };
  }, [isOpen, onClose]);

  // Sort revisions ascending
  const sortedRevisions = useMemo(() => {
    return [...revisions].sort((a, b) => a.revision - b.revision);
  }, [revisions]);

  const selectedSnapshot = useMemo(() => {
    return (
      sortedRevisions.find((r) => r.revision === selectedRevNum) ||
      sortedRevisions.at(-1) ||
      null
    );
  }, [sortedRevisions, selectedRevNum]);

  // Previous snapshot for diff comparison (defaults to revision - 1, or revision 1 if at base)
  const previousSnapshot = useMemo(() => {
    if (!selectedSnapshot) return null;
    const idx = sortedRevisions.findIndex((r) => r.revision === selectedSnapshot.revision);
    if (idx > 0) {
      return sortedRevisions[idx - 1];
    }
    return sortedRevisions[0]; // If at Rev 1, compare against self
  }, [sortedRevisions, selectedSnapshot]);

  // Compute diff
  const diffResult: ItineraryDiffResult | null = useMemo(() => {
    if (!selectedSnapshot || !previousSnapshot) return null;
    return computeItineraryDiff(previousSnapshot, selectedSnapshot);
  }, [previousSnapshot, selectedSnapshot]);

  const handleRestoreClick = async (targetRev: number) => {
    setIsRestoring(true);
    try {
      const ok = await onRestoreRevision(targetRev);
      if (ok) {
        setConfirmRestoreRev(null);
      }
    } finally {
      setIsRestoring(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[1000] overflow-hidden pointer-events-auto">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/60 backdrop-blur-sm transition-opacity animate-in fade-in duration-200"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Slide-over Drawer */}
      <aside
        ref={drawerRef}
        role="dialog"
        aria-modal="true"
        aria-label="Itinerary Revision History and Visual Diff"
        className="fixed top-0 right-0 bottom-0 w-full sm:w-[560px] md:w-[640px] lg:w-[720px] max-w-full bg-surface-container-low shadow-2xl flex flex-col border-l border-surface-container-high/70 animate-in slide-in-from-right duration-200 overflow-hidden"
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-surface-container-high/60 bg-surface-container/80 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 rounded-full bg-primary/15 text-primary flex items-center justify-center border border-primary/30 shrink-0">
              <History className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h2 className="font-semibold text-base sm:text-lg text-on-surface truncate">
                  AI Revision History & Diff
                </h2>
                <span className="text-xs px-2 py-0.5 rounded-full bg-primary/10 text-primary font-semibold border border-primary/25">
                  Rev {currentRevision}
                </span>
              </div>
              <p className="text-xs text-on-surface-variant truncate">
                Compare itinerary snapshots and inspect changes made by TravelAI
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close revision history"
            className="p-2 rounded-xl hover:bg-surface-container-highest text-on-surface-variant hover:text-on-surface transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Revision Selector Timeline Strip */}
        <div className="px-5 py-3 border-b border-surface-container-high/40 bg-surface-container-lowest/50 shrink-0 overflow-x-auto">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-on-surface-variant shrink-0 flex items-center gap-1">
              <Layers className="w-3.5 h-3.5" />
              <span>Revisions:</span>
            </span>

            <div className="flex items-center gap-1.5 flex-1 min-w-0">
              {sortedRevisions.map((rev) => {
                const isSelected = rev.revision === selectedRevNum;
                const isCurrent = rev.revision === currentRevision;

                return (
                  <button
                    key={rev.revision}
                    type="button"
                    onClick={() => {
                      setSelectedRevNum(rev.revision);
                      setConfirmRestoreRev(null);
                    }}
                    className={`px-3 py-1.5 rounded-xl text-xs font-medium transition-all flex items-center gap-1.5 shrink-0 cursor-pointer border ${
                      isSelected
                        ? 'bg-primary text-on-primary border-primary shadow-sm'
                        : 'bg-surface-container hover:bg-surface-bright text-on-surface border-surface-container-highest/60'
                    }`}
                  >
                    <span>Rev {rev.revision}</span>
                    {isCurrent && (
                      <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-emerald-500/20 text-emerald-300 font-semibold">
                        Active
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Selected Revision Details & Change Stats Bar */}
        {selectedSnapshot && (
          <div className="px-5 py-3.5 bg-surface-container/40 border-b border-surface-container-high/50 shrink-0">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h3 className="font-semibold text-sm text-on-surface flex items-center gap-1.5">
                    <Sparkles className="w-3.5 h-3.5 text-primary" />
                    <span>{selectedSnapshot.summary}</span>
                  </h3>
                  <span className="text-[10px] text-on-surface-variant/70 uppercase tracking-wider px-1.5 py-0.5 rounded bg-surface-container-highest/50">
                    {selectedSnapshot.trigger}
                  </span>
                </div>
                <p className="text-[11px] text-on-surface-variant mt-0.5">
                  Saved on {new Date(selectedSnapshot.timestamp).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })} · {selectedSnapshot.daysCount} days planned
                </p>
              </div>

              {/* Restore Action Button */}
              {selectedSnapshot.revision !== currentRevision && (
                <div className="shrink-0">
                  {confirmRestoreRev === selectedSnapshot.revision ? (
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        disabled={isRestoring}
                        onClick={() => handleRestoreClick(selectedSnapshot.revision)}
                        className="px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold shadow-sm transition-all flex items-center gap-1 cursor-pointer disabled:opacity-50"
                      >
                        <RotateCcw className={`w-3.5 h-3.5 ${isRestoring ? 'animate-spin' : ''}`} />
                        <span>Confirm Restore?</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmRestoreRev(null)}
                        className="px-2 py-1.5 rounded-xl text-xs text-on-surface-variant hover:text-on-surface cursor-pointer"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setConfirmRestoreRev(selectedSnapshot.revision)}
                      className="px-3 py-1.5 rounded-xl border border-primary/40 hover:bg-primary/10 text-primary text-xs font-semibold shadow-sm transition-all flex items-center gap-1 cursor-pointer"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                      <span>Restore This Version</span>
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* Diff Stats Badges */}
            {diffResult && (
              <div className="mt-3 pt-2.5 border-t border-surface-container-highest/30 flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="text-on-surface-variant font-medium text-[11px]">
                    {selectedSnapshot.revision > 1
                      ? `vs Rev ${diffResult.fromRevision}:`
                      : 'Initial Plan baseline:'}
                  </span>

                  <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/25">
                    <PlusCircle className="w-3 h-3" />
                    <span>+{diffResult.totalAdded} Added</span>
                  </span>

                  <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/25">
                    <Clock className="w-3 h-3" />
                    <span>~{diffResult.totalRescheduled} Rescheduled</span>
                  </span>

                  <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/25">
                    <MinusCircle className="w-3 h-3" />
                    <span>-{diffResult.totalRemoved} Replaced</span>
                  </span>
                </div>

                {/* Filter Pills */}
                <div className="flex items-center gap-1 text-[11px]">
                  <Filter className="w-3 h-3 text-on-surface-variant/60" />
                  {(['all', 'changes_only', 'added', 'rescheduled', 'removed'] as const).map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => setFilterMode(mode)}
                      className={`px-2 py-0.5 rounded-lg transition-all capitalize cursor-pointer ${
                        filterMode === mode
                          ? 'bg-surface-bright text-on-surface font-semibold shadow-xs'
                          : 'text-on-surface-variant hover:text-on-surface'
                      }`}
                    >
                      {mode === 'all'
                        ? 'All'
                        : mode === 'changes_only'
                        ? 'Changes'
                        : mode}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Day-by-Day Diff Feed */}
        <div className="flex-1 min-h-0 overflow-y-auto p-5 space-y-5">
          {isLoading ? (
            <div className="p-8 text-center text-sm text-on-surface-variant">
              Loading revision snapshots…
            </div>
          ) : !diffResult || diffResult.dayDiffs.length === 0 ? (
            <div className="p-8 text-center rounded-2xl bg-surface-container/40 border border-surface-container-highest/40">
              <Sparkles className="w-8 h-8 text-primary mx-auto mb-2 opacity-80" />
              <h4 className="font-semibold text-sm text-on-surface">Initial Plan (Revision 1)</h4>
              <p className="text-xs text-on-surface-variant mt-1 max-w-sm mx-auto">
                This is your foundational AI itinerary. Whenever you ask the TravelAI chatbot to add places, change flights, or reroute activities, visual diffs will appear here!
              </p>
            </div>
          ) : (
            diffResult.dayDiffs.map((day) => {
              // Apply filter
              const filteredItems = day.items.filter((item) => {
                if (filterMode === 'all') return true;
                if (filterMode === 'changes_only') return item.changeType !== 'unchanged';
                if (filterMode === 'added') return item.changeType === 'added';
                if (filterMode === 'rescheduled') return item.changeType === 'rescheduled';
                if (filterMode === 'removed') return item.changeType === 'removed';
                return true;
              });

              if (filteredItems.length === 0 && filterMode !== 'all') {
                return null;
              }

              return (
                <div
                  key={day.dayNumber}
                  className="rounded-2xl border border-surface-container-highest/50 bg-surface-container/50 overflow-hidden shadow-xs"
                >
                  {/* Day Header */}
                  <div className="px-4 py-2.5 bg-surface-container-high/60 border-b border-surface-container-highest/40 flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="w-5 h-5 rounded-full bg-primary/20 text-primary flex items-center justify-center text-xs font-bold">
                        {day.dayNumber}
                      </span>
                      <h4 className="font-semibold text-xs sm:text-sm text-on-surface">
                        {day.title}
                      </h4>
                      {day.date && (
                        <span className="text-[11px] text-on-surface-variant">
                          · {day.date}
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-1.5 text-[11px]">
                      {day.addedCount > 0 && (
                        <span className="px-1.5 py-0.2 rounded bg-emerald-500/15 text-emerald-400 font-semibold">
                          +{day.addedCount}
                        </span>
                      )}
                      {day.rescheduledCount > 0 && (
                        <span className="px-1.5 py-0.2 rounded bg-amber-500/15 text-amber-400 font-semibold">
                          ~{day.rescheduledCount}
                        </span>
                      )}
                      {day.removedCount > 0 && (
                        <span className="px-1.5 py-0.2 rounded bg-rose-500/15 text-rose-400 font-semibold">
                          -{day.removedCount}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Activity Diff Cards */}
                  <div className="p-3 space-y-2">
                    {filteredItems.map((item) => {
                      const isAdded = item.changeType === 'added';
                      const isRescheduled = item.changeType === 'rescheduled';
                      const isRemoved = item.changeType === 'removed';
                      const isUnchanged = item.changeType === 'unchanged';

                      return (
                        <div
                          key={item.id + item.changeType}
                          className={`p-3 rounded-xl border transition-all text-xs flex items-start gap-3 ${
                            isAdded
                              ? 'bg-emerald-500/5 border-emerald-500/35 text-on-surface'
                              : isRescheduled
                              ? 'bg-amber-500/5 border-amber-500/35 text-on-surface'
                              : isRemoved
                              ? 'bg-rose-500/5 border-rose-500/35 text-on-surface-variant opacity-80'
                              : 'bg-surface-container-low border-surface-container-highest/40 text-on-surface'
                          }`}
                        >
                          {/* Status Icon */}
                          <div className="mt-0.5 shrink-0">
                            {isAdded ? (
                              <PlusCircle className="w-4 h-4 text-emerald-500" />
                            ) : isRescheduled ? (
                              <Clock className="w-4 h-4 text-amber-500" />
                            ) : isRemoved ? (
                              <MinusCircle className="w-4 h-4 text-rose-500" />
                            ) : (
                              <CheckCircle2 className="w-4 h-4 text-on-surface-variant/40" />
                            )}
                          </div>

                          {/* Activity Details */}
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center justify-between gap-1 mb-1">
                              <span
                                className={`font-semibold ${
                                  isAdded
                                    ? 'text-emerald-400'
                                    : isRescheduled
                                    ? 'text-amber-400'
                                    : isRemoved
                                    ? 'line-through text-rose-400'
                                    : 'text-on-surface'
                                }`}
                              >
                                {item.title}
                              </span>

                              {/* Diff Badge */}
                              <span
                                className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider ${
                                  isAdded
                                    ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                                    : isRescheduled
                                    ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                                    : isRemoved
                                    ? 'bg-rose-500/20 text-rose-400 border border-rose-500/30'
                                    : 'bg-surface-container-highest/60 text-on-surface-variant/70'
                                }`}
                              >
                                {isAdded
                                  ? '+ Added'
                                  : isRescheduled
                                  ? '~ Rescheduled'
                                  : isRemoved
                                  ? '- Replaced'
                                  : 'Unchanged'}
                              </span>
                            </div>

                            {/* Time Slot & Shift Breakdown */}
                            <div className="flex flex-wrap items-center gap-3 text-[11px] text-on-surface-variant">
                              {isRescheduled && item.previousTime && (
                                <div className="flex items-center gap-1 font-medium text-amber-400">
                                  <span className="line-through opacity-70">{item.previousTime}</span>
                                  <ArrowRight className="w-3 h-3" />
                                  <span>{item.currentTime}</span>
                                </div>
                              )}

                              {!isRescheduled && (item.currentTime || item.previousTime) && (
                                <div className="flex items-center gap-1">
                                  <Clock className="w-3 h-3 text-on-surface-variant/60" />
                                  <span>{item.currentTime || item.previousTime}</span>
                                </div>
                              )}

                              {item.location && (
                                <div className="flex items-center gap-1 truncate max-w-[200px]" title={item.location}>
                                  <MapPin className="w-3 h-3 text-on-surface-variant/60" />
                                  <span className="truncate">{item.location}</span>
                                </div>
                              )}
                            </div>

                            {item.description && (
                              <p className="mt-1 text-[11px] text-on-surface-variant/80 line-clamp-2">
                                {item.description}
                              </p>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-surface-container-high/60 bg-surface-container/70 flex items-center justify-between text-xs text-on-surface-variant shrink-0">
          <div className="flex items-center gap-1.5">
            <Sparkles className="w-3.5 h-3.5 text-primary" />
            <span>Autonomous schedule change tracking</span>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 rounded-xl border border-surface-container-highest bg-surface-container-high hover:bg-surface-bright text-on-surface font-semibold transition-colors cursor-pointer"
          >
            Close
          </button>
        </div>
      </aside>
    </div>
  );
};
