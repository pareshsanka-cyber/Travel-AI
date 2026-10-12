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
import { fetchLegDirections, calculateHaversineKm } from '../../services/routingService';


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
  const [isLoadingRoutes, setIsLoadingRoutes] = useState<boolean>(false);

  // Compute turn-by-turn road directions per itinerary leg using OSRM
  useEffect(() => {
    let isCancelled = false;

    async function computeLegs() {
      if (!day.activities || day.activities.length < 2) {
        setLegs([]);
        return;
      }

      setIsLoadingRoutes(true);

      // Extended fallback coordinate map — only used when backend provides no coordinates.
      // Priority: backend lat/lon > this map > no marker (never fake Delhi).
      const fallbackCoords: Record<string, [number, number]> = {
        // India
        delhi: [28.6139, 77.2090],
        'new delhi': [28.6139, 77.2090],
        goa: [15.2993, 74.1240],
        jaipur: [26.9124, 75.7873],
        mumbai: [19.0760, 72.8777],
        bengaluru: [12.9716, 77.5946],
        bangalore: [12.9716, 77.5946],
        agra: [27.1767, 78.0081],
        varanasi: [25.3176, 82.9739],
        udaipur: [24.5854, 73.7125],
        kerala: [9.9312, 76.2673],
        kochi: [9.9312, 76.2673],
        manali: [32.2432, 77.1892],
        shimla: [31.1048, 77.1734],
        hyderabad: [17.3850, 78.4867],
        chennai: [13.0827, 80.2707],
        kolkata: [22.5726, 88.3639],
        // Australia & Oceania
        sydney: [-33.8688, 151.2093],
        melbourne: [-37.8136, 144.9631],
        brisbane: [-27.4698, 153.0251],
        perth: [-31.9505, 115.8605],
        adelaide: [-34.9285, 138.6007],
        auckland: [-36.8509, 174.7645],
        // International
        london: [51.5074, -0.1278],
        paris: [48.8566, 2.3522],
        dubai: [25.2048, 55.2708],
        singapore: [1.3521, 103.8198],
        tokyo: [35.6762, 139.6503],
        bangkok: [13.7563, 100.5018],
        'kuala lumpur': [3.1390, 101.6869],
        bali: [-8.3405, 115.0920],
        'new york': [40.7128, -74.0060],
        'new york city': [40.7128, -74.0060],
        'los angeles': [34.0522, -118.2437],
        toronto: [43.6532, -79.3832],
        seoul: [37.5665, 126.9780],
        beijing: [39.9042, 116.4074],
        shanghai: [31.2304, 121.4737],
        rome: [41.9028, 12.4964],
        barcelona: [41.3851, 2.1734],
        amsterdam: [52.3676, 4.9041],
        berlin: [52.5200, 13.4050],
      };

      // Resolve the destination-level fallback (only used if activity has no backend coords)
      const destKey = (trip?.destination || '').toLowerCase().split(',')[0].trim();
      // Try multi-word match first (e.g. "new york"), then single word
      const defaultCenter: [number, number] =
        fallbackCoords[destKey] ||
        fallbackCoords[destKey.split(' ')[0]] ||
        null as any;

      // Helper: validate a coordinate pair
      function isValidCoord(lat: number, lon: number): boolean {
        return (
          typeof lat === 'number' &&
          typeof lon === 'number' &&
          !isNaN(lat) && !isNaN(lon) &&
          lat >= -90 && lat <= 90 &&
          lon >= -180 && lon <= 180 &&
          !(lat === 0 && lon === 0)
        );
      }

      // Helper: resolve coords for a single activity
      function resolveCoords(act: ActivitySegment, idx: number): [number, number] | null {
        // Priority 1: backend-provided real coordinates
        if (act.lat && act.lon && isValidCoord(act.lat, act.lon)) {
          return [act.lat, act.lon];
        }
        // Priority 2: destination fallback (correct city)
        if (defaultCenter) {
          // Small offset so markers don't stack exactly on top of each other
          const offsetLat = (idx === 0 ? 0.008 : idx === 1 ? -0.006 : 0.004);
          const offsetLon = (idx === 0 ? -0.006 : idx === 1 ? 0.008 : 0.006);
          return [defaultCenter[0] + offsetLat, defaultCenter[1] + offsetLon];
        }
        // Priority 3: no valid coords — return null, don't fake Delhi
        return null;
      }

      const legPromises: Promise<RouteLeg>[] = [];

      for (let i = 0; i < day.activities.length - 1; i++) {
        const fromAct = day.activities[i];
        const toAct = day.activities[i + 1];

        const fromCoords = resolveCoords(fromAct, i);
        const toCoords = resolveCoords(toAct, i + 1);

        // If either end has no valid coords at all, skip OSRM
        if (!fromCoords || !toCoords) {
          legPromises.push(Promise.resolve({
            fromTitle: fromAct.title,
            toTitle: toAct.title,
            fromCoords: fromCoords || [0, 0],
            toCoords: toCoords || [0, 0],
            mode: selectedMode,
            distanceKm: 0,
            durationMins: 0,
            geometry: [],
            steps: [{ instruction: 'Location coordinates unavailable', distanceMeters: 0, durationSeconds: 0, name: '' }],
            googleMapsUrl: '',
            status: 'no_route',
            isFlightLeg: false,
            errorMessage: 'Missing GPS coordinates for this stop',
          }));
          continue;
        }

        // Detect international / transcontinental segments using straight-line distance.
        // A segment > 500 km straight-line cannot be a road route — treat as flight.
        const straightLineDist = calculateHaversineKm(
          fromCoords[0], fromCoords[1],
          toCoords[0], toCoords[1]
        );

        if (straightLineDist > 500) {
          // International flight segment — do NOT call OSRM
          legPromises.push(Promise.resolve({
            fromTitle: fromAct.title,
            toTitle: toAct.title,
            fromCoords,
            toCoords,
            mode: 'driving', // Kept as driving to satisfy type; isFlightLeg=true overrides UI
            distanceKm: Math.round(straightLineDist * 10) / 10,
            durationMins: 0,   // No driving duration for a flight
            geometry: [],      // No road geometry — frontend draws arc instead
            steps: [],
            googleMapsUrl: `https://www.google.com/maps/dir/?api=1&origin=${fromCoords[0]},${fromCoords[1]}&destination=${toCoords[0]},${toCoords[1]}`,
            status: 'flight',
            isFlightLeg: true,
          }));
        } else {
          // Local road/walking route — use OSRM normally
          legPromises.push(
            fetchLegDirections(fromCoords, toCoords, fromAct.title, toAct.title, selectedMode)
          );
        }
      }

      try {
        const resolvedLegs = await Promise.all(legPromises);
        if (!isCancelled) {
          setLegs(resolvedLegs);
        }
      } catch {
        // Handled internally in fetchLegDirections with fallbacks
      } finally {
        if (!isCancelled) {
          setIsLoadingRoutes(false);
        }
      }
    }

    computeLegs();

    return () => {
      isCancelled = true;
    };
  }, [day.activities, selectedMode, trip?.destination, day.dayNumber]);


  return (
    <div className="space-y-space-md animate-in fade-in slide-in-from-right-2 duration-300">
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
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column: Map */}
        <div className="lg:col-span-7 xl:col-span-8 flex flex-col space-y-2">
          <div className="flex items-center justify-between px-1">
            <h3 className="text-sm font-bold text-on-surface flex items-center gap-2">
              <MapPin className="w-4 h-4 text-primary" />
              <span>Interactive Waypoints & Street Route Map</span>
            </h3>
            <span className="text-[11px] text-on-surface-variant font-medium">Click routes or markers to view details</span>
          </div>

          <div className="flex-1 min-h-[400px]">
            <DayMapView
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
        <div className="lg:col-span-5 xl:col-span-4 flex flex-col h-[500px] lg:h-auto max-h-[600px]">
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
      <div className="space-y-3 pt-2">
        <div className="flex items-center justify-between px-1">
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
