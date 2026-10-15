import { MotionImage, TripCardMotion } from '../motion/SecondaryMotion';
import React, { useState, useMemo, useRef } from 'react';
import {
  CalendarDays,
  MapPin,
  ArrowRight,
  Clock,
  Wallet,
  Users,
  Compass,
  Search,
  Plus,
  X,
  Check,
  Loader2,
  Trash2,
} from 'lucide-react';
import { TripSummary, SavedTripSnippet } from '../types';
import { parseMetadataFromUserMessage } from '../services/api';

interface ItineraryHubPageProps {
  currentTrip: TripSummary | null;
  availableTrips: any[];
  savedTrips: SavedTripSnippet[];
  isLoading?: boolean;
  onOpenTrip: (tripId: string) => Promise<boolean> | boolean;
  onGoToStudio: () => void;
  onNewTrip?: () => void;
  onDeleteTrip?: (tripId: string, e: React.MouseEvent) => void;
  isCreatingTrip?: boolean;
}

export const ItineraryHubPage: React.FC<ItineraryHubPageProps> = ({
  currentTrip,
  availableTrips = [],
  savedTrips,
  isLoading = false,
  onOpenTrip,
  onGoToStudio,
  onNewTrip,
  onDeleteTrip,
  isCreatingTrip = false,
}) => {
  const revealed = useRef(new Set<string>());
  const [searchQuery, setSearchQuery] = useState('');
  const [filterMode, setFilterMode] = useState<'all' | 'active' | 'archived'>('all');

  const filteredTrips = useMemo(() => {
    return availableTrips.filter((item: any) => {
      const tripId = item.id || item._id;
      const isSelected = currentTrip?.id === tripId;

      if (filterMode === 'active' && !isSelected) return false;
      if (filterMode === 'archived' && isSelected) return false;

      if (!searchQuery.trim()) return true;
      const q = searchQuery.toLowerCase();
      const title = (item.title || '').toLowerCase();
      const destination = (item.destination || '').toLowerCase();
      const preferences = (item.preferences || '').toLowerCase();

      return title.includes(q) || destination.includes(q) || preferences.includes(q);
    });
  }, [availableTrips, currentTrip, filterMode, searchQuery]);

  return (
    <div className="w-full min-h-[calc(100vh-4rem)] p-4 lg:p-8 space-y-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="p-2 rounded-xl bg-primary/10 text-primary">
              <CalendarDays className="w-5 h-5" />
            </span>
            <h1 className="text-xl sm:text-2xl font-bold text-on-surface">
              My trips
            </h1>
          </div>
          <p className="text-xs sm:text-sm text-on-surface-variant mt-1">
            Your saved itineraries, ready to review or continue.
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {onNewTrip && (
            <button
              type="button"
              onClick={onNewTrip}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-surface-container-high hover:bg-surface-bright text-on-surface text-xs sm:text-sm font-semibold transition-colors border border-surface-container-highest/60 cursor-pointer shadow-sm"
              title="Open New Chat & Plan Trip"
            >
              <Plus className="w-4 h-4 text-primary" />
              <span>Create New Trip</span>
            </button>
          )}

          <button
            type="button"
            onClick={onGoToStudio}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-primary text-on-primary text-xs sm:text-sm font-semibold hover:bg-primary-fixed transition-colors shadow-md self-start sm:self-auto"
          >
            <Compass className="w-4 h-4" />
            <span>{currentTrip ? 'Open current trip' : 'Start planning'}</span>
          </button>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3 rounded-2xl bg-surface-container border border-surface-container-highest/60">
        <div className="relative flex-1 max-w-md">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by destination or title..."
            className="w-full pl-9 pr-8 py-1.5 bg-surface-container-lowest text-xs sm:text-sm rounded-xl border border-surface-container-highest/40 focus:outline-none focus:border-primary text-on-surface"
          />
          {searchQuery && (
            <button
              type="button"
              aria-label="Clear search"
              onClick={() => setSearchQuery('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-on-surface-variant hover:text-on-surface"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-xs text-on-surface-variant mr-1">Filter:</span>
          {(['all', 'active', 'archived'] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => setFilterMode(mode)}
              className={`px-3 py-1 rounded-full text-xs font-medium transition-colors capitalize ${
                filterMode === mode
                  ? 'bg-primary text-on-primary'
                  : 'bg-surface-container-high text-on-surface-variant hover:text-on-surface'
              }`}
            >
              {mode}
            </button>
          ))}
          <span className="text-xs text-on-surface-variant ml-2">
            ({filteredTrips.length} {filteredTrips.length === 1 ? 'trip' : 'trips'})
          </span>
        </div>
      </div>

      {/* Skeleton Loading State while trips are being fetched */}
      {isLoading && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
          {[1, 2, 3].map((n) => (
            <div
              key={`skeleton-hub-${n}`}
              className="rounded-2xl bg-surface-container border border-surface-container-highest/40 overflow-hidden shadow-lg animate-pulse h-96 flex flex-col justify-between p-5 space-y-4"
            >
              <div className="h-44 rounded-xl bg-surface-container-high/60 w-full" />
              <div className="space-y-2">
                <div className="h-5 bg-surface-container-high/70 rounded-md w-3/4" />
                <div className="h-4 bg-surface-container-high/50 rounded-md w-1/2" />
              </div>
              <div className="h-10 bg-surface-container-high/60 rounded-xl w-full" />
            </div>
          ))}
        </div>
      )}

      {/* Empty State when no trips exist at all (and not loading) */}
      {!isLoading && availableTrips.length === 0 && (
        <div className="flex flex-col items-center justify-center p-12 rounded-2xl bg-surface-container border border-surface-container-highest/60 text-center space-y-4">
          <div className="w-14 h-14 rounded-2xl bg-primary/10 text-primary flex items-center justify-center">
            <Compass className="w-7 h-7" />
          </div>
          <div className="space-y-1">
            <h3 className="text-base font-semibold text-on-surface">No Saved Itineraries Found</h3>
            <p className="text-xs text-on-surface-variant max-w-sm">
              Plan a new trip to build your collection of saved itineraries.
            </p>
          </div>
          {onNewTrip && (
            <button
              type="button"
              onClick={onNewTrip}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-primary text-on-primary text-xs font-semibold hover:bg-primary-fixed transition-colors shadow-md cursor-pointer"
              title="Open New Chat & Plan Trip"
            >
              <Plus className="w-4 h-4" />
              <span>Create New Trip</span>
            </button>
          )}
        </div>
      )}

      {/* Empty State when search/filter yields 0 results */}
      {!isLoading && availableTrips.length > 0 && filteredTrips.length === 0 && (
        <div className="p-8 rounded-2xl bg-surface-container border border-surface-container-highest/60 text-center space-y-3">
          <p className="text-sm text-on-surface-variant">
            No itineraries found matching your search criteria.
          </p>
          <button
            type="button"
            onClick={() => {
              setSearchQuery('');
              setFilterMode('all');
            }}
            className="text-xs text-primary hover:underline font-medium"
          >
            Clear Search & Filters
          </button>
        </div>
      )}

      {/* Grid of Itineraries */}
      {!isLoading && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
        {filteredTrips.map((item: any, idx: number) => {
          const tripId = item.id || item._id;
          const isSelected = currentTrip?.id === tripId;
          const parsedMeta = parseMetadataFromUserMessage(item.user_message);
          const title = item.title || (item.destination ? `${item.destination} Curated Itinerary` : 'Bespoke Itinerary');
          const destination = item.destination || parsedMeta.destination || 'India';
          const daysNum = item.days || parsedMeta.days || 3;
          const nightsNum = Math.max(1, daysNum - 1);
          const duration = item.duration || `${daysNum} Days, ${nightsNum} ${nightsNum === 1 ? 'Night' : 'Nights'}`;
          const rawBudget = typeof item.budget === 'number'
            ? item.budget
            : (typeof item.travelContext?.budget === 'number'
              ? item.travelContext.budget
              : (typeof item.travel_context?.budget === 'number'
                ? item.travel_context.budget
                : (typeof parsedMeta.budget === 'number' ? parsedMeta.budget : null)));
          const currency = item.currency || item.travelContext?.currency || item.travel_context?.currency || 'INR';
          const currencySymbol = currency === 'USD' ? '$' : currency === 'EUR' ? '€' : '₹';
          const budget = rawBudget !== null
            ? `${currencySymbol}${rawBudget.toLocaleString()} Est. Budget`
            : (item.budgetEstimate || '₹50,000 Est. Budget');

          const travelersCount = item.travelers || item.travelersCount || item.travelContext?.travelers || item.travel_context?.travelers || parsedMeta.travelers || 2;
          const travelersLabel = `${travelersCount} ${travelersCount === 1 ? 'Traveler' : 'Travelers'}`;
          const travelStyle = item.travel_style || item.travelStyle || item.travelContext?.travel_style || item.travel_context?.travel_style;
          const budgetMode = item.budget_mode || item.budgetMode || item.travelContext?.budget_mode || item.travel_context?.budget_mode;
          const status = item.status || 'Planned';
          const highlight = item.routeHeadline
            || item.preferences
            || (item.planner_draft ? item.planner_draft.split('\n')[0].replace(/^#+\s*/, '') : 'Curated Luxury Route');
          const imageUrl = item.heroImageUrl || (
            item.destination?.includes('Tokyo')
              ? 'https://images.unsplash.com/photo-1503899036084-c55cdd92da26?auto=format&fit=crop&w=800&q=80'
              : item.destination?.includes('Jaipur')
              ? 'https://images.unsplash.com/photo-1477587458883-47145ed94245?auto=format&fit=crop&w=800&q=80'
              : 'https://lh3.googleusercontent.com/aida-public/AB6AXuBlx7gAJoMQBXDwbj6pcwTqIFcYOsmHvoW4FP-ompYmqI5sdLnZA_V_Vo7s2KaplYKZasc62M2PUG1oCM8TH0Z07k10P6QveYrXQL7OAzs_LtZujhGa5DgZj2B1Lt83FtvfbX5cf4OzbSPNc0HxZSxA0n70yRDsXRUzj3Cs3tyKLFvOticj1qWp-a5SvwUFFe5M7wTtu3leSHjY1VvKgmhcc0WV-OM1qDNk60-lJxEzj7UZUxDQDjkCFg'
          );

          return (
            <TripCardMotion
              id={tripId} index={idx} seen={revealed.current}
              key={tripId || `trip-${idx}`}
              className={`rounded-2xl bg-surface-container border overflow-hidden shadow-lg motion-card flex flex-col justify-between ${
                isSelected
                  ? 'border-primary ring-2 ring-primary/30'
                  : 'border-surface-container-highest/60 hover:border-primary/40'
              }`}
            >
              <div>
                <div className="h-44 relative overflow-hidden">
                  <MotionImage
                    src={imageUrl}
                    alt={title}
                    className="w-full h-full object-cover"
                    referrerPolicy="no-referrer"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-surface-container via-transparent to-transparent" />
                  <span className="absolute top-3 left-3 px-2.5 py-1 rounded-full bg-surface-container-lowest/80 backdrop-blur-md text-tertiary text-xs font-semibold border border-surface-container-highest/60">
                    {status}
                  </span>
                  <div className="absolute top-3 right-3 flex items-center gap-1.5 z-10">
                    {isSelected && (
                      <span className="px-2.5 py-1 rounded-full bg-primary text-on-primary text-[10px] font-bold uppercase tracking-wider shadow flex items-center gap-1">
                        <Check className="w-3 h-3" /> Active
                      </span>
                    )}
                    {onDeleteTrip && (
                      <button
                        type="button"
                        aria-label={`Delete trip ${title}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          onDeleteTrip(tripId, e);
                        }}
                        className="p-1.5 rounded-full bg-surface-container-lowest/80 backdrop-blur-md text-on-surface-variant hover:text-error hover:bg-error-container/80 transition-all cursor-pointer shadow-md border border-surface-container-highest/40"
                        title="Delete trip"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                  <span className="absolute bottom-3 left-3 flex items-center gap-1 text-xs text-on-surface font-medium">
                    <MapPin className="w-3.5 h-3.5 text-primary" />
                    <span>{destination}</span>
                  </span>
                </div>

                <div className="p-5 space-y-3">
                  <h3 className="text-base font-semibold text-on-surface">
                    {title}
                  </h3>
                  <p className="text-xs text-on-surface-variant leading-relaxed line-clamp-2">
                    {highlight}
                  </p>

                  <div className="flex flex-wrap items-center gap-2 pt-1 text-[11px] text-on-surface-variant font-medium">
                    <div className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-surface-container-high">
                      <Clock className="w-3 h-3 text-tertiary" />
                      <span>{duration}</span>
                    </div>
                    <div className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-surface-container-high">
                      <Wallet className="w-3 h-3 text-secondary" />
                      <span>{budget}</span>
                    </div>
                    <div className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-surface-container-high">
                      <Users className="w-3 h-3 text-outline" />
                      <span>{travelersLabel}</span>
                    </div>
                    {travelStyle && (
                      <div className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-surface-container-high">
                        <span className="text-on-surface-variant font-medium">Style:</span>
                        <span className="text-on-surface font-semibold capitalize">{travelStyle.toLowerCase()}</span>
                      </div>
                    )}
                    {budgetMode && (
                      <div className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-surface-container-high">
                        <span className="text-on-surface-variant font-medium">Mode:</span>
                        <span className="text-on-surface font-semibold capitalize">{budgetMode.toLowerCase()}</span>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              <div className="p-5 pt-0">
                <button
                  type="button"
                  onClick={async () => {
                    const success = await onOpenTrip(tripId);
                    if (success) {
                      onGoToStudio();
                    }
                  }}
                  className="w-full flex items-center justify-center gap-1.5 py-2 px-4 rounded-xl bg-surface-container-high hover:bg-primary hover:text-on-primary text-on-surface text-xs font-semibold transition-colors border border-surface-container-highest/60"
                >
                  <span>Open trip</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </TripCardMotion>
          );
        })}
        </div>
      )}
    </div>
  );
};
