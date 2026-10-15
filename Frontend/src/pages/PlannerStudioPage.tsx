import React, { useLayoutEffect } from 'react';
import { ChatPanel } from '../components/ChatPanel';
import { DashboardPanel } from '../components/DashboardPanel';
import { useContentFade } from '../motion/useInteractionMotion';
import {
  TripSummary,
  ItineraryDay,
  FlightOption,
  HotelOption,
  WeatherCondition,
  BudgetOverview,
  ChatMessage,
  ApiStatusState,
  ExecutionState
} from '../types';

interface PlannerStudioPageProps {
  plannerView: 'plan' | 'trip';
  onChangeView: (view: 'plan' | 'trip') => void;
  onEditTrip: () => Promise<boolean>;
  isOpeningEdit: boolean;
  onBookings: () => void;
  onBook: (kind: 'flight' | 'hotel', id: string, source?: 'discovered' | 'sample') => Promise<void>;
  onUpgrade: () => void;
  trip: TripSummary | null;
  travelContext?: Record<string, any> | null;
  currentIntent?: string | null;
  onUpdatePreference?: (updates: Partial<Record<string, any>>) => void;
  days: ItineraryDay[];
  flights: FlightOption[];
  hotels: HotelOption[];
  nearbyHotels: HotelOption[];
  weather: WeatherCondition | null;
  budget: BudgetOverview | null;
  messages: ChatMessage[];
  promptInput: string;
  onPromptChange: (val: string) => void;
  onSendMessage: (textToSend?: string) => void;
  isSending: boolean;
  activeTab: 'companion-tab' | 'route-tab' | 'flights-tab' | 'hotels-tab' | 'weather-tab' | 'budget-tab';
  onSwitchTab: (tab: 'companion-tab' | 'route-tab' | 'flights-tab' | 'hotels-tab' | 'weather-tab' | 'budget-tab') => void;
  onSelectFlight: (id: string) => Promise<boolean>;
  onSelectHotel: (id: string) => Promise<boolean>;
  onUpdateExecutionState?: (updates: Partial<ExecutionState>) => Promise<boolean>;
  onApplyRerouteResult?: (result: any) => void;
  apiStatus: ApiStatusState;
  onClearContext: () => void;
  onNavigateToItineraryHub?: () => void;
  onNewTrip?: () => void;
}

export const PlannerStudioPage: React.FC<PlannerStudioPageProps> = ({
  plannerView, onChangeView, onEditTrip, isOpeningEdit,
  trip,
  onUpgrade,
  onBookings,
  onBook,
  travelContext,
  currentIntent,
  onUpdatePreference,
  days,
  flights,
  hotels,
  nearbyHotels,
  weather,
  budget,
  messages,
  promptInput,
  onPromptChange,
  onSendMessage,
  isSending,
  activeTab,
  onSwitchTab,
  onSelectFlight,
  onSelectHotel,
  onUpdateExecutionState,
  onApplyRerouteResult,
  apiStatus,
  onClearContext,
  onNavigateToItineraryHub,
  onNewTrip,
}) => {
  const showPlan = !trip || plannerView === 'plan';
  const planFade = useContentFade('plan', showPlan);
  const tripFade = useContentFade(trip?.id || 'trip', !showPlan);
  useLayoutEffect(() => {
    const view = showPlan ? 'plan' : 'trip';
    const key = `TRAVELAI_SCROLL:${trip?.id || 'new'}:${view}`;
    const frame = requestAnimationFrame(() => window.scrollTo({ top: Number(sessionStorage.getItem(key) || 0), behavior: 'instant' }));
    const save = () => sessionStorage.setItem(key, String(window.scrollY));
    window.addEventListener('scroll', save, { passive: true });
    return () => { cancelAnimationFrame(frame); window.removeEventListener('scroll', save); };
  }, [showPlan, trip?.id]);
  const changeView = (view: 'plan' | 'trip') => {
    sessionStorage.setItem(`TRAVELAI_SCROLL:${trip?.id || 'new'}:${showPlan ? 'plan' : 'trip'}`, String(window.scrollY));
    onChangeView(view);
  };
  const editTrip = async () => {
    sessionStorage.setItem(`TRAVELAI_SCROLL:${trip?.id}:trip`, String(window.scrollY));
    await onEditTrip();
  };
  return (
    <div className="trip-workspace w-full min-w-0 p-3 sm:p-5 lg:p-7">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
        <button type="button" onClick={onNavigateToItineraryHub} className="text-sm text-primary">← My trips</button>
        {showPlan && trip && <button type="button" onClick={() => changeView('trip')} className="rounded-xl border border-primary/30 px-4 py-2 text-sm text-primary font-semibold">{travelContext?.current_trip_id === trip.id ? (currentIntent === 'MODIFY_ITINERARY' ? 'Return to trip' : 'View generated itinerary') : 'View saved trip'} →</button>}
      </div>
      <div ref={planFade} className="plan-view" hidden={!showPlan}>
      <ChatPanel
        isVisible={showPlan}
        trip={trip}
        travelContext={travelContext}
        currentIntent={currentIntent}
        onUpdatePreference={onUpdatePreference}
        messages={messages}
        promptInput={promptInput}
        onPromptChange={onPromptChange}
        onSendMessage={onSendMessage}
        isSending={isSending}
        onSwitchTab={tab => { onSwitchTab(tab); changeView('trip'); }}
        apiStatus={apiStatus}
        onClearContext={onClearContext}
      />
      </div>

      <div ref={tripFade} hidden={showPlan}>
      {trip ? (
        <DashboardPanel key={trip.id}
          onOpenChat={editTrip}
          isOpeningEdit={isOpeningEdit || isSending}
          onUpgrade={onUpgrade}
          onBookings={onBookings}
          onBook={onBook}
          trip={trip}
          days={days}
          flights={flights}
          hotels={hotels}
          nearbyHotels={nearbyHotels}
          weather={weather}
          budget={budget}
          activeTab={activeTab}
          onSwitchTab={onSwitchTab}
          onSelectFlight={onSelectFlight}
          onSelectHotel={onSelectHotel}
          onUpdateExecutionState={onUpdateExecutionState}
          onApplyRerouteResult={onApplyRerouteResult}
        />
      ) : null}
      </div>
    </div>
  );
};
