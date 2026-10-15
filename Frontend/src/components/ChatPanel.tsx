import React, { useRef, useEffect, useMemo } from 'react';
import {
  Compass,
  MapPin,
  Clock,
  Wallet,
  Users,
  CheckCheck,
  Check,
  Plus,
  Plane,
  Hotel,
  Utensils,
  Eye,
  Mic,
  Paperclip,
  RotateCcw,
  Send,
  Star,
  Sparkles,
  Bot,
  Loader2
} from 'lucide-react';
import { ChatMessage, ApiStatusState, TripSummary } from '../types';
import { TravelPreferenceBar } from './preferences/TravelPreferenceBar';

interface ChatPanelProps {
  trip?: TripSummary | null;
  travelContext?: Record<string, any> | null;
  currentIntent?: string | null;
  onUpdatePreference?: (updates: Partial<Record<string, any>>) => void;
  messages: ChatMessage[];
  promptInput: string;
  onPromptChange: (val: string) => void;
  onSendMessage: (textToSend?: string) => void;
  isSending: boolean;
  onSwitchTab: (tabId: 'route-tab' | 'flights-tab' | 'hotels-tab' | 'weather-tab' | 'budget-tab') => void;
  apiStatus: ApiStatusState;
  onClearContext: () => void;
}

export const ChatPanel: React.FC<ChatPanelProps> = ({
  trip,
  travelContext,
  currentIntent,
  onUpdatePreference,
  messages,
  promptInput,
  onPromptChange,
  onSendMessage,
  isSending,
  onSwitchTab,
  apiStatus,
  onClearContext,
}) => {
  const feedEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    feedEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isSending]);

  // Dynamic context-aware suggestions based on current active trip or travel context
  const quickPrompts = useMemo(() => {
    const rawDest = (
      typeof travelContext?.destination === 'string'
        ? travelContext.destination
        : Array.isArray(travelContext?.destination)
        ? travelContext.destination.join(', ')
        : trip?.destination || ''
    );
    const dest = rawDest.split(',')[0].trim();
    if (!dest) {
      return [
        { label: '✨ Plan a bespoke trip', text: 'Help me plan a personalized bespoke vacation itinerary' },
        { label: '💳 Plan under budget', text: 'Plan a 3-day weekend trip under ₹30,000' },
        { label: '🏨 Find luxury stays', text: 'Find 5-star luxury accommodations for a relaxing getaway' },
        { label: '✈️ Flight recommendations', text: 'What are the best flight routes and timings for travel?' },
      ];
    }

    const isGoa = dest.toLowerCase().includes('goa');

    if (isGoa) {
      return [
        { label: '🏖️ Add more beaches', text: `Add more scenic beaches into the ${dest} itinerary` },
        { label: '🛕 Add temples', text: `Add historic temples and cultural sights to the ${dest} itinerary` },
        { label: '🍽️ Find restaurants', text: `Find top-rated local dining and seafood restaurants in ${dest}` },
        { label: '🏨 Change hotel', text: `Show alternative luxury hotel and resort options in ${dest}` },
        { label: '✈️ Change flights', text: 'Check alternative flight times and airline options' },
        { label: '📅 Update travel dates', text: `Can we adjust the travel dates and duration for this ${dest} trip?` },
        { label: '💰 Show budget breakdown', text: `Provide a granular budget breakdown for this ${dest} trip` },
      ];
    }

    return [
      { label: `🏛️ Add landmarks in ${dest}`, text: `Add more cultural sights and landmarks in ${dest} to the itinerary` },
      { label: '🍽️ Find restaurants', text: `Find top-rated local dining and culinary experiences in ${dest}` },
      { label: '🏨 Change hotel', text: `Show alternative luxury hotel accommodations in ${dest}` },
      { label: '✈️ Change flights', text: 'Check alternative flight times and airline options' },
      { label: '📅 Update travel dates', text: `Can we adjust the travel dates and duration for this ${dest} trip?` },
      { label: '💰 Show budget breakdown', text: `Provide a granular budget breakdown for this ${dest} trip` },
    ];
  }, [travelContext?.destination, trip?.destination]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      const trimmed = promptInput.trim();
      if (!isSending && trimmed) {
        onSendMessage(trimmed);
      }
    }
  };

  return (
    <section
      aria-label="Chat & Assistant Desk"
      className="w-full xl:w-[46%] flex flex-col rounded-2xl bg-surface-container-low/80 backdrop-blur-2xl border border-surface-container-high/60 shadow-xl overflow-hidden min-w-0 shrink-0 xl:shrink h-[38rem] xl:h-[calc(100vh-7rem)]"
    >
      {/* Live Context Status Bar */}
      <div className="p-3 sm:p-4 bg-surface-container/95 border-b border-surface-container-high/60 flex flex-col gap-2.5 relative z-30 overflow-visible">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <span className="inline-flex items-center justify-center w-7 h-7 rounded-lg bg-primary/10 text-primary">
              <Compass className="w-4 h-4 text-primary" />
            </span>
            <div>
              <span className="font-semibold text-sm sm:text-base text-on-surface tracking-tight">
                TravelAI Dispatch Engine
              </span>
              <span className="hidden sm:block text-[10px] text-on-surface-variant font-mono">
                Conversational Expedition Architect
              </span>
            </div>
          </div>
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-surface-container-high text-primary border border-surface-container-highest/80 shadow-xs">
            <span className="w-1.5 h-1.5 rounded-full bg-primary animate-ping" />
            <span className="text-[10px] font-semibold tracking-wider font-mono uppercase">
              {currentIntent || 'GENERATE_ITINERARY'}
            </span>
          </div>
        </div>

        {/* Professional Travel Preference Controls */}
        <TravelPreferenceBar
          trip={trip}
          travelContext={travelContext}
          messages={messages}
          onUpdatePreference={onUpdatePreference || (() => {})}
        />
      </div>

      {/* Message Feed */}
      <div className="flex-1 min-h-0 overflow-y-auto p-space-md space-y-space-md" id="chatMessageFeed">
        {messages.map((msg) => {
          if (msg.sender === 'user') {
            return (
              <div key={msg.id} className="flex justify-end">
                <div className="max-w-[85%] rounded-xl rounded-tr-xs bg-secondary-container p-space-md shadow-md text-on-surface border border-secondary/20">
                  <p className="text-sm leading-relaxed text-on-surface whitespace-pre-wrap">
                    {msg.text}
                  </p>
                  <div className="flex items-center justify-end gap-1 mt-1 text-on-secondary-container text-[11px]">
                    <span>{msg.timestamp}</span>
                    <CheckCheck className="w-3.5 h-3.5" />
                  </div>
                </div>
              </div>
            );
          }

          // Assistant Rich Message
          return (
            <div key={msg.id} className="flex gap-space-sm">
              <div className="w-8 h-8 rounded-full bg-primary/20 flex-shrink-0 flex items-center justify-center text-primary mt-1 shadow-sm border border-primary/30">
                <Bot className="w-4 h-4" />
              </div>
              <div className="flex-1 space-y-space-sm max-w-[92%]">
                <div className="rounded-xl rounded-tl-xs bg-surface-container-high p-space-md shadow-md space-y-space-sm text-on-surface border border-surface-container-highest/40">
                  {/* Rich Header if present */}
                  {msg.richContent?.versionHeadline && (
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-semibold text-primary">
                        {msg.richContent.versionHeadline}
                      </span>
                      {msg.richContent.optimizationRate && (
                        <span className="text-[11px] px-2 py-0.5 rounded-full bg-tertiary/10 text-tertiary border border-tertiary/20">
                          {msg.richContent.optimizationRate}
                        </span>
                      )}
                    </div>
                  )}

                  {/* Body Text / Lead Paragraph */}
                  {msg.richContent?.leadParagraph ? (
                    <p className="text-sm leading-relaxed text-on-surface">
                      {msg.richContent.leadParagraph}
                    </p>
                  ) : (
                    msg.text && (
                      <p className="text-sm leading-relaxed text-on-surface whitespace-pre-wrap">
                        {msg.text}
                      </p>
                    )
                  )}

                  {/* Highlights list */}
                  {msg.richContent?.highlights && (
                    <div className="space-y-1.5 py-1 text-on-surface-variant text-xs">
                      {msg.richContent.highlights.map((h, i) => (
                        <div key={`${msg.id}-h-${i}-${h.category}`} className="flex items-start gap-2">
                          {h.category === 'Transit' && (
                            <Plane className="w-4 h-4 text-primary flex-shrink-0 mt-0.5" />
                          )}
                          {h.category === 'Stay' && (
                            <Hotel className="w-4 h-4 text-tertiary flex-shrink-0 mt-0.5" />
                          )}
                          {h.category === 'Catering' && (
                            <Utensils className="w-4 h-4 text-secondary flex-shrink-0 mt-0.5" />
                          )}
                          {!['Transit', 'Stay', 'Catering'].includes(h.category) && (
                            <Sparkles className="w-4 h-4 text-primary flex-shrink-0 mt-0.5" />
                          )}
                          <span>
                            <strong className="text-on-surface">{h.category}:</strong> {h.detail}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Action Button */}
                  {msg.richContent?.actionButton && (
                    <div className="pt-1">
                      <button
                        type="button"
                        onClick={() =>
                          onSwitchTab(
                            msg.richContent?.actionButton?.tabTarget as 'route-tab' | 'flights-tab' | 'hotels-tab' | 'weather-tab' | 'budget-tab'
                          )
                        }
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-primary-container text-on-primary text-xs font-medium shadow-md hover:bg-primary transition-all cursor-pointer"
                      >
                        <Eye className="w-3.5 h-3.5" />
                        <span>{msg.richContent.actionButton.label}</span>
                      </button>
                    </div>
                  )}

                  {/* Hotel Mini Recommendation Cards */}
                  {msg.richContent?.hotelRecommendations && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
                      {msg.richContent.hotelRecommendations.map((hotel) => (
                        <div
                          key={hotel.id}
                          className="rounded-lg bg-surface-container p-2.5 flex flex-col justify-between shadow-sm border border-surface-container-highest hover:bg-surface-bright/20 transition-all"
                        >
                          <div className="space-y-1">
                            <div className="flex items-center justify-between">
                              <span className="font-semibold text-xs text-on-surface truncate">
                                {hotel.name}
                              </span>
                              <span className="flex items-center text-tertiary text-xs font-medium">
                                <Star className="w-3 h-3 fill-tertiary text-tertiary mr-0.5" />
                                {hotel.rating}
                              </span>
                            </div>
                            <span className="text-[11px] text-on-surface-variant block">
                              {hotel.locationSnippet}
                            </span>
                            <div className="text-xs font-semibold text-primary pt-0.5">
                              {hotel.pricePerNight}
                              <span className="text-[10px] text-on-surface-variant font-normal">
                                {' '}
                                / night
                              </span>
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => onSwitchTab('hotels-tab')}
                            className={`mt-2 w-full py-1 rounded text-[11px] font-medium transition-colors flex items-center justify-center gap-1 ${
                              hotel.isApplied
                                ? 'bg-primary text-on-primary shadow-sm'
                                : 'bg-surface-container-highest hover:bg-primary-container hover:text-on-primary text-on-surface'
                            }`}
                          >
                            {hotel.isApplied ? (
                              <>
                                <Check className="w-3 h-3" />
                                <span>Applied to Stay</span>
                              </>
                            ) : (
                              <>
                                <Plus className="w-3 h-3" />
                                <span>Append to Plan</span>
                              </>
                            )}
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}

        {isSending && (
          <div className="flex gap-space-sm items-center text-xs text-on-surface-variant">
            <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-primary animate-pulse">
              <Bot className="w-4 h-4" />
            </div>
            <div className="p-3 rounded-xl bg-surface-container-high text-xs text-on-surface flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-primary animate-ping" />
              <span>Querying FastAPI reasoning engine...</span>
            </div>
          </div>
        )}

        <div ref={feedEndRef} />
      </div>

      {/* Quick Action Prompt Chips */}
      <div className="px-space-md py-1.5 bg-surface-container-lowest/50 border-t border-surface-container-high/30 flex items-center gap-1.5 overflow-x-auto no-scrollbar">
        {quickPrompts.map((chip, idx) => (
          <button
            key={chip.label || `prompt-${idx}`}
            type="button"
            disabled={isSending}
            onClick={() => onSendMessage(chip.text)}
            className="whitespace-nowrap px-2.5 py-1 rounded-full bg-surface-container-high hover:bg-surface-bright text-on-surface-variant hover:text-on-surface text-xs transition-colors border border-surface-container-highest/60 flex-shrink-0 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {chip.label}
          </button>
        ))}
      </div>

      {/* Chat Input Deck */}
      <div className="p-space-md bg-surface-container/90 border-t border-surface-container-high/40 flex flex-col gap-2">
        <div className="relative rounded-xl bg-surface-container-lowest border border-surface-container-highest/60 shadow-inner p-1.5 flex flex-col gap-1 focus-within:border-primary/50 transition-colors">
          <textarea
            id="chatPromptInput"
            value={promptInput}
            onChange={(e) => onPromptChange(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask TravelAI to plan, refine hotels, or adjust itinerary..."
            rows={2}
            className="w-full bg-transparent text-on-surface placeholder:text-on-surface-variant text-xs sm:text-sm p-2 focus:outline-none resize-none"
          />

          <div className="flex items-center justify-between px-2 pb-1">
            <div className="flex items-center gap-1">
              <button
                type="button"
                aria-label="Audio Dictation"
                onClick={() => {
                  onPromptChange(promptInput ? `${promptInput} ` : '');
                }}
                className="p-1.5 rounded-lg text-on-surface-variant hover:text-primary hover:bg-surface-container-high transition-colors"
                title="Audio Dictation"
              >
                <Mic className="w-4 h-4" />
              </button>
              <label
                className="p-1.5 rounded-lg text-on-surface-variant hover:text-primary hover:bg-surface-container-high transition-colors cursor-pointer"
                title="Upload Reference Voucher"
                aria-label="Upload Reference Voucher"
              >
                <Paperclip className="w-4 h-4" />
                <input
                  type="file"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) {
                      onPromptChange(promptInput ? `${promptInput} [Attached Voucher: ${file.name}]` : `[Attached Voucher: ${file.name}]`);
                    }
                  }}
                />
              </label>
              <button
                type="button"
                aria-label="Clear chat context"
                onClick={onClearContext}
                className="flex items-center gap-1 px-2 py-1 rounded-lg text-on-surface-variant hover:text-error hover:bg-surface-container-high transition-colors text-xs"
                title="Clear current chat context without deleting active trip"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Clear Context</span>
              </button>
            </div>

            <button
              type="button"
              onClick={() => {
                const trimmed = promptInput.trim();
                if (trimmed && !isSending) {
                  onSendMessage(trimmed);
                }
              }}
              disabled={!promptInput.trim() || isSending}
              className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-gradient-to-r from-primary-container to-secondary-container text-on-primary text-xs sm:text-sm font-medium shadow-lg hover:shadow-primary/20 transition-all hover:scale-[1.02] active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {isSending ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Planning Trip...</span>
                </>
              ) : (
                <>
                  <span>Send Message</span>
                  <Send className="w-3.5 h-3.5" />
                </>
              )}
            </button>
          </div>
        </div>

        <p className="text-[11px] text-outline">Saved plans stay in sync. Confirm availability and reservations with providers.</p>
      </div>
    </section>
  );
};
