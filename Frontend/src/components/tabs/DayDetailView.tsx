import React, { useState, useEffect } from 'react';
import { 
  ArrowLeft, 
  MapPin, 
  Clock, 
  CheckCircle, 
  AlertTriangle, 
  HelpCircle, 
  Star, 
  Compass, 
  Utensils, 
  Hotel, 
  Plane,
  ChevronDown, 
  ChevronUp, 
  ChevronLeft, 
  ChevronRight,
  ExternalLink,
  Sparkles
} from 'lucide-react';
import { TripSummary, ItineraryDay, ActivitySegment, RouteLeg, TravelMode } from '../../types';
import { DayMapView } from './DayMapView';
import { RouteDirectionsDrawer } from './RouteDirectionsDrawer';
import { calculateHaversineKm, validRouteCoordinates, isFlightConnection, buildGoogleMapsUrl } from '../../services/routingService';
import { fetchDayDirections } from '../../services/rerouteV2';


interface DayDetailViewProps {
  trip: TripSummary | null;
  day: ItineraryDay;
  totalDays: number;
  onBack: () => void;
  onSelectDay: (dayNumber: number) => void;
}

export function getActivityCategoryMeta(act: ActivitySegment): {
  iconType: 'plane' | 'hotel' | 'dining' | 'attraction';
  label: string;
} {
  const title = (act.title || '').toLowerCase();
  const desc = (act.description || '').toLowerCase();
  const cat = (act.category || '').toLowerCase();
  const combined = `${title} ${desc} ${cat}`;

  if (combined.includes('airport') || combined.includes('flight') || combined.includes('terminal') || combined.includes('transfer')) {
    return { iconType: 'plane', label: 'Airport Transit' };
  }
  if (combined.includes('hotel') || combined.includes('resort') || combined.includes('check-in') || combined.includes('stay') || combined.includes('accommodation')) {
    return { iconType: 'hotel', label: 'Hotel & Stay' };
  }
  if (combined.includes('restaurant') || combined.includes('dining') || combined.includes('cuisine') || combined.includes('cafe') || combined.includes('bistro') || act.timeOfDay === 'Afternoon') {
    return { iconType: 'dining', label: 'Dining & Gastronomy' };
  }
  return { iconType: 'attraction', label: act.category || 'Sightseeing & Culture' };
}

export const CategoryPlaceholder: React.FC<{
  categoryMeta: { iconType: 'plane' | 'hotel' | 'dining' | 'attraction'; label: string };
  title?: string;
  size?: 'sm' | 'md' | 'lg';
}> = ({ categoryMeta, title, size = 'md' }) => {
  const icon = categoryMeta.iconType === 'plane' ? (
    <Plane className={size === 'sm' ? "w-4 h-4 text-sky-400" : size === 'lg' ? "w-10 h-10 text-sky-400" : "w-6 h-6 text-sky-400"} />
  ) : categoryMeta.iconType === 'hotel' ? (
    <Hotel className={size === 'sm' ? "w-4 h-4 text-emerald-400" : size === 'lg' ? "w-10 h-10 text-emerald-400" : "w-6 h-6 text-emerald-400"} />
  ) : categoryMeta.iconType === 'dining' ? (
    <Utensils className={size === 'sm' ? "w-4 h-4 text-amber-400" : size === 'lg' ? "w-10 h-10 text-amber-400" : "w-6 h-6 text-amber-400"} />
  ) : (
    <Compass className={size === 'sm' ? "w-4 h-4 text-primary" : size === 'lg' ? "w-10 h-10 text-primary" : "w-6 h-6 text-primary"} />
  );

  if (size === 'sm') {
    return (
      <div className="w-full h-full flex items-center justify-center bg-surface-container-high text-on-surface-variant">
        {icon}
      </div>
    );
  }

  return (
    <div className="w-full h-full min-h-[180px] flex flex-col items-center justify-center p-6 bg-gradient-to-br from-surface-container-high to-surface-container-highest text-center select-none">
      <div className="p-3.5 rounded-2xl bg-surface-container/90 border border-white/10 shadow-sm mb-2">
        {icon}
      </div>
      <span className="text-[11px] font-bold text-on-surface-variant uppercase tracking-wider">
        {categoryMeta.label}
      </span>
      {title && (
        <span className="text-[11px] text-on-surface-variant/70 mt-0.5 line-clamp-1 max-w-[180px]">
          {title}
        </span>
      )}
    </div>
  );
};

export function getCategoryFallbackImage(act: ActivitySegment, destination?: string): string {
  const title = (act.title || '').toLowerCase();
  const desc = (act.description || '').toLowerCase();
  const cat = (act.category || '').toLowerCase();
  const dest = (destination || '').toLowerCase();
  const combined = `${title} ${desc} ${cat} ${dest}`;

  // 1. Airport Transit
  if (combined.includes('airport') || combined.includes('terminal') || combined.includes('flight') || (act.type === 'airport')) {
    if (combined.includes('hyderabad') || combined.includes('hyd') || combined.includes('rajiv gandhi')) {
      return 'https://images.unsplash.com/photo-1530521954074-e64f6810b32d?auto=format&fit=crop&w=800&q=80';
    }
    if (combined.includes('mumbai') || combined.includes('bom') || combined.includes('chhatrapati')) {
      return 'https://images.unsplash.com/photo-1542296332-2e4473faf563?auto=format&fit=crop&w=800&q=80';
    }
    if (combined.includes('delhi') || combined.includes('del') || combined.includes('indira gandhi')) {
      return 'https://images.unsplash.com/photo-1436491865332-7a61a109cc05?auto=format&fit=crop&w=800&q=80';
    }
    return 'https://images.unsplash.com/photo-1530521954074-e64f6810b32d?auto=format&fit=crop&w=800&q=80';
  }

  // 2. Hotel & Accommodation
  if (combined.includes('hotel') || combined.includes('resort') || combined.includes('check-in') || combined.includes('check-out') || combined.includes('stay') || combined.includes('accommodation') || (act.type === 'hotel')) {
    if (combined.includes('hyderabad')) {
      return 'https://images.unsplash.com/photo-1566073771259-6a8506099945?auto=format&fit=crop&w=800&q=80';
    }
    if (combined.includes('goa')) {
      return 'https://images.unsplash.com/photo-1582719508461-905c673771fd?auto=format&fit=crop&w=800&q=80';
    }
    if (combined.includes('jaipur') || combined.includes('rajasthan')) {
      return 'https://images.unsplash.com/photo-1590490360182-c33d57733427?auto=format&fit=crop&w=800&q=80';
    }
    return 'https://images.unsplash.com/photo-1566073771259-6a8506099945?auto=format&fit=crop&w=800&q=80';
  }

  // 3. Dining & Gastronomy
  if (combined.includes('restaurant') || combined.includes('dining') || combined.includes('cuisine') || combined.includes('cafe') || combined.includes('bistro') || combined.includes('biryani') || (act.type === 'restaurant') || act.timeOfDay === 'Afternoon') {
    if (combined.includes('hyderabad') || combined.includes('biryani') || combined.includes('mughlai') || combined.includes('nizam') || combined.includes('bahar') || combined.includes('bidri')) {
      return 'https://images.unsplash.com/photo-1589302168068-964664d93dc0?auto=format&fit=crop&w=800&q=80';
    }
    if (combined.includes('goa') || combined.includes('seafood') || combined.includes('fish')) {
      return 'https://images.unsplash.com/photo-1559847844-5315695dadae?auto=format&fit=crop&w=800&q=80';
    }
    if (combined.includes('delhi') || combined.includes('tandoor') || combined.includes('punjabi')) {
      return 'https://images.unsplash.com/photo-1601050690597-df0568f70950?auto=format&fit=crop&w=800&q=80';
    }
    return 'https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?auto=format&fit=crop&w=800&q=80';
  }

  // 4. Attractions by category
  if (combined.includes('temple') || combined.includes('mandir') || combined.includes('spiritual') || combined.includes('swamy') || combined.includes('krishna') || combined.includes('shiva') || combined.includes('jagan')) {
    return 'https://images.unsplash.com/photo-1582510003544-4d00b7f74220?auto=format&fit=crop&w=800&q=80';
  }
  if (combined.includes('fort') || combined.includes('palace') || combined.includes('monument') || combined.includes('heritage') || combined.includes('history')) {
    return 'https://images.unsplash.com/photo-1599661046289-e31897846e41?auto=format&fit=crop&w=800&q=80';
  }
  if (combined.includes('beach') || combined.includes('sea') || combined.includes('coast') || combined.includes('ocean')) {
    return 'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&w=800&q=80';
  }
  if (combined.includes('museum') || combined.includes('gallery') || combined.includes('art')) {
    return 'https://images.unsplash.com/photo-1565008447742-97f6f38c985c?auto=format&fit=crop&w=800&q=80';
  }
  if (combined.includes('park') || combined.includes('garden') || combined.includes('lake') || combined.includes('nature') || combined.includes('waterfall')) {
    return 'https://images.unsplash.com/photo-1519331379826-f10be5486c6f?auto=format&fit=crop&w=800&q=80';
  }
  if (combined.includes('market') || combined.includes('bazaar') || combined.includes('shopping')) {
    return 'https://images.unsplash.com/photo-1533900298318-6b8da08a523e?auto=format&fit=crop&w=800&q=80';
  }

  return 'https://images.unsplash.com/photo-1488646953014-85cb44e25828?auto=format&fit=crop&w=800&q=80';
}

export function resolvePlaceImage(act: ActivitySegment, destination?: string): string {
  // 1. Direct verified thumbnail or image_url fields on activity
  const direct = act.thumbnail || (act as any).image_url || (act as any).imageUrl || (act as any).image;
  if (direct && typeof direct === 'string' && (direct.startsWith('http://') || direct.startsWith('https://'))) {
    if (!direct.includes('picsum.photos')) {
      return direct;
    }
  }

  // 2. Intelligent verified destination & venue photo fallback
  return getCategoryFallbackImage(act, destination);
}

function StatusBadge({ status }: { status?: string }) {
  if (!status) return null;
  const upper = status.toUpperCase();
  if (upper === 'OPEN') {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold uppercase tracking-wider bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30">
        <CheckCircle className="w-3.5 h-3.5" /> Open Today
      </span>
    );
  }
  if (upper === 'CLOSED') {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold uppercase tracking-wider bg-rose-500/15 text-rose-600 dark:text-rose-400 border border-rose-500/30">
        <AlertTriangle className="w-3.5 h-3.5" /> Closed Today
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold uppercase tracking-wider bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/30">
      <HelpCircle className="w-3.5 h-3.5" /> Hours Unverified
    </span>
  );
}

const ActivityCard: React.FC<{ act: ActivitySegment; dayNumber: number; index: number; destination?: string }> = ({ act, dayNumber, index, destination }) => {
  const [showHours, setShowHours] = useState(false);

  const isMorning = act.timeOfDay === 'Morning';
  const isAfternoon = act.timeOfDay === 'Afternoon';
  const isEvening = act.timeOfDay === 'Evening';

  const [imgError, setImgError] = useState(false);
  const [currentImg, setCurrentImg] = useState<string>(() => resolvePlaceImage(act, destination));

  useEffect(() => {
    setCurrentImg(resolvePlaceImage(act, destination));
    setImgError(false);
  }, [act, destination]);

  const categoryMeta = getActivityCategoryMeta(act);
  const hasHours = act.operatingHours && act.operatingHours.length > 0;

  const typeIcon = isMorning ? (
    <Compass className="w-4 h-4 text-sky-400" />
  ) : isAfternoon ? (
    <Utensils className="w-4 h-4 text-purple-400" />
  ) : (
    <Hotel className="w-4 h-4 text-emerald-400" />
  );

  const badgeTheme = isMorning
    ? 'bg-sky-500/10 text-sky-400 border-sky-500/30'
    : isAfternoon
    ? 'bg-purple-500/10 text-purple-400 border-purple-500/30'
    : 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30';

  return (
    <div className="group rounded-2xl bg-surface-container overflow-hidden border border-surface-container-highest/60 hover:border-primary/50 transition-all duration-300 shadow-md hover:shadow-xl flex flex-col md:flex-row">
      {/* Real-time Place Image Banner or Category Placeholder */}
      <div className="relative md:w-72 h-52 md:h-auto flex-shrink-0 overflow-hidden bg-surface-container-highest">
        {currentImg && !imgError ? (
          <>
            <img
              src={currentImg}
              alt={act.title}
              referrerPolicy="no-referrer"
              className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
              loading="lazy"
              onError={() => {
                const fallback = getCategoryFallbackImage(act, destination);
                if (currentImg !== fallback) {
                  setCurrentImg(fallback);
                } else {
                  setImgError(true);
                }
              }}
            />
            <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent md:hidden" />
          </>
        ) : (
          <CategoryPlaceholder categoryMeta={categoryMeta} title={act.title} size="lg" />
        )}
        
        {/* Time Badge Overlay */}
        <div className="absolute top-3 left-3 flex items-center gap-1.5 px-3 py-1 rounded-full bg-black/60 backdrop-blur-md text-white text-xs font-semibold border border-white/20 shadow-sm z-10">
          {typeIcon}
          <span>{act.timeOfDay} • {act.time}</span>
        </div>

        {/* Status Badge Overlay on Image (Mobile) */}
        {act.operatingStatus && (
          <div className="absolute bottom-3 left-3 md:hidden z-10">
            <StatusBadge status={act.operatingStatus} />
          </div>
        )}
      </div>

      {/* Place Details Content */}
      <div className="p-space-md flex-1 flex flex-col justify-between space-y-3">
        <div>
          {/* Header Row */}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className={`px-2.5 py-0.5 rounded-full text-[11px] font-bold uppercase tracking-wider border ${badgeTheme}`}>
              Stop {index + 1} • {isMorning ? 'Must-Visit Attraction' : isAfternoon ? 'Curated Dining' : 'Evening Experience'}
            </span>

            {/* Status Badge (Desktop) */}
            <div className="hidden md:block">
              <StatusBadge status={act.operatingStatus} />
            </div>
          </div>

          {/* Place Title */}
          <h3 className="text-base sm:text-lg font-bold text-on-surface mt-1.5 group-hover:text-primary transition-colors flex items-center gap-2">
            {act.title}
          </h3>

          {/* Location Pin */}
          {act.location && (
            <div className="flex items-center gap-1.5 text-xs text-on-surface-variant mt-1 font-medium">
              <MapPin className="w-3.5 h-3.5 text-primary flex-shrink-0" />
              <span>{act.location}</span>
            </div>
          )}

          {/* Description */}
          <p className="text-xs sm:text-sm text-on-surface-variant/90 leading-relaxed mt-2.5">
            {act.description}
          </p>
        </div>

        {/* Metadata Chips & Badges */}
        <div className="pt-2 border-t border-surface-container-highest/40 space-y-2">
          <div className="flex flex-wrap items-center gap-3 text-xs text-on-surface-variant">
            {/* Rating */}
            {act.rating && (
              <div className="flex items-center gap-1 font-semibold text-amber-500">
                <Star className="w-3.5 h-3.5 fill-amber-500" />
                <span>{act.rating}</span>
                {act.reviews && (
                  <span className="text-[11px] text-on-surface-variant/70 font-normal">
                    ({act.reviews} reviews)
                  </span>
                )}
              </div>
            )}

            {/* Recommended Time Spent */}
            {act.recommendedTimeSpent && (
              <div className="flex items-center gap-1 bg-surface-container-highest/50 px-2.5 py-1 rounded-lg text-[11px] font-medium text-on-surface">
                <Clock className="w-3 h-3 text-primary" />
                <span>Time: {act.recommendedTimeSpent}</span>
              </div>
            )}

            {/* Entrance Fee / Cost */}
            {act.entranceFee !== undefined && act.entranceFee > 0 ? (
              <div className="flex items-center gap-1 bg-surface-container-highest/50 px-2.5 py-1 rounded-lg text-[11px] font-medium text-emerald-400">
                <span>Fee: ₹{act.entranceFee} / person</span>
              </div>
            ) : act.entranceFee === 0 && isMorning ? (
              <div className="flex items-center gap-1 bg-surface-container-highest/50 px-2.5 py-1 rounded-lg text-[11px] font-medium text-emerald-400">
                <span>Free Entry</span>
              </div>
            ) : null}

            {/* Cuisine */}
            {act.cuisine && (
              <div className="flex items-center gap-1 bg-surface-container-highest/50 px-2.5 py-1 rounded-lg text-[11px] font-medium text-purple-400">
                <Utensils className="w-3 h-3" />
                <span>{act.cuisine}</span>
              </div>
            )}

            {/* Expandable Hours toggle */}
            {hasHours && (
              <button
                onClick={() => setShowHours(!showHours)}
                className="ml-auto flex items-center gap-1 text-xs font-semibold text-primary hover:text-primary/80 transition-colors py-1 px-2 rounded-lg hover:bg-primary/10"
              >
                <Clock className="w-3.5 h-3.5" />
                <span>Weekly Schedule</span>
                {showHours ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
              </button>
            )}
          </div>

          {/* Warning for unverified */}
          {act.operatingStatus === 'UNKNOWN' && (
            <div className="flex items-center gap-2 p-2 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-500 text-xs font-medium">
              <AlertTriangle className="w-4 h-4 flex-shrink-0" />
              <span>Live opening hours unavailable for this spot — please verify locally before visiting.</span>
            </div>
          )}

          {/* Expanded Operating Hours Dropdown */}
          {showHours && hasHours && (
            <div className="mt-2 p-3 rounded-xl bg-surface-container-lowest border border-surface-container-highest/60 text-xs space-y-1.5 animate-in fade-in slide-in-from-top-1 duration-200">
              <div className="font-semibold text-on-surface flex items-center justify-between pb-1 border-b border-surface-container-highest/30">
                <span>Operating Hours</span>
                {act.scheduledDate && (
                  <span className="text-[11px] text-primary">Scheduled: {act.dayOfWeek || act.scheduledDate}</span>
                )}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-1 text-on-surface-variant pt-1">
                {act.operatingHours!.map((schedule, sIdx) => (
                  <div key={sIdx} className="flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-primary/60" />
                    <span>{schedule}</span>
                  </div>
                ))}
              </div>
              {act.statusReason && (
                <div className="text-[10px] text-on-surface-variant/60 pt-1 italic">
                  Data source: {act.statusReason}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export const DayDetailView: React.FC<DayDetailViewProps> = ({
  trip,
  day,
  totalDays,
  onBack,
  onSelectDay,
}) => {
  const [legs, setLegs] = useState<RouteLeg[]>([]);
  const [activeLegIndex, setActiveLegIndex] = useState<number>(-1);
  const [selectedMode, setSelectedMode] = useState<TravelMode>('driving');
  const routingMode = selectedMode === 'walking' ? 'walking' : 'driving';
  const [isLoadingRoutes, setIsLoadingRoutes] = useState<boolean>(false);

  const [directionsError, setDirectionsError] = useState<string | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    setLegs([]); setActiveLegIndex(-1); setIsLoadingRoutes(true); setDirectionsError(null);
    async function load() {
      try {
        if (!trip?.id) throw new Error('Save a trip to load road directions.');
        const result = await fetchDayDirections(trip.id, day.dayNumber, routingMode, controller.signal);
        if (controller.signal.aborted) return;
        if (result.revision !== (trip.revision || 1)) throw new Error('Trip changed. Refresh to load matching directions.');
        setLegs(result.legs);
      } catch (error) {
        if (controller.signal.aborted) return;
        setDirectionsError(error instanceof Error ? error.message : 'Directions unavailable. Showing labelled distance estimates.');
        // A disconnected backend must not trigger direct public-provider requests.
        setLegs(day.activities.slice(1).map((to, i) => {
          const from = day.activities[i];
          const start: unknown = [from.lat, from.lon], end: unknown = [to.lat, to.lon];
          const available = validRouteCoordinates(start) && validRouteCoordinates(end);
          const a: [number, number] = validRouteCoordinates(start) ? start : [0, 0];
          const b: [number, number] = validRouteCoordinates(end) ? end : [0, 0];
          const km = available ? calculateHaversineKm(...a, ...b) : 0;
          const flight = available && isFlightConnection(from, to);
          return { fromTitle: from.title, toTitle: to.title, fromCoords: a, toCoords: b, mode: selectedMode,
            distanceKm: km, durationMins: flight ? 0 : Math.ceil(km / (selectedMode === 'walking' ? 4.5 : 25) * 60),
            geometry: available ? [a, b] : [], steps: [], googleMapsUrl: available ? buildGoogleMapsUrl(a, b, selectedMode) : '',
            status: !available ? 'no_route' : flight ? 'flight' : 'fallback', isFlightLeg: flight,
            errorMessage: available ? 'Straight-line estimate; road directions unavailable' : 'Missing GPS coordinates for this stop' };
        }));
      } finally { if (!controller.signal.aborted) setIsLoadingRoutes(false); }
    }
    void load();
    return () => controller.abort();
  }, [trip?.id, trip?.revision, day.dayNumber, day.activities, routingMode]);


  return (
    <div className="space-y-space-md animate-in fade-in slide-in-from-right-2 duration-300">
      {directionsError && <p role="status" className="text-xs p-3 rounded-xl border border-amber-500/30 text-on-surface-variant">{directionsError} Saved venue locations remain visible; connections are estimates.</p>}
      {/* Top Navigation Header */}
      <div className="flex items-center justify-between gap-3 bg-surface-container p-4 rounded-2xl border border-surface-container-highest/60 shadow-md">
        <button
          onClick={onBack}
          className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-surface-container-high hover:bg-primary/20 text-on-surface hover:text-primary font-semibold text-xs transition-all border border-surface-container-highest/80 shadow-sm"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Back to Route Timeline</span>
        </button>

        {/* Day Switcher */}
        <div className="flex items-center gap-1.5">
          <button
            disabled={day.dayNumber <= 1}
            onClick={() => onSelectDay(day.dayNumber - 1)}
            className="p-2 rounded-xl bg-surface-container-high hover:bg-primary/20 disabled:opacity-30 disabled:pointer-events-none text-on-surface transition-all border border-surface-container-highest/60"
            title="Previous Day"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          
          <span className="px-3 py-1 rounded-xl bg-primary/10 text-primary font-bold text-xs border border-primary/20">
            Day {day.dayNumber} of {totalDays}
          </span>

          <button
            disabled={day.dayNumber >= totalDays}
            onClick={() => onSelectDay(day.dayNumber + 1)}
            className="p-2 rounded-xl bg-surface-container-high hover:bg-primary/20 disabled:opacity-30 disabled:pointer-events-none text-on-surface transition-all border border-surface-container-highest/60"
            title="Next Day"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Day Hero Header Banner */}
      <div className="p-6 rounded-2xl bg-gradient-to-r from-surface-container via-surface-container-high to-surface-container border border-surface-container-highest/60 shadow-lg relative overflow-hidden">
        <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-1.5">
              <span className="px-2.5 py-0.5 rounded-full bg-primary text-on-primary font-bold text-[11px] uppercase tracking-wider shadow-sm">
                Day {day.dayNumber} Itinerary
              </span>
              <span className="px-2.5 py-0.5 rounded-full bg-surface-container-highest text-on-surface font-semibold text-xs border border-surface-container-highest">
                {day.date}
              </span>
            </div>
            <h2 className="text-xl sm:text-2xl font-bold text-on-surface">
              {day.title}
            </h2>
            <p className="text-xs sm:text-sm text-on-surface-variant mt-1">
              {trip?.destination} • {day.transitBadge}
            </p>
          </div>

          <div className="flex items-center gap-3">
            <div className="px-4 py-2.5 rounded-xl bg-surface-container-lowest/80 backdrop-blur-md border border-surface-container-highest/60 text-right">
              <div className="text-[10px] text-on-surface-variant uppercase font-bold tracking-wider">Scheduled Stops</div>
              <div className="text-base font-bold text-primary flex items-center gap-1 justify-end">
                <Sparkles className="w-4 h-4 text-amber-400" />
                <span>{day.activities.length} Key Highlights</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Interactive Route Map and Turn-by-Turn Directions Grid */}
      <div className="day-route-container">
      <div className="day-route-layout">
        {/* Left Column: Map */}
        <div className="day-route-map-column min-w-0 flex flex-col space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2 px-1">
            <h3 className="text-sm font-bold text-on-surface flex items-center gap-2">
              <MapPin className="w-4 h-4 text-primary" />
              <span>Interactive Waypoints & Street Route Map</span>
            </h3>
            <span className="text-[11px] text-on-surface-variant font-medium">Click routes or markers to view details</span>
          </div>

          <div className="day-route-map">
            <DayMapView
              tripId={trip?.id}
              activities={day.activities}
              destination={trip?.destination}
              dayNumber={day.dayNumber}
              legs={legs}
              activeLegIndex={activeLegIndex}
              onSelectLeg={(idx) => setActiveLegIndex(idx)}
            />
          </div>
        </div>

        {/* Right Column: Directions Drawer */}
        <div className="day-route-directions min-w-0 flex flex-col">
          {legs.length > 0 ? (
            <RouteDirectionsDrawer
              legs={legs}
              activeLegIndex={activeLegIndex}
              onSelectLeg={(idx) => setActiveLegIndex(idx)}
              selectedMode={selectedMode}
              onChangeMode={(mode) => setSelectedMode(mode)}
              isLoading={isLoadingRoutes}
            />
          ) : (
            <div className="h-full rounded-2xl bg-surface-container border border-surface-container-highest/60 shadow-sm p-6 flex flex-col items-center justify-center text-center">
              <div className="w-12 h-12 rounded-full bg-surface-container-highest flex items-center justify-center mb-3">
                <Compass className="w-6 h-6 text-on-surface-variant" />
              </div>
              <p className="text-sm font-semibold text-on-surface">No directions available</p>
              <p className="text-xs text-on-surface-variant mt-1">Need at least 2 stops to calculate a route.</p>
            </div>
          )}
        </div>
      </div>

      {/* Deep Dive Activities Sequence */}
      </div>
      <div className="space-y-3 pt-2">
        <div className="flex flex-wrap items-center justify-between gap-2 px-1">
          <h3 className="text-sm font-bold text-on-surface flex items-center gap-2">
            <Compass className="w-4 h-4 text-sky-400" />
            <span>Curated Places & Schedule Breakdown</span>
          </h3>
          <span className="text-[11px] text-on-surface-variant font-medium">Real-time venue information</span>
        </div>

        <div className="space-y-4">
          {day.activities.map((act, idx) => (
            <ActivityCard
              key={`${day.dayNumber}-detail-act-${idx}`}
              act={act}
              dayNumber={day.dayNumber}
              index={idx}
              destination={trip?.destination}
            />
          ))}
        </div>
      </div>

      {/* Bottom Navigation Switcher */}
      <div className="pt-4 border-t border-surface-container-highest/60 flex items-center justify-between">
        <button
          onClick={onBack}
          className="flex items-center gap-2 text-xs font-semibold text-on-surface hover:text-primary transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Back to All Days Overview</span>
        </button>

        {day.dayNumber < totalDays && (
          <button
            onClick={() => onSelectDay(day.dayNumber + 1)}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-primary text-on-primary font-bold text-xs hover:bg-primary/90 transition-all shadow-md"
          >
            <span>Proceed to Day {day.dayNumber + 1}</span>
            <ChevronRight className="w-4 h-4" />
          </button>
        )}
      </div>
    </div>
  );
};
