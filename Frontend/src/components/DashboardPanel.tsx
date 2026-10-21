import React, { useCallback, useId, useState } from 'react';
import { LayoutGroup } from 'motion/react';
import { ActiveIndicator } from '../motion/ActiveIndicator';
import { useContentFade } from '../motion/useInteractionMotion';
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
import { WeatherTab, type WeatherData } from './tabs/WeatherTab';
import { BudgetTab } from './tabs/BudgetTab';
import { CompanionMode } from './tabs/CompanionMode';
import { TripReadiness } from './TripReadiness';

interface DashboardPanelProps {
  onOpenChat: () => void;
  isOpeningEdit?: boolean;
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
  onOpenChat, isOpeningEdit,
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
  const [checkedWeather, setCheckedWeather] = useState<{ tripId: string; revision?: number; data: WeatherData } | null>(null);
  const saveTripForecast = useCallback((data: WeatherData) => {
    if (trip?.id) setCheckedWeather({ tripId: trip.id, revision: trip.revision, data });
  }, [trip?.id, trip?.revision]);
  const readinessWeather = checkedWeather && checkedWeather.tripId === trip?.id && checkedWeather.revision === trip?.revision ? checkedWeather.data : weather;
  const [routeMode, setRouteMode] = useState<'overview' | 'days'>(() => sessionStorage.getItem(`TRAVELAI_ROUTE_MODE:${trip?.id}`) === 'days' ? 'days' : 'overview');

  const tabGroup = useId();
  const contentFade = useContentFade(`${trip?.id}/${activeTab}/${routeMode}`);
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
  const handleModify = () => { onOpenChat(); };

  return (
    <>
    {showPrint && trip && createPortal(<article id="travelai-print-document"><h1>{trip.title}</h1><p>{trip.duration} | {trip.travelersCount} travelers</p><p>Planning itinerary. Confirm reservations and prices with providers.</p>{budget?.notes && <p>{budget.notes}</p>}{days.map(day => <section key={day.dayNumber}><h2>Day {day.dayNumber} - {day.isoDate || day.date}</h2>{day.activities.map((activity, index) => <p key={activity.id || index}><strong>{activity.startTime || activity.time} - {activity.endTime} {activity.title}</strong><br />{activity.location}<br />{activity.description}</p>)}</section>)}</article>, document.body)}
    <section
      aria-label="Trip Architecture Dashboard"
      className="trip-dashboard w-full flex flex-col rounded-2xl bg-surface-container-low/80 border border-surface-container-high/60 shadow-xl min-w-0 relative"
    >
      {/* Toast Notification */}
      {toastMessage && (
        <div className="absolute top-4 right-4 z-50 px-3 py-2 rounded-lg bg-primary text-on-primary text-xs font-semibold shadow-2xl flex items-center gap-1.5 animate-in fade-in slide-in-from-top-2">
          <Check className="w-3.5 h-3.5" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Dashboard Header */}
      <div className="p-3 sm:p-4 bg-surface-container/95 rounded-t-2xl border-b border-surface-container-high/60 flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-base sm:text-lg font-semibold text-on-surface break-words tracking-tight">
              {trip?.title || 'Goa Coastal Splendor & Heritage'}
            </h1>
            <span className="px-2 py-0.5 rounded-full bg-tertiary/10 text-tertiary text-[10px] font-semibold whitespace-nowrap border border-tertiary/20">
              {trip?.plusAccess ? 'Plus active ✓' : 'Free plan'}
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
            aria-label={trip?.plusAccess ? "Open Companion" : "Unlock Companion"}
            onClick={() => trip?.plusAccess ? onSwitchTab('companion-tab') : onUpgrade()}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all shadow-sm border ${
              activeTab === 'companion-tab'
                ? 'bg-primary text-on-primary border-primary shadow-md'
                : 'bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 border-emerald-500/30'
            }`}
          >
            <Compass className="w-3.5 h-3.5" />
            <span>{trip?.plusAccess ? 'Open Companion' : 'Unlock Companion'}</span>
            {trip?.plusAccess ? <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" /> : <LockKeyhole className="w-3 h-3" aria-label="Requires Trip Plus" />}
          </button>
          <button
            type="button"
            aria-label="Edit with AI"
            disabled={isOpeningEdit}
            onClick={handleModify}
            className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-surface-container-high hover:bg-surface-bright text-on-surface text-xs font-medium transition-colors shadow-sm border border-surface-container-highest/60"
          >
            <Edit className="w-3.5 h-3.5 text-primary" />
            <span>{isOpeningEdit ? 'Opening…' : 'Edit with AI'}</span>
          </button>
          <details className="trip-more-actions relative" onKeyDown={event => { if (event.key === 'Escape') { event.currentTarget.open = false; event.currentTarget.querySelector('summary')?.focus(); } }}>
          <summary className="cursor-pointer list-none px-3 py-2 rounded-lg border border-surface-container-highest bg-surface-container-high text-xs font-semibold">More actions ▾</summary>
          <div className="trip-extra-actions">
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
            <span className="trip-action-label">Copy itinerary text</span>
          </button>
          <button
            type="button"
            aria-label="Download itinerary calendar"
            onClick={handleCalendarSync}
            title="Download calendar events"
            className="p-2 rounded-lg bg-surface-container-high hover:bg-surface-bright text-primary transition-colors shadow-sm border border-surface-container-highest/60"
          >
            <CalendarCheck className="w-3.5 h-3.5" />
            <span className="trip-action-label">Calendar export</span>
            {!trip?.plusAccess && <LockKeyhole className="w-3 h-3" aria-label="Requires Trip Plus" />}
          </button>
          </div>
          </details>
        </div>
      </div>

      {/* Navigation Tabs Strip */}
      <LayoutGroup id={`${tabGroup}-${trip?.id}`}>
      <div className="trip-tabs shrink-0 px-3 pt-2 bg-surface-container/95 border-b border-surface-container-high/40 flex flex-wrap items-center gap-1 sticky top-16 z-20" aria-label="Trip sections">
        {([
          { key: 'overview', label: 'Overview', tab: 'route-tab', mode: 'overview', Icon: null },
          { key: 'days', label: 'Days & map', tab: 'route-tab', mode: 'days', Icon: CalendarDays },
          { key: 'flights', label: `Flights (${flights.length})`, tab: 'flights-tab', Icon: Plane },
          { key: 'hotels', label: `Hotels (${hotels.length})`, tab: 'hotels-tab', Icon: Hotel },
          { key: 'weather', label: 'Weather Forecast', tab: 'weather-tab', Icon: CloudSun },
          { key: 'budget', label: 'Budget Auditor', tab: 'budget-tab', Icon: Wallet },
        ] as const).map(item => {
          const selected = activeTab === item.tab && (!('mode' in item) || routeMode === item.mode);
          const Icon = item.Icon;
          return <button key={item.key} type="button" aria-pressed={selected}
            onClick={() => {
              if ('mode' in item) { setRouteMode(item.mode); sessionStorage.setItem(`TRAVELAI_ROUTE_MODE:${trip?.id}`, item.mode); }
              onSwitchTab(item.tab);
            }}
            className={`motion-tab ${item.key === 'overview' ? 'motion-tab-overview text-sm' : 'text-xs font-medium'} tab-button flex items-center gap-1.5 px-3 py-2 rounded-t-lg whitespace-nowrap border-t border-x ${selected ? 'text-primary font-semibold' : 'text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high/60'}`}>
            {selected && <ActiveIndicator id="trip-tab" className="motion-tab-indicator" />}
            {Icon && <Icon className="w-4 h-4" />}<span>{item.label}</span>
          </button>;
        })}
      </div>
      </LayoutGroup>

      {/* Tab Content Area */}
      <div ref={contentFade} className="flex-1 min-w-0 p-3 sm:p-5 space-y-space-md">
        {trip && activeTab === 'route-tab' && routeMode === 'overview' && <TripReadiness
          trip={trip} days={days} flights={flights} hotels={hotels} nearbyHotels={nearbyHotels} weather={readinessWeather} budget={budget}
          onNavigate={tab => {
            if (tab === 'route-tab') { setRouteMode('days'); sessionStorage.setItem(`TRAVELAI_ROUTE_MODE:${trip.id}`, 'days'); }
            onSwitchTab(tab);
          }}
        />}
        {trip && !trip.plusAccess && <section aria-label="Trip access" className="flex flex-wrap items-center gap-3 text-sm py-2"><span className="text-on-surface-variant">Basic planning is free.</span><button type="button" onClick={onBookings} className="text-primary underline">Book a flight or hotel — Demo</button><button type="button" onClick={onUpgrade} className="text-primary underline">Upgrade only — ₹499 Demo</button></section>}
        {activeTab === 'companion-tab' && trip?.plusAccess && (
          <CompanionMode
            trip={trip}
            days={days}
            onUpdateExecutionState={onUpdateExecutionState || (async () => false)}
            onApplyRerouteResult={onApplyRerouteResult}
            onSwitchTab={onSwitchTab}
          />
        )}
        {(activeTab === 'route-tab' || (activeTab === 'companion-tab' && !trip?.plusAccess)) && <RouteTab key={trip?.id} mode={routeMode} onOverview={() => { setRouteMode('overview'); sessionStorage.setItem(`TRAVELAI_ROUTE_MODE:${trip?.id}`, 'overview'); }} onOpenDay={() => { setRouteMode('days'); sessionStorage.setItem(`TRAVELAI_ROUTE_MODE:${trip?.id}`, 'days'); }} trip={trip} days={days} onSwitchTab={onSwitchTab} />}
        {activeTab === 'flights-tab' && (
          <FlightsTab onBook={onBook} flights={flights} onSelectFlight={onSelectFlight} destination={trip?.destination} trip={trip} />
        )}
        {activeTab === 'hotels-tab' && (
          <HotelsTab onBook={onBook} hotels={hotels} nearbyHotels={nearbyHotels} onSelectHotel={onSelectHotel} />
        )}
        {activeTab === 'weather-tab' && <WeatherTab key={trip?.id} tripId={trip?.id} weather={weather} destination={trip?.destination} onTripForecast={saveTripForecast} />}
        {activeTab === 'budget-tab' && <BudgetTab budget={budget} />}
      </div>
    </section>
    </>
  );
};
