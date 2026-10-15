import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { buildCalendar, buildItineraryText, downloadFile } from '../services/itineraryExport';
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
  Compass,
  LockKeyhole
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
import { TripPlusCard } from './TripPlusCard';
import { CompanionMode } from './tabs/CompanionMode';

interface DashboardPanelProps {
  onBookings: () => void;
  onBook: (kind: 'flight' | 'hotel', id: string, source?: 'discovered' | 'sample') => Promise<void>;
  onUpgrade: () => void;
  trip: TripSummary | null;
  days: ItineraryDay[];
  flights: FlightOption[];
  hotels: HotelOption[];
  nearbyHotels?: HotelOption[];
  weather: WeatherCondition | null;
  budget: BudgetOverview | null;
  activeTab: 'companion-tab' | 'route-tab' | 'flights-tab' | 'hotels-tab' | 'weather-tab' | 'budget-tab';
  onSwitchTab: (tab: 'companion-tab' | 'route-tab' | 'flights-tab' | 'hotels-tab' | 'weather-tab' | 'budget-tab') => void;
  onSelectFlight: (id: string) => Promise<boolean>;
  onSelectHotel: (id: string) => Promise<boolean>;
  onUpdateExecutionState?: (updates: Partial<ExecutionState>) => Promise<boolean>;
  onApplyRerouteResult?: (result: any) => void;
}

export const DashboardPanel: React.FC<DashboardPanelProps> = ({
  trip,
  onUpgrade,
  onBookings,
  onBook,
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

  const [showPrint, setShowPrint] = useState(false);
  const filename = (trip?.destination || 'itinerary').replace(/[^a-z0-9]+/gi, '-').toLowerCase();
  const handleShare = async () => {
    if (!trip) return;
    const text = buildItineraryText(trip, days);
    try {
      await navigator.clipboard.writeText(text);
      showToast('Itinerary text copied. Your account link remains private.');
    } catch {
      downloadFile(`travelai-${filename}.txt`, text, 'text/plain;charset=utf-8');
      showToast('Clipboard unavailable. Your itinerary was downloaded instead.');
    }
  };
  const handleExportPdf = () => {
    if (!trip?.plusAccess) { onUpgrade(); return; }
    setShowPrint(true);
    setTimeout(() => { window.print(); setShowPrint(false); }, 100);
  };
  const handleCalendarSync = () => {
    if (!trip?.plusAccess) { onUpgrade(); return; }
    if (!trip) return;
    try {
      downloadFile(`travelai-${filename}.ics`, buildCalendar(trip, days), 'text/calendar;charset=utf-8');
      showToast('Calendar downloaded. Import it into your calendar app.');
    } catch (error) { showToast(error instanceof Error ? error.message : 'Unable to export this schedule.'); }
  };
  const handleModify = () => {
    const input = document.getElementById('chatPromptInput');
    input?.focus();
    input?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    showToast('Tell the assistant which attraction, restaurant, or visit duration to change.');
  };

  return (
    <>
    {showPrint && trip && createPortal(<article id="travelai-print-document"><h1>{trip.title}</h1><p>{trip.duration} | {trip.travelersCount} travelers</p><p>Planning itinerary. Confirm reservations and prices with providers.</p>{budget?.notes && <p>{budget.notes}</p>}{days.map(day => <section key={day.dayNumber}><h2>Day {day.dayNumber} - {day.isoDate || day.date}</h2>{day.activities.map((activity, index) => <p key={activity.id || index}><strong>{activity.startTime || activity.time} - {activity.endTime} {activity.title}</strong><br />{activity.location}<br />{activity.description}</p>)}</section>)}</article>, document.body)}
    <section
      aria-label="Trip Architecture Dashboard"
      className="w-full xl:w-[54%] flex flex-col rounded-2xl bg-surface-container-low/80 backdrop-blur-2xl border border-surface-container-high/60 shadow-xl overflow-hidden min-w-0 shrink-0 xl:shrink h-[38rem] xl:h-[calc(100vh-7rem)] relative"
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
            onClick={() => trip?.plusAccess ? onSwitchTab('companion-tab') : onUpgrade()}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all shadow-sm border ${
              activeTab === 'companion-tab'
                ? 'bg-primary text-on-primary border-primary shadow-md'
                : 'bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 border-emerald-500/30'
            }`}
          >
            <Compass className={`w-3.5 h-3.5 ${activeTab === 'companion-tab' ? 'animate-spin' : ''}`} />
            <span>Companion Mode</span>
            {trip?.plusAccess ? <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-ping" /> : <LockKeyhole className="w-3 h-3" aria-label="Requires Trip Plus" />}
          </button>
          <button
            type="button"
            aria-label="Modify itinerary"
            onClick={handleModify}
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
            {!trip?.plusAccess && <LockKeyhole className="w-3 h-3" aria-label="Requires Trip Plus" />}
          </button>
          <button
            type="button"
            aria-label="Copy itinerary text"
            onClick={handleShare}
            title="Share Itinerary"
            className="p-2 rounded-lg bg-surface-container-high hover:bg-surface-bright text-on-surface transition-colors shadow-sm border border-surface-container-highest/60"
          >
            <Share2 className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            aria-label="Download itinerary calendar"
            onClick={handleCalendarSync}
            title="Download calendar events"
            className="p-2 rounded-lg bg-surface-container-high hover:bg-surface-bright text-primary transition-colors shadow-sm border border-surface-container-highest/60"
          >
            <CalendarCheck className="w-3.5 h-3.5" />
            {!trip?.plusAccess && <LockKeyhole className="w-3 h-3" aria-label="Requires Trip Plus" />}
          </button>
        </div>
      </div>

      {/* Navigation Tabs Strip */}
      <div className="shrink-0 px-space-md pt-2 bg-surface-container/60 border-b border-surface-container-high/40 flex items-center gap-1 overflow-x-auto no-scrollbar">
        <button
          type="button"
          onClick={() => trip?.plusAccess ? onSwitchTab('companion-tab') : onUpgrade()}
          className={`tab-button flex items-center gap-1.5 px-3 py-2 rounded-t-lg text-xs font-medium transition-all whitespace-nowrap ${
            activeTab === 'companion-tab'
              ? 'text-primary bg-surface-container-high shadow-sm border-t border-x border-surface-container-highest font-bold'
              : 'text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high/60'
          }`}
        >
          <Compass className="w-4 h-4 text-emerald-500" />
          <span>Live Companion</span>
          <span className="px-1.5 py-0.2 rounded-full text-[9px] font-bold uppercase tracking-wider bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
            {trip?.plusAccess ? 'LIVE' : 'PLUS'}
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
      <div className="flex-1 min-h-0 overflow-y-auto p-space-md lg:p-space-lg space-y-space-md">
        {trip && <TripPlusCard trip={trip} onUpgrade={onUpgrade} onBookings={onBookings} />}
        {activeTab === 'companion-tab' && trip?.plusAccess && (
          <CompanionMode
            trip={trip}
            days={days}
            onUpdateExecutionState={onUpdateExecutionState || (async () => false)}
            onApplyRerouteResult={onApplyRerouteResult}
            onSwitchTab={onSwitchTab}
          />
        )}
        {(activeTab === 'route-tab' || (activeTab === 'companion-tab' && !trip?.plusAccess)) && <RouteTab trip={trip} days={days} onSwitchTab={onSwitchTab} />}
        {activeTab === 'flights-tab' && (
          <FlightsTab onBook={onBook} flights={flights} onSelectFlight={onSelectFlight} destination={trip?.destination} trip={trip} />
        )}
        {activeTab === 'hotels-tab' && (
          <HotelsTab onBook={onBook} hotels={hotels} nearbyHotels={nearbyHotels} onSelectHotel={onSelectHotel} />
        )}
        {activeTab === 'weather-tab' && <WeatherTab key={trip?.id} tripId={trip?.id} weather={weather} destination={trip?.destination} />}
        {activeTab === 'budget-tab' && <BudgetTab budget={budget} />}
      </div>
    </section>
    </>
  );
};
