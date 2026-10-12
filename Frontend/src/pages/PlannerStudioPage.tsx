import React from 'react';
import { Compass, CalendarDays, Plus, Loader2 } from 'lucide-react';
import { ChatPanel } from '../components/ChatPanel';
import { DashboardPanel } from '../components/DashboardPanel';
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
  onSelectFlight: (id: string) => void;
  onSelectHotel: (id: string) => void;
  onUpdateExecutionState?: (updates: Partial<ExecutionState>) => Promise<boolean>;
  onApplyRerouteResult?: (result: any) => void;
  apiStatus: ApiStatusState;
  onClearContext: () => void;
  onNavigateToItineraryHub?: () => void;
  onNewTrip?: () => void;
}

export const PlannerStudioPage: React.FC<PlannerStudioPageProps> = ({
  trip,
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
  return (
    <div className="w-full flex-1 flex flex-col xl:flex-row min-h-[calc(100vh-4rem)] p-3 sm:p-4 lg:p-6 gap-4 lg:gap-6 overflow-hidden">
      {/* LEFT PANE: Chat & Autonomous Assistant Desk */}
      <ChatPanel
        trip={trip}
        travelContext={travelContext}
        currentIntent={currentIntent}
        onUpdatePreference={onUpdatePreference}
        messages={messages}
        promptInput={promptInput}
        onPromptChange={onPromptChange}
        onSendMessage={onSendMessage}
        isSending={isSending}
        onSwitchTab={onSwitchTab}
        apiStatus={apiStatus}
        onClearContext={onClearContext}
      />

      {/* RIGHT PANE: Itinerary & Trip Architecture Dashboard */}
      {trip ? (
        <DashboardPanel
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
      ) : (
        <div className="flex-1 min-w-0 bg-surface-container/50 border border-surface-container-high/40 rounded-2xl p-6 sm:p-8 flex flex-col items-center justify-center text-center animate-in fade-in">
          <div className="max-w-md space-y-5">
            <div className="w-16 h-16 rounded-2xl bg-primary/10 text-primary flex items-center justify-center mx-auto shadow-inner border border-primary/20">
              <Compass className="w-8 h-8 text-primary animate-pulse" />
            </div>

            <div className="space-y-2">
              <h2 className="text-xl font-bold text-on-surface">No Trip Generated Yet</h2>
              <p className="text-xs sm:text-sm text-on-surface-variant leading-relaxed">
                Type your trip request in the chat on the left (e.g. <span className="text-primary font-medium">"Plan a 4-day trip to Goa for 2 people"</span>) and TravelAI will craft your complete itinerary right here!
              </p>
            </div>

            <div className="pt-2 flex flex-wrap justify-center gap-2">
              {[
                "Plan 4 days in Goa for ₹50,000",
                "Plan 5 days in Kerala for 2 adults",
                "Plan 7 days in Tokyo"
              ].map((sample, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => onSendMessage(sample)}
                  className="px-3.5 py-2 rounded-xl bg-surface-container-high hover:bg-surface-bright text-on-surface text-xs font-medium border border-surface-container-highest/60 transition-all text-left flex items-center gap-1.5 cursor-pointer shadow-sm hover:border-primary/40"
                >
                  <Plus className="w-3.5 h-3.5 text-primary flex-shrink-0" />
                  <span>"{sample}"</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
