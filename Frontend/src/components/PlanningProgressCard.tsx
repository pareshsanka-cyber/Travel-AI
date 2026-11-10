import React, { useEffect, useState } from 'react';
import {
  Check,
  CheckCircle2,
  Clock3,
  Loader2,
  AlertCircle,
  AlertTriangle,
  Sparkles,
  MapPin,
  Plane,
  Calendar,
  Clock,
  ArrowRight,
  RefreshCw,
  WifiOff,
} from 'lucide-react';
import type { PlanningProgress } from '../services/planningProgress';
import {
  planningSteps,
  getCoreServiceChecks,
  calculateProgressPercentage,
  getStageDescription,
} from '../services/planningProgressModel';

interface PlanningProgressCardProps {
  progress: PlanningProgress;
  checking: boolean;
  onCheck?: () => void;
  onDismiss?: () => void;
  onRetry?: () => void;
  onApiSettings?: () => void;
}

export function PlanningProgressCard({
  progress,
  checking,
  onCheck,
  onDismiss,
  onRetry,
  onApiSettings,
}: PlanningProgressCardProps) {
  const [now, setNow] = useState(Date.now);
  const retryAt = Date.parse(progress.recovery?.retry_at || '');
  const wait = Number.isFinite(retryAt) ? Math.max(0, Math.ceil((retryAt - now) / 1000)) : 0;

  useEffect(() => {
    setNow(Date.now());
    if (!Number.isFinite(retryAt) || retryAt <= Date.now()) return;
    const timer = setInterval(() => {
      const clock = Date.now();
      setNow(clock);
      if (clock >= retryAt) clearInterval(timer);
    }, 1000);
    return () => clearInterval(timer);
  }, [retryAt]);

  const steps = planningSteps(progress);
  const coreChecks = getCoreServiceChecks(progress);
  const percentage = calculateProgressPercentage(progress);
  const stageDescription = getStageDescription(progress);

  const isCompleted = progress.status === 'succeeded';
  const stopped = ['failed', 'interrupted'].includes(progress.status);
  const disconnected = progress.status === 'connection_lost';
  const isRunning = !stopped && !disconnected && !isCompleted;

  const activeStep = [...steps].reverse().find((step) => step.status === 'running');

  // Dynamic headline based on active real state
  const headline = isCompleted
    ? 'Itinerary Successfully Generated'
    : stopped
    ? 'Request Needs Attention'
    : disconnected
    ? 'Connection Check Paused'
    : progress.status === 'restoring'
    ? 'Connecting to TravelAI Planner'
    : progress.status === 'queued'
    ? 'Queueing Itinerary Architect'
    : progress.kind === 'planning'
    ? activeStep?.label || 'Finalizing Your Schedule'
    : progress.stages.analysis?.status === 'running'
    ? 'Understanding Your Request'
    : 'Synthesizing Travel Plan';

  const renderServiceIcon = (icon: string) => {
    switch (icon) {
      case 'map-pin':
        return <MapPin className="w-3.5 h-3.5 text-primary shrink-0" />;
      case 'plane-hotel':
        return <Plane className="w-3.5 h-3.5 text-secondary shrink-0" />;
      case 'calendar':
        return <Calendar className="w-3.5 h-3.5 text-tertiary shrink-0" />;
      case 'clock':
        return <Clock className="w-3.5 h-3.5 text-amber-500 shrink-0" />;
      default:
        return <MapPin className="w-3.5 h-3.5 text-primary shrink-0" />;
    }
  };

  return (
    <section
      aria-label="Planning progress"
      className="min-w-0 w-full max-w-xl rounded-2xl bg-surface-container-high/95 border border-surface-container-highest/80 p-4 sm:p-5 shadow-xl transition-all duration-300"
    >
      {/* Top Status Header */}
      <div className="flex items-center justify-between gap-3 mb-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <div
            className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 shadow-sm ${
              isCompleted
                ? 'bg-emerald-500/15 text-emerald-500 border border-emerald-500/30'
                : stopped || disconnected
                ? 'bg-rose-500/15 text-rose-500 border border-rose-500/30'
                : 'bg-primary/15 text-primary border border-primary/30'
            }`}
          >
            {isCompleted ? (
              <Sparkles className="w-4 h-4 text-emerald-500" />
            ) : stopped ? (
              <AlertCircle className="w-4 h-4 text-rose-500" />
            ) : disconnected ? (
              <WifiOff className="w-4 h-4 text-rose-400" />
            ) : (
              <Loader2 className="w-4 h-4 text-primary animate-spin motion-reduce:animate-none" />
            )}
          </div>
          <div className="min-w-0">
            <h3 className="font-semibold text-sm sm:text-base text-on-surface truncate flex items-center gap-1.5">
              <span>{headline}</span>
            </h3>
            <p className="text-xs text-on-surface-variant truncate">
              {stageDescription}
            </p>
          </div>
        </div>

        {/* Live Progress Pill */}
        <div className="shrink-0 text-right">
          <span
            className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold border ${
              isCompleted
                ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30'
                : stopped || disconnected
                ? 'bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20'
                : 'bg-primary/10 text-primary border-primary/20'
            }`}
          >
            {isCompleted ? '100%' : `${percentage}%`}
          </span>
        </div>
      </div>

      {/* Progress Bar Track */}
      <div className="w-full h-1.5 rounded-full bg-surface-container-highest/60 overflow-hidden mb-4">
        <div
          role="progressbar"
          aria-valuenow={percentage}
          aria-valuemin={0}
          aria-valuemax={100}
          style={{ width: `${percentage}%` }}
          className={`h-full rounded-full transition-all duration-500 ease-out ${
            isCompleted
              ? 'bg-emerald-500'
              : stopped || disconnected
              ? 'bg-rose-500'
              : 'bg-gradient-to-r from-primary via-secondary to-primary bg-[length:200%_100%] animate-pulse'
          }`}
        />
      </div>

      {/* Live Stepper Sequence */}
      <div className="space-y-2 mb-4 bg-surface-container/60 rounded-xl p-3 border border-surface-container-highest/40">
        <div className="text-[11px] font-semibold text-on-surface-variant/80 uppercase tracking-wider mb-2 flex items-center justify-between">
          <span>AI Architecture Stages</span>
          <span className="text-[10px] normal-case font-normal text-on-surface-variant/60">Real-time graph events</span>
        </div>

        <ol className="space-y-2.5">
          {steps.map((step, idx) => {
            const isDone = step.status === 'done';
            const isStepRunning = step.status === 'running';
            const isFailed = step.status === 'failed';
            const isWarning = step.status === 'warning';
            const isWaiting = step.status === 'waiting';

            return (
              <li key={step.id} className="flex items-start gap-2.5 text-xs">
                {/* Node Indicator */}
                <div className="mt-0.5 shrink-0">
                  {isDone ? (
                    <div className="w-4 h-4 rounded-full bg-emerald-500 text-white flex items-center justify-center shadow-xs">
                      <Check className="w-2.5 h-2.5 stroke-[3]" />
                    </div>
                  ) : isStepRunning ? (
                    <div className="w-4 h-4 rounded-full bg-primary text-on-primary flex items-center justify-center ring-2 ring-primary/40 animate-pulse">
                      <Loader2 className="w-2.5 h-2.5 animate-spin" />
                    </div>
                  ) : isFailed ? (
                    <div className="w-4 h-4 rounded-full bg-rose-500 text-white flex items-center justify-center">
                      <AlertCircle className="w-2.5 h-2.5" />
                    </div>
                  ) : isWarning ? (
                    <div className="w-4 h-4 rounded-full bg-amber-500 text-white flex items-center justify-center">
                      <AlertTriangle className="w-2.5 h-2.5" />
                    </div>
                  ) : (
                    <div className="w-4 h-4 rounded-full border border-surface-container-highest bg-surface-container text-on-surface-variant flex items-center justify-center text-[10px] font-medium">
                      {idx + 1}
                    </div>
                  )}
                </div>

                {/* Step Title & Status */}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span
                      className={`font-medium ${
                        isDone
                          ? 'text-on-surface font-semibold'
                          : isStepRunning
                          ? 'text-primary font-semibold'
                          : isFailed
                          ? 'text-rose-500 font-semibold'
                          : 'text-on-surface-variant'
                      }`}
                    >
                      {step.label}
                    </span>

                    <span className="text-[10px] capitalize text-on-surface-variant/60">
                      {isDone
                        ? 'Done'
                        : isStepRunning
                        ? 'In progress...'
                        : isFailed
                        ? 'Failed'
                        : isWarning
                        ? 'Warning'
                        : 'Waiting'}
                    </span>
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      </div>

      {/* 4 Core Pillars: Real Travel Checks */}
      <div className="pt-2 border-t border-surface-container-highest/40">
        <p className="text-[11px] font-semibold text-on-surface-variant/80 uppercase tracking-wider mb-2">
          Real Backend Travel Checks
        </p>

        <div className="grid grid-cols-2 gap-2">
          {coreChecks.map((service) => {
            const isDone = service.status === 'done';
            const isSvcRunning = service.status === 'running';
            const isWarning = service.status === 'warning';
            const isFailed = service.status === 'failed';

            return (
              <div
                key={service.id}
                className={`p-2 rounded-xl border flex items-center justify-between gap-1.5 transition-all ${
                  isDone
                    ? 'bg-emerald-500/5 border-emerald-500/25 text-on-surface'
                    : isSvcRunning
                    ? 'bg-primary/5 border-primary/30 text-primary'
                    : isFailed
                    ? 'bg-rose-500/5 border-rose-500/30 text-rose-500'
                    : isWarning
                    ? 'bg-amber-500/5 border-amber-500/25 text-on-surface'
                    : 'bg-surface-container/80 border-surface-container-highest/70 text-on-surface'
                }`}
              >
                <div className="flex items-center gap-1.5 min-w-0">
                  {renderServiceIcon(service.icon)}
                  <span className="text-xs font-medium truncate">{service.name}</span>
                </div>

                <div className="shrink-0">
                  {isDone ? (
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                  ) : isSvcRunning ? (
                    <Loader2 className="w-3 h-3 text-primary animate-spin" />
                  ) : isFailed ? (
                    <AlertCircle className="w-3.5 h-3.5 text-rose-500" />
                  ) : isWarning ? (
                    <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />
                  ) : (
                    <Clock3 className="w-3 h-3 text-on-surface-variant/40" />
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Errors & Recovery Alerts */}
      {progress.error && (
        <div
          role="alert"
          className="mt-3 p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-600 dark:text-rose-400 text-xs leading-relaxed flex items-start gap-2"
        >
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <div className="min-w-0">
            <p className="font-semibold">Planning halted</p>
            <p className="mt-0.5">{progress.error}</p>
          </div>
        </div>
      )}

      {stopped && progress.recovery?.message && progress.recovery.message !== progress.error && (
        <p className="mt-2 text-xs text-on-surface-variant">{progress.recovery.message}</p>
      )}

      {(stopped || disconnected) && (
        <p className="mt-2 text-xs text-on-surface-variant">
          Your request details are preserved.
          {progress.trip_id ? ' An itinerary was saved; open it before planning again.' : ''}
        </p>
      )}

      {/* Interactive Action Controls */}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        {/* Completed State Action */}
        {isCompleted && onDismiss && (
          <button
            type="button"
            onClick={onDismiss}
            className="flex items-center gap-1.5 rounded-xl bg-primary hover:bg-primary/90 text-on-primary px-4 py-2 text-xs font-semibold transition-all shadow-md cursor-pointer"
          >
            <span>Explore Itinerary</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        )}

        {/* Retry Button */}
        {stopped && progress.recovery?.retryable && !progress.trip_id && onRetry && (
          <button
            type="button"
            onClick={onRetry}
            disabled={checking || wait > 0}
            className="flex items-center gap-1.5 rounded-xl bg-primary hover:bg-primary/90 text-on-primary px-3.5 py-2 text-xs font-semibold transition-all disabled:opacity-50 cursor-pointer shadow-sm"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${checking ? 'animate-spin' : ''}`} />
            <span>{wait ? `Retry available in ${wait}s` : 'Retry saved request'}</span>
          </button>
        )}

        {/* Connection Lost Actions */}
        {disconnected && onCheck && (
          <button
            type="button"
            onClick={onCheck}
            disabled={checking}
            className="flex items-center gap-1.5 rounded-xl bg-primary hover:bg-primary/90 text-on-primary px-3.5 py-2 text-xs font-semibold disabled:opacity-50 cursor-pointer shadow-sm"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${checking ? 'animate-spin' : ''}`} />
            <span>{checking ? 'Checking status…' : 'Check status'}</span>
          </button>
        )}

        {disconnected && onApiSettings && (
          <button
            type="button"
            onClick={onApiSettings}
            className="rounded-xl border border-primary/30 hover:bg-primary/5 px-3.5 py-2 text-xs font-semibold text-primary cursor-pointer transition-colors"
          >
            API Settings
          </button>
        )}

        {/* Dismiss / Return / Cancel Button */}
        {onDismiss && (
          <button
            type="button"
            onClick={onDismiss}
            disabled={checking}
            className="rounded-xl border border-primary/30 hover:bg-primary/5 text-primary px-3.5 py-2 text-xs font-semibold disabled:opacity-50 cursor-pointer transition-colors"
          >
            {isCompleted ? 'Close' : stopped ? (progress.trip_id ? 'View saved trip' : 'Return to planning') : 'Cancel request'}
          </button>
        )}
      </div>

      {/* Footer Info */}
      <div className="mt-3 pt-2.5 border-t border-surface-container-highest/30 flex items-center justify-between text-[11px] text-on-surface-variant/60">
        <span>{isRunning ? 'Live autonomous planning session' : isCompleted ? 'Verified autonomous schedule' : 'Request preserved in memory'}</span>
        {progress.request_id && (
          <span className="truncate max-w-40" title={progress.request_id}>
            Ref: {progress.request_id.slice(0, 8)}…
          </span>
        )}
      </div>
    </section>
  );
}
