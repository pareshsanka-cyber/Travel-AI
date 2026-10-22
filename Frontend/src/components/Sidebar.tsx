import React, { useId, useRef, useSyncExternalStore } from 'react';
import { LayoutGroup } from 'motion/react';
import { ActiveIndicator } from '../motion/ActiveIndicator';
import { useModalFocus } from '../hooks/useModalFocus';
import {
  CreditCard,
  Compass,
  CalendarDays,
  Plane,
  Sparkles,
  Plus,
  Trash2,
  ChevronLeft,
  ChevronRight,
  Server,
  X,
  Loader2
} from 'lucide-react';
import { ApiStatusState, ConversationHistoryItem, SavedTripSnippet } from '../types';

interface SidebarProps {
  activePage: 'planner-studio' | 'itinerary-hub' | 'bookings-desk' | 'ai-places-memory' | 'payments';
  onSelectPage: (page: 'planner-studio' | 'itinerary-hub' | 'bookings-desk' | 'ai-places-memory' | 'payments') => void;
  conversations: ConversationHistoryItem[];
  isLoadingConversations?: boolean;
  savedTrips: SavedTripSnippet[];
  isLoadingTrips?: boolean;
  apiStatus: ApiStatusState;
  onOpenApiModal?: () => void;
  onDeleteConversation: (id: string, e: React.MouseEvent) => void | Promise<void>;
  onSelectConversation?: (id: string) => void | Promise<void>;
  onSelectTrip?: (tripId: string) => void | Promise<void | boolean>;
  onDeleteTrip?: (tripId: string, e: React.MouseEvent) => void;
  onNewTrip: () => void | Promise<void>;
  isSendingMessage?: boolean;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
  isMobileOpen?: boolean;
  onCloseMobile?: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  activePage,
  onSelectPage,
  conversations,
  isLoadingConversations,
  savedTrips,
  isLoadingTrips,
  apiStatus,
  onOpenApiModal,
  onDeleteConversation,
  onSelectConversation,
  onSelectTrip,
  onDeleteTrip,
  onNewTrip,
  isSendingMessage = false,
  isCollapsed,
  onToggleCollapse,
  isMobileOpen = false,
  onCloseMobile,
}) => {
  const navigationId = useId();
  const sidebar = useRef<HTMLElement>(null);
  const desktop = useSyncExternalStore(subscribeDesktop, getDesktop, () => true);
  useModalFocus(sidebar, isMobileOpen && !desktop, () => onCloseMobile?.());
  const links = [
    { id: 'planner-studio', label: 'Plan', Icon: Compass, color: 'text-primary' },
    { id: 'itinerary-hub', label: 'My trips', Icon: CalendarDays, color: 'text-tertiary' },
    { id: 'bookings-desk', label: 'Travel Selections', Icon: Plane, color: 'text-secondary' },
    { id: 'ai-places-memory', label: 'Places & Memory', Icon: Sparkles, color: 'text-primary' },
    { id: 'payments', label: 'Payments', Icon: CreditCard, color: '' },
  ] as const;
  return (
    <>
      {/* Mobile Backdrop */}
      {isMobileOpen && (
        <div
          className="motion-backdrop fixed inset-0 bg-black/60 backdrop-blur-sm z-40 lg:hidden"
          onClick={onCloseMobile}
        />
      )}

      <aside
        ref={sidebar}
        inert={!desktop && !isMobileOpen}
        role={!desktop && isMobileOpen ? 'dialog' : undefined}
        aria-modal={!desktop && isMobileOpen ? true : undefined}
        aria-label="Navigation"
        data-mobile-open={isMobileOpen}
        tabIndex={-1}
        className={`motion-sidebar fixed left-0 top-0 h-full bg-surface-container-lowest z-50 flex flex-col justify-between shadow-[0_1px_8px_rgba(0,0,0,0.04)] transition-all duration-300 ${
          isCollapsed ? 'w-20' : 'w-72'
        } ${
          isMobileOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
        }`}
      >
        <div className="flex flex-col h-full min-h-0">
          {/* Top Branding Header */}
          <div className={`${isCollapsed ? 'p-2' : 'p-space-md'} flex items-center justify-between border-b border-surface-container-high/40 shrink-0`}>
            {!isCollapsed && (
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-primary to-primary-container flex items-center justify-center shadow-md">
                  <Compass className="w-4 h-4 text-on-primary" />
                </div>
                <div>
                  <span className="font-headline font-bold text-base tracking-tight text-on-surface">
                    Travel<span className="text-primary">AI</span>
                  </span>
                  <span className="block text-[10px] uppercase font-mono tracking-widest text-on-surface-variant font-medium">
                    Travel companion
                  </span>
                </div>
              </div>
            )}

            {isCollapsed && (
              <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-primary to-primary-container flex items-center justify-center shadow-md mx-auto">
                <Compass className="w-4 h-4 text-on-primary" />
              </div>
            )}

            <div className="flex items-center gap-1">
              {/* Desktop Collapse Toggle */}
              <button
                type="button"
                aria-label={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
                onClick={onToggleCollapse}
                className="hidden lg:flex p-1.5 rounded-lg text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high transition-colors"
                title={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              >
                {isCollapsed ? (
                  <ChevronRight className="w-4 h-4" />
                ) : (
                  <ChevronLeft className="w-4 h-4" />
                )}
              </button>

              {/* Mobile Close Button */}
              {onCloseMobile && (
                <button
                  type="button"
                  aria-label="Close navigation"
                  onClick={onCloseMobile}
                  className="lg:hidden p-1.5 rounded-lg text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              )}
            </div>
          </div>

          {/* New Trip CTA */}
          <div className="p-space-sm px-space-md">
            <button
              type="button"
              onClick={async () => {
                await onNewTrip();
                if (onCloseMobile) onCloseMobile();
              }}
              className={`w-full flex items-center justify-center gap-2 py-2.5 px-3 rounded-xl bg-primary text-on-primary font-semibold text-xs shadow-md hover:bg-primary-fixed transition-all cursor-pointer ${
                isCollapsed ? 'px-0' : ''
              }`}
              title="Start New Bespoke Trip (Open New Chat)"
            >
              <Plus className="w-4 h-4" />
              {!isCollapsed && <span>New Bespoke Trip</span>}
            </button>
          </div>

          {/* Navigation Links */}
          <LayoutGroup id={navigationId}>
          <nav aria-label="Main Navigation" className="px-space-sm space-y-1">
            {links.map(({ id, label, Icon, color }) => <button key={id} type="button"
              aria-current={activePage === id ? 'page' : undefined} aria-label={label} title={label}
              onClick={() => { onSelectPage(id); onCloseMobile?.(); }}
              className={`motion-nav-item w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs font-semibold ${activePage === id ? 'text-primary' : 'text-on-surface-variant hover:bg-surface-container-low hover:text-on-surface'} ${isCollapsed ? 'justify-center px-0' : ''}`}>
              {activePage === id && <ActiveIndicator id="navigation" />}
              <Icon className={`w-4 h-4 shrink-0 ${color}`} />
              {!isCollapsed && <span>{label}</span>}
            </button>)}
          </nav>
          </LayoutGroup>

          {/* History Lists (Conversations & Saved Trips) */}
          {!isCollapsed && (
            <div className="flex-1 overflow-y-auto px-space-md py-2 space-y-4">
              {/* Threaded Conversations from /api/chat/conversations */}
              <div className="space-y-1">
                <div className="flex items-center justify-between px-1 py-1">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-on-surface-variant">
                    Recent Chats
                  </span>

                </div>
                <div className="flex flex-col gap-1">
                  {isLoadingConversations ? (
                    <div className="space-y-1.5 py-1">
                      <div className="h-8 rounded-xl bg-surface-container-high/60 animate-pulse" />
                      <div className="h-8 rounded-xl bg-surface-container-high/40 animate-pulse" />
                      <div className="h-8 rounded-xl bg-surface-container-high/20 animate-pulse" />
                    </div>
                  ) : conversations.length === 0 ? (
                    <div className="px-3 py-2 rounded-xl bg-surface-container-low text-[11px] text-on-surface-variant border border-surface-container-high/40 text-center">
                      No recent conversations yet. Start a chat in Planner Studio to begin planning.
                    </div>
                  ) : (
                    conversations.map((item, idx) => (
                      <div
                        key={item.id || `conv-${idx}`}
                        className="group flex items-center justify-between px-3 py-2 rounded-xl bg-surface-container/70 hover:bg-surface-container-high transition-colors text-xs"
                      >
                        <button
                          type="button"
                          onClick={async () => {
                            if (onSelectConversation) {
                              await onSelectConversation(item.id);
                            }
                            onSelectPage('planner-studio');
                            if (onCloseMobile) onCloseMobile();
                          }}
                          className="flex flex-col min-w-0 flex-1 text-left pr-1 cursor-pointer focus:outline-none"
                        >
                          <span className="text-on-surface truncate font-medium group-hover:text-primary transition-colors">
                            {item.title}
                          </span>
                          <span className="text-[10px] text-on-surface-variant">
                            {item.timeAgo}
                          </span>
                        </button>
                        <button
                          type="button"
                          aria-label="Delete conversation"
                          onClick={(e) => onDeleteConversation(item.id, e)}
                          className="opacity-0 group-hover:opacity-100 p-1 text-on-surface-variant hover:text-error transition-all"
                          title="Delete"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))
                  )}
                </div>
              </div>

              {/* Saved Trips from /api/trips/history */}
              <div className="space-y-1 pt-1">
                <div className="flex items-center justify-between px-1 py-1">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-on-surface-variant">
                    Saved Trips
                  </span>

                </div>
                <div className="flex flex-col gap-1.5">
                  {isLoadingTrips ? (
                    <div className="space-y-1.5 py-1">
                      <div className="h-7 rounded-full bg-surface-container-high/60 animate-pulse" />
                      <div className="h-7 rounded-full bg-surface-container-high/40 animate-pulse" />
                    </div>
                  ) : savedTrips.length === 0 ? (
                    <div className="px-3 py-2 rounded-xl bg-surface-container-low text-[11px] text-on-surface-variant border border-surface-container-high/40 text-center">
                      No saved expeditions yet. Plan an autonomous trip above.
                    </div>
                  ) : (
                    savedTrips.map((tripItem, idx) => (
                      <div
                        key={tripItem.id || `trip-${idx}`}
                        className="group flex items-center justify-between px-3 py-1.5 rounded-full bg-surface-container hover:bg-surface-container-high transition-colors text-xs"
                      >
                        <button
                          type="button"
                          onClick={async () => {
                            if (onSelectTrip) {
                              await onSelectTrip(tripItem.id);
                            }
                            if (onCloseMobile) onCloseMobile();
                          }}
                          className="flex items-center justify-between min-w-0 flex-1 text-left pr-1.5 focus:outline-none cursor-pointer"
                        >
                          <span className="text-on-surface truncate font-medium group-hover:text-primary transition-colors">
                            {tripItem.name}
                          </span>
                          <span className="px-2 py-0.5 rounded-full bg-tertiary-container/20 text-tertiary text-[10px] font-semibold whitespace-nowrap ml-1 shrink-0">
                            {tripItem.destinationTag} • {tripItem.daysTag}
                          </span>
                        </button>
                        {onDeleteTrip && (
                          <button
                            type="button"
                            aria-label={`Delete trip ${tripItem.name}`}
                            onClick={(e) => onDeleteTrip(tripItem.id, e)}
                            className="opacity-0 group-hover:opacity-100 p-1 text-on-surface-variant hover:text-error transition-all shrink-0 ml-0.5 cursor-pointer"
                            title="Delete trip"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          )}

          {/* API Status Box Footer */}
          <div className="mt-auto p-space-md bg-surface-container-lowest/90 border-t border-surface-container-high/40 shrink-0">
            <button
              type="button"
              onClick={onOpenApiModal}
              className={`w-full flex items-center gap-space-sm p-space-sm rounded-xl bg-surface-container-low hover:bg-surface-container-high transition-colors text-left ${
                isCollapsed ? 'justify-center p-2' : ''
              }`}
              title="Configure FastAPI Backend Connection"
            >
              <div className="relative flex-shrink-0">
                <div
                  className={`w-2.5 h-2.5 rounded-full ${
                    apiStatus.isConnected ? 'bg-tertiary' : 'bg-primary'
                  }`}
                />
                <div
                  className={`w-2.5 h-2.5 rounded-full absolute inset-0 ${
                    apiStatus.isConnected ? 'bg-tertiary' : 'bg-primary'
                  }`}
                />
              </div>

              {!isCollapsed && (
                <div className="flex flex-col min-w-0">
                  <span
                    className={`text-xs font-semibold truncate ${
                      apiStatus.isConnected ? 'text-tertiary' : 'text-primary'
                    }`}
                  >
                    {apiStatus.isConnected ? 'Connected' : 'Connection unavailable'}
                  </span>
                  <span className="text-[11px] text-on-surface-variant truncate font-mono">
                    TravelAI service
                  </span>
                </div>
              )}
            </button>
          </div>
        </div>
      </aside>
    </>
  );
};

const desktopQuery = '(min-width: 1024px)';
function getDesktop() { return window.matchMedia(desktopQuery).matches; }
function subscribeDesktop(notify: () => void) {
  const query = window.matchMedia(desktopQuery);
  query.addEventListener('change', notify);
  return () => query.removeEventListener('change', notify);
}
