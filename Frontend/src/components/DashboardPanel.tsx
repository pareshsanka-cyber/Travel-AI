import React, { useState } from 'react';
import {
  CalendarDays,
  Plane,
  Hotel,
  CloudSun,
  Wallet,
  Edit,
  FileDown,
  Share2,
  CalendarCheck,
  Check,
  Compass
} from 'lucide-react';
import {
  TripSummary,
  ItineraryDay,
  FlightOption,
  HotelOption,
  WeatherCondition,
  BudgetOverview,
  ExecutionState
} from '../types';
import { RouteTab } from './tabs/RouteTab';
import { FlightsTab } from './tabs/FlightsTab';
import { HotelsTab } from './tabs/HotelsTab';
import { WeatherTab } from './tabs/WeatherTab';
import { BudgetTab } from './tabs/BudgetTab';
import { CompanionMode } from './tabs/CompanionMode';

interface DashboardPanelProps {
  trip: TripSummary | null;
  days: ItineraryDay[];
  flights: FlightOption[];
  hotels: HotelOption[];
  nearbyHotels?: HotelOption[];
  weather: WeatherCondition | null;
  budget: BudgetOverview | null;
  activeTab: 'companion-tab' | 'route-tab' | 'flights-tab' | 'hotels-tab' | 'weather-tab' | 'budget-tab';
  onSwitchTab: (tab: 'companion-tab' | 'route-tab' | 'flights-tab' | 'hotels-tab' | 'weather-tab' | 'budget-tab') => void;
  onSelectFlight: (id: string) => void;
  onSelectHotel: (id: string) => void;
  onUpdateExecutionState?: (updates: Partial<ExecutionState>) => Promise<boolean>;
  onApplyRerouteResult?: (result: any) => void;
}

export const DashboardPanel: React.FC<DashboardPanelProps> = ({
  trip,
  days,
  flights,
  hotels,
  nearbyHotels,
  weather,
  budget,
  activeTab,
  onSwitchTab,
  onSelectFlight,
  onSelectHotel,
  onUpdateExecutionState,
  onApplyRerouteResult,
}) => {
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3000);
  };

  const handleShare = () => {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(window.location.href);
      showToast('Shareable itinerary URL copied to clipboard!');
    } else {
      showToast('Share link ready!');
    }
  };

  const handleExportPdf = () => {
    window.print();
  };

  const handleCalendarSync = () => {
    // Generate an .ics calendar file for the 4-day itinerary
    const icsData = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//TravelAI//FastAPI Autonomous Itinerary//EN',
      'BEGIN:VEVENT',
      'SUMMARY:Goa Coastal Splendor & Heritage Trip',
      'DESCRIPTION:4-Day bespoke luxury trip planned via TravelAI FastAPI engine',
      'LOCATION:Goa, India',
      'DTSTART:20260412T080000Z',
      'DTEND:20260415T180000Z',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\n');

    const blob = new Blob([icsData], { type: 'text/calendar;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', 'travelai-goa-trip.ics');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    showToast('Calendar .ics events dispatched for 4 days!');
  };

  return (
    <section
      aria-label="Trip Architecture Dashboard"
      className="w-full xl:w-[54%] flex flex-col rounded-2xl bg-surface-container-low/80 backdrop-blur-2xl border border-surface-container-high/60 shadow-xl overflow-hidden min-w-0 h-full max-h-[calc(100vh-6rem)] relative"
    >
      {/* Toast Notification */}
      {toastMessage && (
        <div className="absolute top-4 right-4 z-50 px-3 py-2 rounded-lg bg-primary text-on-primary text-xs font-semibold shadow-2xl flex items-center gap-1.5 animate-in fade-in slide-in-from-top-2">
          <Check className="w-3.5 h-3.5" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Dashboard Header */}
      <div className="p-3 sm:p-4 bg-surface-container/95 border-b border-surface-container-high/60 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex flex-col min-w-0">
          <div className="flex items-center gap-2">
            <h1 className="text-base sm:text-lg font-semibold text-on-surface truncate tracking-tight">
              {trip?.title || 'Goa Coastal Splendor & Heritage'}
            </h1>
            <span className="px-2 py-0.5 rounded-full bg-tertiary/10 text-tertiary text-[10px] font-semibold whitespace-nowrap border border-tertiary/20">
              {trip?.status || 'Confirmed Plan'}
            </span>
          </div>
          <p className="text-xs text-on-surface-variant mt-0.5">
            {trip?.duration || '4 Days, 3 Nights'} • {trip?.travelersCount || 2} Travelers • {trip?.budgetEstimate || '₹50,000 Est. Budget'}
          </p>
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-1.5 flex-wrap">
          <button
            type="button"
            aria-label="Toggle live companion mode"
            onClick={() => onSwitchTab('companion-tab')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all shadow-sm border ${
              activeTab === 'companion-tab'
                ? 'bg-primary text-on-primary border-primary shadow-md'
                : 'bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 border-emerald-500/30'
            }`}
          >
            <Compass className={`w-3.5 h-3.5 ${activeTab === 'companion-tab' ? 'animate-spin' : ''}`} />
            <span>Companion Mode</span>
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-ping" />
          </button>
          <button
            type="button"
            aria-label="Modify itinerary"
            onClick={() => showToast('Opening AI itinerary re-architecture wizard...')}
            className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-surface-container-high hover:bg-surface-bright text-on-surface text-xs font-medium transition-colors shadow-sm border border-surface-container-highest/60"
          >
            <Edit className="w-3.5 h-3.5 text-primary" />
            <span>Modify</span>
          </button>
          <button
            type="button"
            aria-label="Export itinerary as PDF"
            onClick={handleExportPdf}
            className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-surface-container-high hover:bg-surface-bright text-on-surface text-xs font-medium transition-colors shadow-sm border border-surface-container-highest/60"
          >
            <FileDown className="w-3.5 h-3.5 text-tertiary" />
            <span>Export PDF</span>
          </button>
          <button
            type="button"
            aria-label="Share itinerary link"
            onClick={handleShare}
            title="Share Itinerary"
            className="p-2 rounded-lg bg-surface-container-high hover:bg-surface-bright text-on-surface transition-colors shadow-sm border border-surface-container-highest/60"
          >
            <Share2 className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            aria-label="Sync itinerary to calendar"
            onClick={handleCalendarSync}
            title="Sync to Google / Apple Calendar"
            className="p-2 rounded-lg bg-surface-container-high hover:bg-surface-bright text-primary transition-colors shadow-sm border border-surface-container-highest/60"
          >
            <CalendarCheck className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Navigation Tabs Strip */}
      <div className="px-space-md pt-2 bg-surface-container/60 border-b border-surface-container-high/40 flex items-center gap-1 overflow-x-auto no-scrollbar">
        <button
          type="button"
          onClick={() => onSwitchTab('companion-tab')}
          className={`tab-button flex items-center gap-1.5 px-3 py-2 rounded-t-lg text-xs font-medium transition-all whitespace-nowrap ${
            activeTab === 'companion-tab'
              ? 'text-primary bg-surface-container-high shadow-sm border-t border-x border-surface-container-highest font-bold'
              : 'text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high/60'
          }`}
        >
          <Compass className="w-4 h-4 text-emerald-500" />
          <span>Live Companion</span>
          <span className="px-1.5 py-0.2 rounded-full text-[9px] font-bold uppercase tracking-wider bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
            LIVE
          </span>
        </button>

        <button
          type="button"
          onClick={() => onSwitchTab('route-tab')}
          className={`tab-button flex items-center gap-1.5 px-3 py-2 rounded-t-lg text-xs font-medium transition-all whitespace-nowrap ${
            activeTab === 'route-tab'
              ? 'text-primary bg-surface-container-high shadow-sm border-t border-x border-surface-container-highest font-semibold'
              : 'text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high/60'
          }`}
        >
          <CalendarDays className="w-4 h-4" />
          <span>Day-by-Day Route</span>
        </button>

        <button
          type="button"
          onClick={() => onSwitchTab('flights-tab')}
          className={`tab-button flex items-center gap-1.5 px-3 py-2 rounded-t-lg text-xs font-medium transition-all whitespace-nowrap ${
            activeTab === 'flights-tab'
              ? 'text-primary bg-surface-container-high shadow-sm border-t border-x border-surface-container-highest font-semibold'
              : 'text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high/60'
          }`}
        >
          <Plane className="w-4 h-4" />
          <span>Flights ({flights.length})</span>
        </button>

        <button
          type="button"
          onClick={() => onSwitchTab('hotels-tab')}
          className={`tab-button flex items-center gap-1.5 px-3 py-2 rounded-t-lg text-xs font-medium transition-all whitespace-nowrap ${
            activeTab === 'hotels-tab'
              ? 'text-primary bg-surface-container-high shadow-sm border-t border-x border-surface-container-highest font-semibold'
              : 'text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high/60'
          }`}
        >
          <Hotel className="w-4 h-4" />
          <span>Hotels ({hotels.length})</span>
        </button>

        <button
          type="button"
          onClick={() => onSwitchTab('weather-tab')}
          className={`tab-button flex items-center gap-1.5 px-3 py-2 rounded-t-lg text-xs font-medium transition-all whitespace-nowrap ${
            activeTab === 'weather-tab'
              ? 'text-primary bg-surface-container-high shadow-sm border-t border-x border-surface-container-highest font-semibold'
              : 'text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high/60'
          }`}
        >
          <CloudSun className="w-4 h-4" />
          <span>Weather Forecast</span>
        </button>

        <button
          type="button"
          onClick={() => onSwitchTab('budget-tab')}
          className={`tab-button flex items-center gap-1.5 px-3 py-2 rounded-t-lg text-xs font-medium transition-all whitespace-nowrap ${
            activeTab === 'budget-tab'
              ? 'text-primary bg-surface-container-high shadow-sm border-t border-x border-surface-container-highest font-semibold'
              : 'text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high/60'
          }`}
        >
          <Wallet className="w-4 h-4" />
          <span>Budget Auditor</span>
        </button>
      </div>

      {/* Tab Content Area */}
      <div className="flex-1 overflow-y-auto p-space-md lg:p-space-lg space-y-space-md">
        {activeTab === 'companion-tab' && (
          <CompanionMode
            trip={trip}
            days={days}
            onUpdateExecutionState={onUpdateExecutionState || (async () => false)}
            onApplyRerouteResult={onApplyRerouteResult}
            onSwitchTab={onSwitchTab}
          />
        )}
        {activeTab === 'route-tab' && <RouteTab trip={trip} days={days} onSwitchTab={onSwitchTab} />}
        {activeTab === 'flights-tab' && (
          <FlightsTab flights={flights} onSelectFlight={onSelectFlight} destination={trip?.destination} trip={trip} />
        )}
        {activeTab === 'hotels-tab' && (
          <HotelsTab hotels={hotels} nearbyHotels={nearbyHotels} onSelectHotel={onSelectHotel} />
        )}
        {activeTab === 'weather-tab' && <WeatherTab weather={weather} destination={trip?.destination} />}
        {activeTab === 'budget-tab' && <BudgetTab budget={budget} />}
      </div>
    </section>
  );
};
