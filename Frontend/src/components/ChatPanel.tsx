import React, { useRef, useEffect, useLayoutEffect, useMemo, useState } from 'react';
import {
  Compass,
  MapPin,
  Navigation,
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
import { TripDetailsDialog } from './preferences/TripDetailsDialog';
import { PlanningProgressCard } from './PlanningProgressCard';
import type { PlanningProgress } from '../services/planningProgress';
import { useMessageEntrances } from '../motion/useInteractionMotion';

interface ChatPanelProps {
  isVisible?: boolean;
  trip?: TripSummary | null;
  travelContext?: Record<string, any> | null;
  currentIntent?: string | null;
  onUpdatePreference?: (updates: Partial<Record<string, any>>) => void;
  messages: ChatMessage[];
  promptInput: string;
  onPromptChange: (val: string) => void;
  onSendMessage: (textToSend?: string) => void;
  isSending: boolean;
  planningProgress?: PlanningProgress | null;
  onCheckPlanning?: () => void;
  onDismissPlanning?: () => void;
  onRetryPlanning?: () => void;
  onApiSettings?: () => void;
  onSwitchTab: (tabId: 'route-tab' | 'flights-tab' | 'hotels-tab' | 'weather-tab' | 'budget-tab') => void;
  apiStatus: ApiStatusState;
  onClearContext: () => void;
}

export const ChatPanel: React.FC<ChatPanelProps> = ({
  isVisible = true,
  trip,
  travelContext,
  currentIntent,
  onUpdatePreference,
  messages,
  promptInput,
  onPromptChange,
  onSendMessage,
  isSending: isSendingRequest,
  planningProgress,
  onCheckPlanning,
  onDismissPlanning,
  onRetryPlanning, onApiSettings,
  onSwitchTab,
  apiStatus,
  onClearContext,
}) => {
  const isSending = isSendingRequest || Boolean(planningProgress);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [moreSuggestions, setMoreSuggestions] = useState(false);
  const feedEndRef = useRef<HTMLDivElement>(null);
  const messageIds = useMemo(() => messages.map(message => message.id), [messages]);
  const messageFeed = useMessageEntrances(messageIds, isSending, isVisible);
  const followingFeed = useRef(true);
  useLayoutEffect(() => {
    const feed = messageFeed.current;
    if (feed && followingFeed.current && planningProgress && ['failed', 'interrupted', 'connection_lost'].includes(planningProgress.status)) feed.scrollTop = feed.scrollHeight;
  }, [planningProgress?.status]);

  useEffect(() => {
    const feed = document.getElementById('chatMessageFeed');
    if (feed) feed.scrollTop = feed.scrollHeight;
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
      aria-label="TravelAI conversation"
      className="chat-panel w-full flex flex-col rounded-2xl bg-surface-container-low/80 backdrop-blur-2xl border border-surface-container-high/60 shadow-xl min-w-0 min-h-0 flex-1 overflow-hidden"
    >
      <div className="p-4 sm:p-5 border-b border-surface-container-high/60 flex flex-wrap justify-between items-center gap-3 shrink-0">
        <div className="min-w-0"><h2 className="font-semibold text-lg">{travelContext?.current_trip_id ? `Edit your ${travelContext.destination || 'saved'} trip` : 'Plan your next trip'}</h2><p className="text-sm text-on-surface-variant mt-1">{[travelContext?.destination || 'Choose a destination', travelContext?.days ? `${travelContext.days} days` : '', travelContext?.travelers ? `${travelContext.travelers} travelers` : ''].filter(Boolean).join(' · ')}</p></div>
        <button type="button" onClick={() => setDetailsOpen(true)} className="rounded-xl border border-primary/30 px-4 py-2 text-primary text-sm font-semibold">Trip details</button>
      </div>
      {detailsOpen && <TripDetailsDialog context={travelContext} onApply={onUpdatePreference || (() => {})} onClose={() => setDetailsOpen(false)} />}

      {/* Message Feed */}
      <div ref={messageFeed} onScroll={event => { const feed = event.currentTarget; followingFeed.current = feed.scrollHeight - feed.scrollTop - feed.clientHeight < 96; }} className="flex-1 min-h-0 overflow-y-auto p-space-md space-y-space-md" id="chatMessageFeed" aria-busy={planningProgress ? undefined : isSending}>
        {messages.map((msg) => {
          if (msg.sender === 'user') {
            return (
              <div key={msg.id} data-message-id={msg.id} className="flex justify-end">
                <div className="max-w-[85%] sm:max-w-[75%] rounded-xl rounded-tr-xs bg-secondary-container p-space-md shadow-md text-on-surface border border-secondary/20">
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
            <div key={msg.id} data-message-id={msg.id} className="flex gap-space-sm">
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
                  {/* Place Recommendation Cards (Travel Guide Agent) */}
                  {msg.richContent?.placeRecommendations && msg.richContent.placeRecommendations.length > 0 && (
                    <div className="space-y-2.5 pt-2">
                      <div className="text-[11px] font-semibold text-primary uppercase tracking-wider flex items-center gap-1.5">
                        <Compass className="w-3.5 h-3.5" />
                        <span>Recommended Places</span>
                      </div>
                      <div className="grid grid-cols-1 gap-2.5">
                        {msg.richContent.placeRecommendations.map((place, pIdx) => {
                          const hasCoords = place.latitude != null && place.longitude != null;
                          const mapsUrl = place.source_url || (hasCoords ? `https://www.google.com/maps/search/?api=1&query=${place.latitude},${place.longitude}` : undefined);

                          return (
                            <div
                              key={`${msg.id}-place-${pIdx}-${place.name}`}
                              className="rounded-xl bg-surface-container/70 p-3.5 border border-surface-container-highest/80 shadow-sm hover:border-primary/40 transition-all flex flex-col justify-between gap-2.5"
                            >
                              <div className="space-y-1.5">
                                <div className="flex items-start justify-between gap-2">
                                  <div className="min-w-0">
                                    <h4 className="font-semibold text-sm text-on-surface truncate">
                                      {place.name}
                                    </h4>
                                    <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                                      <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-primary/10 text-primary border border-primary/20 capitalize">
                                        {place.category.replace('_', ' ')}
                                      </span>
                                      {place.rating != null && (
                                        <span className="flex items-center text-[11px] font-medium text-tertiary">
                                          <Star className="w-3 h-3 fill-tertiary text-tertiary mr-0.5" />
                                          {place.rating}
                                          {place.review_count != null && (
                                            <span className="text-on-surface-variant font-normal text-[10px] ml-0.5">
                                              ({place.review_count.toLocaleString()})
                                            </span>
                                          )}
                                        </span>
                                      )}
                                      {place.opening_status === 'OPEN' && (
                                        <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                                          Open
                                        </span>
                                      )}
                                      {place.opening_status === 'CLOSED' && (
                                        <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/20">
                                          Closed
                                        </span>
                                      )}
                                      {place.opening_status === 'UNKNOWN' && (
                                        <span className="px-1.5 py-0.5 rounded text-[10px] text-on-surface-variant bg-surface-container-highest/40">
                                          Hours unverified
                                        </span>
                                      )}
                                    </div>
                                  </div>
                                  {place.source && (
                                    <span className="text-[10px] text-on-surface-variant px-1.5 py-0.5 rounded bg-surface-container-highest/60 flex-shrink-0">
                                      {place.source === 'google_maps' ? 'Google Maps' : place.source === 'osm_overpass' ? 'OpenStreetMap' : place.source}
                                    </span>
                                  )}
                                </div>

                                <p className="text-xs text-on-surface-variant leading-relaxed line-clamp-2">
                                  {place.description}
                                </p>

                                {place.reason_recommended && (
                                  <div className="text-[11px] text-primary/90 flex items-start gap-1 font-medium bg-primary/5 p-1.5 rounded-lg border border-primary/10">
                                    <Sparkles className="w-3 h-3 text-primary flex-shrink-0 mt-0.5" />
                                    <span>{place.reason_recommended}</span>
                                  </div>
                                )}

                                <div className="flex flex-wrap items-center gap-3 text-[11px] text-on-surface-variant pt-0.5">
                                  {place.distance_meters != null && (
                                    <span className="flex items-center gap-1">
                                      <MapPin className="w-3 h-3 text-primary" />
                                      {place.distance_meters >= 1000
                                        ? `${(place.distance_meters / 1000).toFixed(1)} km away`
                                        : `${place.distance_meters}m away`}
                                    </span>
                                  )}
                                  {place.address && (
                                    <span className="truncate max-w-[240px]" title={place.address}>
                                      {place.address}
                                    </span>
                                  )}
                                </div>
                              </div>

                              <div className="pt-2 border-t border-surface-container-highest/40 flex flex-wrap items-center gap-2">
                                {mapsUrl && (
                                  <a
                                    href={mapsUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium bg-surface-container-highest hover:bg-surface-bright text-on-surface transition-colors"
                                  >
                                    <Navigation className="w-3 h-3 text-primary" />
                                    <span>Directions</span>
                                  </a>
                                )}
                                <button
                                  type="button"
                                  onClick={() => onSendMessage(`Tell me more about ${place.name}`)}
                                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium bg-surface-container-highest hover:bg-surface-bright text-on-surface transition-colors"
                                >
                                  <span>Details</span>
                                </button>
                                {trip && (
                                  <button
                                    type="button"
                                    onClick={() => onSendMessage(`Add ${place.name} to Day 2`)}
                                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium bg-primary/10 hover:bg-primary/20 text-primary transition-colors ml-auto"
                                  >
                                    <Plus className="w-3 h-3" />
                                    <span>Add to Itinerary</span>
                                  </button>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Proposed Itinerary Update Card */}
                  {msg.richContent?.revisionProposal && (
                    <div className="rounded-xl bg-surface-container/90 border border-primary/20 shadow-md p-4 space-y-3.5 mt-2">
                      {/* Card Header */}
                      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-surface-container-highest/60 pb-2.5">
                        <div className="flex items-center gap-2">
                          <div className="w-6 h-6 rounded-lg bg-primary/10 flex items-center justify-center text-primary">
                            <Sparkles className="w-3.5 h-3.5" />
                          </div>
                          <div>
                            <h4 className="text-xs font-bold text-primary uppercase tracking-wider">
                              Proposed Itinerary Update
                            </h4>
                            <p className="text-[11px] text-on-surface-variant font-medium">
                              {msg.richContent.revisionProposal.destination} · {msg.richContent.revisionProposal.days} Days
                            </p>
                          </div>
                        </div>
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-primary/10 text-primary font-semibold border border-primary/20">
                          Revision {msg.richContent.revisionProposal.expectedRevision} → {msg.richContent.revisionProposal.expectedRevision + 1}
                        </span>
                      </div>

                      {/* Explanation */}
                      {msg.richContent.revisionProposal.explanation && (
                        <p className="text-xs text-on-surface leading-relaxed bg-surface-container-highest/40 p-2.5 rounded-lg border border-surface-container-highest/50">
                          {msg.richContent.revisionProposal.explanation}
                        </p>
                      )}

                      {/* Diff Categories */}
                      <div className="space-y-2 text-xs">
                        {/* Added Activities */}
                        {msg.richContent.revisionProposal.added && msg.richContent.revisionProposal.added.length > 0 && (
                          <div className="space-y-1">
                            <div className="flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400 font-semibold text-[11px]">
                              <Plus className="w-3.5 h-3.5" />
                              <span>Added Activities ({msg.richContent.revisionProposal.added.length})</span>
                            </div>
                            <div className="flex flex-wrap gap-1.5 pl-5">
                              {msg.richContent.revisionProposal.added.map((item, idx) => (
                                <span
                                  key={`prop-add-${idx}-${item}`}
                                  className="px-2 py-0.5 rounded-md text-[11px] bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border border-emerald-500/20 font-medium"
                                >
                                  + {item}
                                </span>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Removed Activities */}
                        {msg.richContent.revisionProposal.removed && msg.richContent.revisionProposal.removed.length > 0 && (
                          <div className="space-y-1">
                            <div className="flex items-center gap-1.5 text-rose-500 dark:text-rose-400 font-semibold text-[11px]">
                              <RotateCcw className="w-3.5 h-3.5" />
                              <span>Removed Activities ({msg.richContent.revisionProposal.removed.length})</span>
                            </div>
                            <div className="flex flex-wrap gap-1.5 pl-5">
                              {msg.richContent.revisionProposal.removed.map((item, idx) => (
                                <span
                                  key={`prop-rem-${idx}-${item}`}
                                  className="px-2 py-0.5 rounded-md text-[11px] bg-rose-500/10 text-rose-700 dark:text-rose-300 border border-rose-500/20 font-medium line-through opacity-85"
                                >
                                  - {item}
                                </span>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Preserved Stops */}
                        {msg.richContent.revisionProposal.kept && msg.richContent.revisionProposal.kept.length > 0 && (
                          <div className="space-y-1">
                            <div className="flex items-center gap-1.5 text-primary font-semibold text-[11px]">
                              <Check className="w-3.5 h-3.5" />
                              <span>Preserved Stops ({msg.richContent.revisionProposal.kept.length})</span>
                            </div>
                            <div className="flex flex-wrap gap-1.5 pl-5">
                              {msg.richContent.revisionProposal.kept.map((item, idx) => (
                                <span
                                  key={`prop-kept-${idx}-${item}`}
                                  className="px-2 py-0.5 rounded-md text-[11px] bg-surface-container-highest text-on-surface-variant font-medium"
                                >
                                  ✓ {item}
                                </span>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Rescheduled Stops */}
                        {msg.richContent.revisionProposal.rescheduled && msg.richContent.revisionProposal.rescheduled.length > 0 && (
                          <div className="space-y-1">
                            <div className="flex items-center gap-1.5 text-amber-500 font-semibold text-[11px]">
                              <Clock className="w-3.5 h-3.5" />
                              <span>Rescheduled ({msg.richContent.revisionProposal.rescheduled.length})</span>
                            </div>
                            <div className="space-y-1 pl-5">
                              {msg.richContent.revisionProposal.rescheduled.map((r, idx) => (
                                <div key={`prop-resched-${idx}`} className="text-[11px] text-on-surface-variant">
                                  <span className="font-medium text-on-surface">{r.name}</span>: {r.oldTime} → <span className="font-semibold text-primary">{r.newTime}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>

                      {/* Proposal Action Buttons */}
                      <div className="pt-2 border-t border-surface-container-highest/60 flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          disabled={isSending}
                          onClick={() => onSendMessage("Apply Changes")}
                          className="inline-flex items-center justify-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-semibold bg-primary text-on-primary hover:bg-primary/90 shadow-sm transition-all disabled:opacity-50 cursor-pointer"
                        >
                          <Check className="w-3.5 h-3.5" />
                          <span>Apply Changes</span>
                        </button>

                        <button
                          type="button"
                          disabled={isSending}
                          onClick={() => onSendMessage("Keep Current Itinerary")}
                          className="inline-flex items-center justify-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-semibold bg-surface-container-highest hover:bg-surface-bright text-on-surface border border-surface-container-highest transition-all disabled:opacity-50 cursor-pointer"
                        >
                          <RotateCcw className="w-3.5 h-3.5" />
                          <span>Keep Current Itinerary</span>
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Suggested Follow-up Actions (Only when not a proposal card) */}
                  {!msg.richContent?.revisionProposal && msg.richContent?.suggestedActions && msg.richContent.suggestedActions.length > 0 && (
                    <div className="pt-2 flex flex-wrap gap-1.5">
                      {msg.richContent.suggestedActions.map((action, aIdx) => (
                        <button
                          key={`${msg.id}-action-${aIdx}`}
                          type="button"
                          onClick={() => onSendMessage(action.label)}
                          className="px-2.5 py-1 rounded-full text-xs font-medium bg-surface-container-highest/80 hover:bg-primary-container hover:text-on-primary text-on-surface border border-surface-container-highest transition-all flex items-center gap-1"
                        >
                          <Sparkles className="w-3 h-3 text-primary" />
                          <span>{action.label}</span>
                        </button>
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
          <div className="flex gap-space-sm items-start text-xs text-on-surface-variant">
            <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-primary">
              <Bot className="w-4 h-4" />
            </div>
            {planningProgress ? <PlanningProgressCard progress={planningProgress} checking={isSendingRequest} onCheck={onCheckPlanning} onDismiss={onDismissPlanning} onRetry={onRetryPlanning} onApiSettings={onApiSettings} /> : <div role="status" className="p-3 rounded-xl bg-surface-container-high text-xs text-on-surface flex items-center gap-2">
              <Loader2 aria-hidden="true" className="w-3.5 h-3.5 animate-spin" />
              <span>TravelAI is working on your request…</span>
            </div>}
          </div>
        )}

        <div ref={feedEndRef} />
      </div>

      {/* Quick Action Prompt Chips */}
      <div className="px-3 py-2 bg-surface-container-lowest/50 border-t border-surface-container-high/30 flex flex-wrap items-center gap-1.5 shrink-0 max-h-24 overflow-y-auto">
        {quickPrompts.slice(0, 2).map((chip, idx) => (
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
        {moreSuggestions && <span id="extra-chat-suggestions" className="motion-suggestions-extra">{quickPrompts.slice(2).map(chip => <button key={chip.label} type="button" disabled={isSending} onClick={() => onSendMessage(chip.text)} className="whitespace-nowrap px-2.5 py-1 rounded-full bg-surface-container-high hover:bg-surface-bright text-on-surface-variant hover:text-on-surface text-xs border border-surface-container-highest/60 shrink-0 disabled:opacity-50">{chip.label}</button>)}</span>}
        {quickPrompts.length > 2 && <button type="button" aria-expanded={moreSuggestions} aria-controls="extra-chat-suggestions" onClick={() => setMoreSuggestions(value => !value)} className="text-xs text-primary px-2 py-1 underline">{moreSuggestions ? 'Fewer suggestions' : 'More suggestions'}</button>}
      </div>

      {/* Chat Input Deck */}
      <div className="p-3 bg-surface-container/90 border-t border-surface-container-high/40 flex flex-col gap-2 shrink-0">
        <div className="motion-composer relative rounded-xl bg-surface-container-lowest border border-surface-container-highest/60 shadow-inner p-1.5 flex flex-col gap-1 focus-within:border-primary/50 transition-colors">
          <textarea
            id="chatPromptInput"
            aria-label="Ask TravelAI"
            disabled={isSending}
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
              aria-busy={isSendingRequest}
              disabled={!promptInput.trim() || isSending}
              className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-gradient-to-r from-primary-container to-secondary-container text-on-primary text-xs sm:text-sm font-medium shadow-lg hover:shadow-primary/20 transition-all hover:scale-[1.02] active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {isSendingRequest ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Planning Trip...</span>
                </>
              ) : (
                <>
                  <span>{planningProgress ? 'Review request above' : 'Send Message'}</span>
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
