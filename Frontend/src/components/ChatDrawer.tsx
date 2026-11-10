import React, { useEffect, useRef } from 'react';
import { Bot, X, Maximize2, History } from 'lucide-react';
import { ChatPanel } from './ChatPanel';
import type { ChatMessage, ApiStatusState, TripSummary } from '../types';
import type { PlanningProgress } from '../services/planningProgress';

interface ChatDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  trip: TripSummary | null;
  travelContext?: Record<string, any> | null;
  currentIntent?: string | null;
  onUpdatePreference?: (updates: Partial<Record<string, any>>) => void;
  messages: ChatMessage[];
  promptInput: string;
  onPromptChange: (val: string) => void;
  onSendMessage: (textToSend?: string, contextOverride?: Record<string, any>) => void;
  isSending: boolean;
  planningProgress?: PlanningProgress | null;
  onCheckPlanning?: () => void;
  onDismissPlanning?: () => void;
  onRetryPlanning?: () => void;
  onApiSettings?: () => void;
  onSwitchTab: (tabId: 'route-tab' | 'flights-tab' | 'hotels-tab' | 'weather-tab' | 'budget-tab') => void;
  apiStatus: ApiStatusState;
  onClearContext: () => void;
  onExpandToFull?: () => void;
  onOpenRevisionHistory?: () => void;
}

export const ChatDrawer: React.FC<ChatDrawerProps> = ({
  isOpen,
  onClose,
  trip,
  travelContext,
  currentIntent,
  onUpdatePreference,
  messages,
  promptInput,
  onPromptChange,
  onSendMessage,
  isSending,
  planningProgress,
  onCheckPlanning,
  onDismissPlanning,
  onRetryPlanning,
  onApiSettings,
  onSwitchTab,
  apiStatus,
  onClearContext,
  onExpandToFull,
  onOpenRevisionHistory,
}) => {
  const drawerRef = useRef<HTMLElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!isOpen) return;

    previouslyFocused.current = document.activeElement as HTMLElement | null;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);

    // Focus chat textarea on open
    const timer = setTimeout(() => {
      const inputEl = document.getElementById('chatPromptInput') as HTMLTextAreaElement | null;
      inputEl?.focus();
    }, 120);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      clearTimeout(timer);
      previouslyFocused.current?.focus();
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const rawDest = (
    typeof travelContext?.destination === 'string'
      ? travelContext.destination
      : Array.isArray(travelContext?.destination)
      ? travelContext.destination.join(', ')
      : trip?.destination || ''
  );
  const dest = rawDest.split(',')[0].trim();

  return (
    <div className="fixed inset-0 z-[1000] overflow-hidden pointer-events-auto">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/50 backdrop-blur-sm transition-opacity animate-in fade-in duration-200"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Slide-over Drawer Panel */}
      <aside
        ref={drawerRef}
        role="dialog"
        aria-modal="true"
        aria-label="TravelAI Assistant"
        className="fixed top-0 right-0 bottom-0 w-full sm:w-[480px] md:w-[520px] lg:w-[580px] max-w-full bg-surface-container-low shadow-2xl flex flex-col border-l border-surface-container-high/70 animate-in slide-in-from-right duration-200 overflow-hidden"
      >
        {/* Drawer Top Branding Header */}
        <div className="px-4 py-3 sm:px-5 sm:py-3.5 border-b border-surface-container-high/60 bg-surface-container/70 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-full bg-primary/20 text-primary flex items-center justify-center border border-primary/30 shrink-0">
              <Bot className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <h2 className="font-semibold text-sm sm:text-base text-on-surface truncate flex items-center gap-1.5">
                <span>TravelAI Assistant</span>
                {dest && (
                  <span className="text-xs px-2 py-0.5 rounded-full bg-primary/10 text-primary font-medium border border-primary/20">
                    {dest}
                  </span>
                )}
              </h2>
              {trip?.revision ? (
                <div className="flex items-center gap-1.5 text-[11px] text-on-surface-variant truncate">
                  <span>Active Itinerary</span>
                  <span>·</span>
                  {onOpenRevisionHistory ? (
                    <button
                      type="button"
                      onClick={onOpenRevisionHistory}
                      className="text-primary hover:underline font-semibold flex items-center gap-1 cursor-pointer"
                      title="View Revision History & AI Diff"
                    >
                      <History className="w-3 h-3" />
                      <span>Rev {trip.revision} Diff</span>
                    </button>
                  ) : (
                    <span>Revision {trip.revision}</span>
                  )}
                </div>
              ) : (
                <p className="text-[11px] text-on-surface-variant truncate">
                  Autonomous Concierge
                </p>
              )}
            </div>
          </div>

          <div className="flex items-center gap-1">
            {onExpandToFull && (
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onExpandToFull();
                }}
                className="p-1.5 rounded-lg hover:bg-surface-container-highest text-on-surface-variant hover:text-on-surface transition-colors cursor-pointer"
                title="Expand to full Studio"
                aria-label="Expand to full Studio"
              >
                <Maximize2 className="w-4 h-4" />
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              aria-label="Close TravelAI Assistant"
              className="p-1.5 rounded-lg hover:bg-surface-container-highest text-on-surface-variant hover:text-on-surface transition-colors cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Existing ChatPanel inside Drawer */}
        <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
          <ChatPanel
            isVisible={true}
            trip={trip}
            travelContext={travelContext}
            currentIntent={currentIntent}
            onUpdatePreference={onUpdatePreference}
            messages={messages}
            promptInput={promptInput}
            onPromptChange={onPromptChange}
            onSendMessage={onSendMessage}
            isSending={isSending}
            planningProgress={planningProgress}
            onCheckPlanning={onCheckPlanning}
            onDismissPlanning={onDismissPlanning}
            onRetryPlanning={onRetryPlanning}
            onApiSettings={onApiSettings}
            onSwitchTab={(tab) => {
              onSwitchTab(tab);
              onClose();
            }}
            apiStatus={apiStatus}
            onClearContext={onClearContext}
          />
        </div>
      </aside>
    </div>
  );
};
