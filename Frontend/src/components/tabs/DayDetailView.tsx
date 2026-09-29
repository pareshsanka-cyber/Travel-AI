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

// Accurate place-specific high-resolution photography catalog
const VENUE_IMAGE_MAP: Array<{ keywords: string[]; url: string }> = [
  // Delhi Landmarks
  { keywords: ['red fort', 'lal qila'], url: 'https://images.unsplash.com/photo-1598324789736-4861f89564a0?auto=format&fit=crop&w=1000&q=80' },
  { keywords: ['qutub minar', 'qutb'], url: 'https://images.unsplash.com/photo-1548013146-72479768bada?auto=format&fit=crop&w=1000&q=80' },
  { keywords: ['india gate'], url: 'https://images.unsplash.com/photo-1587474260584-136574528ed5?auto=format&fit=crop&w=1000&q=80' },
  { keywords: ['humayun'], url: 'https://images.unsplash.com/photo-1597040663342-45b6af3d91a5?auto=format&fit=crop&w=1000&q=80' },
  { keywords: ['lotus temple', 'bahai'], url: 'https://images.unsplash.com/photo-1576487248805-cf45f6bcc67f?auto=format&fit=crop&w=1000&q=80' },
  
  // Agra Landmarks
  { keywords: ['taj mahal'], url: 'https://images.unsplash.com/photo-1564507592333-c60657eea523?auto=format&fit=crop&w=1000&q=80' },
  { keywords: ['agra fort'], url: 'https://images.unsplash.com/photo-1592635196078-9fdc757f27f4?auto=format&fit=crop&w=1000&q=80' },
  { keywords: ['fatehpur sikri', 'buland darwaza'], url: 'https://images.unsplash.com/photo-1605649487212-47bdab064df8?auto=format&fit=crop&w=1000&q=80' },
  { keywords: ['mehtab bagh'], url: 'https://images.unsplash.com/photo-1585136917195-9b2f6fb39e44?auto=format&fit=crop&w=1000&q=80' },

  // Jaipur Landmarks
  { keywords: ['amber', 'amer fort', 'amer palace'], url: 'https://images.unsplash.com/photo-1599661046289-e31897846e41?auto=format&fit=crop&w=1000&q=80' },
  { keywords: ['hawa mahal'], url: 'https://images.unsplash.com/photo-1609137144822-1d54f85e43a9?auto=format&fit=crop&w=1000&q=80' },
  { keywords: ['city palace jaipur', 'city palace'], url: 'https://images.unsplash.com/photo-1599661046827-dacff0c0f09a?auto=format&fit=crop&w=1000&q=80' },
  { keywords: ['jantar mantar'], url: 'https://images.unsplash.com/photo-1622303535976-13a693b4ceb8?auto=format&fit=crop&w=1000&q=80' },

  // Goa Landmarks
  { keywords: ['aguada'], url: 'https://images.unsplash.com/photo-1512343879784-a960bf40e7f2?auto=format&fit=crop&w=1000&q=80' },
  { keywords: ['bom jesus', 'basilica'], url: 'https://images.unsplash.com/photo-1588416936097-41850ab3d86d?auto=format&fit=crop&w=1000&q=80' },
  { keywords: ['chapora'], url: 'https://images.unsplash.com/photo-1587922546307-776227941871?auto=format&fit=crop&w=1000&q=80' },
  { keywords: ['calangute', 'baga', 'beach'], url: 'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&w=1000&q=80' },

  // Mumbai Landmarks
  { keywords: ['gateway of india'], url: 'https://images.unsplash.com/photo-1570168007204-dfb528c6958f?auto=format&fit=crop&w=1000&q=80' },
  { keywords: ['marine drive'], url: 'https://images.unsplash.com/photo-1566552881560-0be862a7c445?auto=format&fit=crop&w=1000&q=80' },
  { keywords: ['elephanta'], url: 'https://images.unsplash.com/photo-1588416936097-41850ab3d86d?auto=format&fit=crop&w=1000&q=80' },

  // Dining & Restaurants
  { keywords: ['karim', 'mughlai', 'kebab'], url: 'https://images.unsplash.com/photo-1599488615731-7e5c2823ff28?auto=format&fit=crop&w=1000&q=80' },
  { keywords: ['bukhara', 'tandoori', 'dal bukhara'], url: 'https://images.unsplash.com/photo-1585937421612-70a008356fbe?auto=format&fit=crop&w=1000&q=80' },
  { keywords: ['indian accent', 'bistro', 'haute', 'gourmet'], url: 'https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?auto=format&fit=crop&w=1000&q=80' },
  { keywords: ['saravana', 'dosa', 'south indian', 'idli'], url: 'https://images.unsplash.com/photo-1668236543090-82eba5ee5976?auto=format&fit=crop&w=1000&q=80' },
  { keywords: ['gulati', 'butter chicken', 'curry'], url: 'https://images.unsplash.com/photo-1588166524941-3bf61a9c41db?auto=format&fit=crop&w=1000&q=80' },
  { keywords: ['fisherman', 'seafood', 'fish curry', 'crab'], url: 'https://images.unsplash.com/photo-1534422298391-e4f8c172dddb?auto=format&fit=crop&w=1000&q=80' },
  { keywords: ['1135 ad', 'thali', 'handi', 'laal maas', 'rajasthani'], url: 'https://images.unsplash.com/photo-1610057099443-fde8c4d50f91?auto=format&fit=crop&w=1000&q=80' },
  { keywords: ['traditional food', 'culinary', 'restaurant', 'food spot', 'cafe', 'bistro'], url: 'https://images.unsplash.com/photo-1555396273-367ea4eb4db5?auto=format&fit=crop&w=1000&q=80' },

  // Luxury Accommodations & Hotels
  { keywords: ['pavilion', 'de pavilion'], url: 'https://images.unsplash.com/photo-1590490360182-c33d57733427?auto=format&fit=crop&w=1000&q=80' },
  { keywords: ['imperial', 'itc maurya', 'the leela', 'luxury hotel'], url: 'https://images.unsplash.com/photo-1566073771259-6a8506099945?auto=format&fit=crop&w=1000&q=80' },
  { keywords: ['taj mahal hotel', 'taj hotel', 'taj resort'], url: 'https://images.unsplash.com/photo-1582719478250-c89cae4dc85b?auto=format&fit=crop&w=1000&q=80' },
  { keywords: ['resort', 'beachfront', 'pool'], url: 'https://images.unsplash.com/photo-1540555700478-4be289fbecef?auto=format&fit=crop&w=1000&q=80' },
  { keywords: ['hotel', 'check-in', 'stay', 'suite', 'boutique'], url: 'https://images.unsplash.com/photo-1578683010236-d716f9a3f461?auto=format&fit=crop&w=1000&q=80' },
];

export function resolvePlaceImage(act: ActivitySegment, destination?: string): string {
  // 1. Return real-time API thumbnail if available
  if (act.thumbnail && act.thumbnail.startsWith('http')) {
    return act.thumbnail;
  }

  // 2. Match exact place name or keywords
  const titleLower = (act.title || '').toLowerCase();
  const descLower = (act.description || '').toLowerCase();
  const locLower = (act.location || '').toLowerCase();
  const combined = `${titleLower} ${descLower} ${locLower}`;

  for (const item of VENUE_IMAGE_MAP) {
    if (item.keywords.some((kw) => combined.includes(kw))) {
      return item.url;
    }
  }

  // 3. Destination-aware fallback
  const destLower = (destination || '').toLowerCase();
  if (destLower.includes('delhi')) {
    return act.timeOfDay === 'Morning' 
      ? 'https://images.unsplash.com/photo-1598324789736-4861f89564a0?auto=format&fit=crop&w=1000&q=80'
      : act.timeOfDay === 'Afternoon'
      ? 'https://images.unsplash.com/photo-1585937421612-70a008356fbe?auto=format&fit=crop&w=1000&q=80'
      : 'https://images.unsplash.com/photo-1566073771259-6a8506099945?auto=format&fit=crop&w=1000&q=80';
  }

  if (destLower.includes('agra')) {
    return act.timeOfDay === 'Morning'
      ? 'https://images.unsplash.com/photo-1564507592333-c60657eea523?auto=format&fit=crop&w=1000&q=80'
      : 'https://images.unsplash.com/photo-1585937421612-70a008356fbe?auto=format&fit=crop&w=1000&q=80';
  }

  if (destLower.includes('jaipur')) {
    return act.timeOfDay === 'Morning'
      ? 'https://images.unsplash.com/photo-1609137144822-1d54f85e43a9?auto=format&fit=crop&w=1000&q=80'
      : 'https://images.unsplash.com/photo-1610057099443-fde8c4d50f91?auto=format&fit=crop&w=1000&q=80';
  }

  if (destLower.includes('goa')) {
    return act.timeOfDay === 'Morning'
      ? 'https://images.unsplash.com/photo-1512343879784-a960bf40e7f2?auto=format&fit=crop&w=1000&q=80'
      : 'https://images.unsplash.com/photo-1534422298391-e4f8c172dddb?auto=format&fit=crop&w=1000&q=80';
  }

  // 4. Default high-res travel fallback
  return act.timeOfDay === 'Morning'
    ? 'https://images.unsplash.com/photo-1469854523086-cc02fe5d8800?auto=format&fit=crop&w=1000&q=80'
    : act.timeOfDay === 'Afternoon'
    ? 'https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?auto=format&fit=crop&w=1000&q=80'
    : 'https://images.unsplash.com/photo-1566073771259-6a8506099945?auto=format&fit=crop&w=1000&q=80';
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

  const imageUrl = resolvePlaceImage(act, destination);
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
      {/* Real-time Place Image Banner */}
      <div className="relative md:w-72 h-52 md:h-auto flex-shrink-0 overflow-hidden">
        <img
          src={imageUrl}
          alt={act.title}
          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
          loading="lazy"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent md:hidden" />
        
        {/* Time Badge Overlay */}
        <div className="absolute top-3 left-3 flex items-center gap-1.5 px-3 py-1 rounded-full bg-black/60 backdrop-blur-md text-white text-xs font-semibold border border-white/20 shadow-sm">
          {typeIcon}
          <span>{act.timeOfDay} • {act.time}</span>
        </div>

        {/* Status Badge Overlay on Image (Mobile) */}
        {act.operatingStatus && (
          <div className="absolute bottom-3 left-3 md:hidden">
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
