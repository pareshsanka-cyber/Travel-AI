import { SaveHeart } from '../motion/SaveHeart';
import React, { useState, useMemo, useEffect } from 'react';
import {
  Sparkles,
  MapPin,
  Star,
  Compass,
  Search,
  X,
  Check,
  AlertCircle,
  ExternalLink,
  CalendarCheck
} from 'lucide-react';
import { PlaceMemoryItem, TripSummary, ItineraryDay } from '../types';

interface AiPlacesMemoryPageProps {
  onGoToStudio?: () => void;
  trip?: TripSummary | null;
  activeTrip?: any;
  days?: ItineraryDay[];
}

const SAVED_IDS_STORAGE_KEY = 'TRAVELAI_SAVED_PLACE_IDS';
const SAVED_ITEMS_STORAGE_KEY = 'TRAVELAI_SAVED_PLACES_STORE';

const SAMPLE_DEMO_PLACES: PlaceMemoryItem[] = [
  {
    id: 'p-cavatina',
    name: 'Cavatina by Chef Avinash Martins',
    category: 'Dining & Gastronomy',
    tag: 'dining',
    location: 'Benaulim, South Goa',
    rating: 4.9,
    note: 'Reimagined contemporary Goan culinary tasting menu with smoked pork and stuffed squid.',
    price: '₹₹₹₹',
  },
  {
    id: 'p-thalassa',
    name: 'Thalassa Greek Taverna',
    category: 'Sunset Beach Club',
    tag: 'beach',
    location: 'Ozran Beach, Vagator',
    rating: 4.8,
    note: 'Cliffside sunset panoramic lounge overlooking the rocky Arabian Sea shores.',
    price: '₹₹₹',
  },
  {
    id: 'p-bom-jesus',
    name: 'Basilica of Bom Jesus',
    category: 'UNESCO Heritage Monument',
    tag: 'heritage',
    location: 'Old Goa',
    rating: 4.9,
    note: '16th century Jesuit architecture holding mortal relics of St. Francis Xavier.',
    price: 'Free Entry',
  },
  {
    id: 'p-fontainhas',
    name: 'Fontainhas Latin Quarter',
    category: 'Colonial Architecture Walking Tour',
    tag: 'heritage',
    location: 'Panaji',
    rating: 4.8,
    note: 'Pastel yellow and cobalt blue Portuguese villas, tiled roofs, and antique bakeries.',
    price: 'Self-guided',
  },
  {
    id: 'p-morjim',
    name: 'Morjim Turtle Sanctuary Beach',
    category: 'Pristine Eco Sanctuary',
    tag: 'beach',
    location: 'Morjim, North Goa',
    rating: 4.7,
    note: 'Calm waters, nesting ground of Olive Ridley sea turtles, and tranquil shoreline yoga.',
    price: 'Free Entry',
  },
];

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

function mapToTag(category = '', name = '', description = ''): string {
  const text = `${category} ${name} ${description}`.toLowerCase();
  if (text.includes('food') || text.includes('restaurant') || text.includes('dining') || text.includes('cafe') || text.includes('café') || text.includes('culinary')) return 'dining';
  if (text.includes('beach') || text.includes('coast') || text.includes('sea') || text.includes('shore')) return 'beach';
  if (text.includes('museum') || text.includes('fort') || text.includes('palace') || text.includes('temple') || text.includes('church') || text.includes('heritage') || text.includes('monument') || text.includes('unesco') || text.includes('historic')) return 'heritage';
  if (text.includes('nature') || text.includes('park') || text.includes('sanctuary') || text.includes('lake') || text.includes('waterfall') || text.includes('valley') || text.includes('hills') || text.includes('wildlife') || text.includes('forest')) return 'nature';
  if (text.includes('trek') || text.includes('hike') || text.includes('adventure') || text.includes('safari') || text.includes('camping')) return 'adventure';
  if (text.includes('market') || text.includes('bazaar') || text.includes('shopping') || text.includes('mall') || text.includes('souvenir')) return 'shopping';
  return 'culture';
}

export const AiPlacesMemoryPage: React.FC<AiPlacesMemoryPageProps> = ({
  onGoToStudio,
  trip,
  activeTrip,
  days = [],
}) => {
  const [selectedTag, setSelectedTag] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [showSamplePlaces, setShowSamplePlaces] = useState<boolean>(false);

  // Load saved place IDs from localStorage (defaults to empty, NOT the hardcoded 5 Goa places)
  const [savedPlaceIds, setSavedPlaceIds] = useState<Set<string>>(() => {
    try {
      const raw = localStorage.getItem(SAVED_IDS_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) return new Set(parsed);
      }
    } catch {}
    return new Set<string>();
  });

  // Load saved place items from localStorage
  const [savedPlacesStore, setSavedPlacesStore] = useState<PlaceMemoryItem[]>(() => {
    try {
      const raw = localStorage.getItem(SAVED_ITEMS_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) return parsed;
      }
    } catch {}
    return [];
  });

  const showToast = (message: string, type: 'success' | 'error' = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3500);
  };

  const destination = trip?.destination || activeTrip?.destination || '';
  const destName = destination ? destination.split(',')[0].trim() : '';

  // Extract dynamic places from the active trip (attractions, restaurants, scheduled stops)
  const tripPlaces = useMemo<PlaceMemoryItem[]>(() => {
    const items: PlaceMemoryItem[] = [];
    const seenNames = new Set<string>();

    const addPlace = (raw: any, defaultCategory: string) => {
      const name = raw.name || raw.title;
      if (!name || typeof name !== 'string' || name.trim().length < 2) return;
      const cleanName = name.trim();
      const lower = cleanName.toLowerCase();
      if (seenNames.has(lower)) return;
      seenNames.add(lower);

      const cat = raw.category || raw.cuisine || defaultCategory;
      const desc = raw.description || raw.note || raw.popular_dish || `Recommended place to visit in ${destName || 'your destination'}.`;
      const tag = mapToTag(cat, cleanName, desc);

      let price = raw.price_range || raw.price || 'Free Entry';
      if (raw.entrance_fee !== undefined && raw.entrance_fee !== null) {
        const fee = Number(raw.entrance_fee);
        price = fee === 0 ? 'Free Entry' : `₹${fee}`;
      }

      let ratingNum = 4.5;
      if (raw.rating !== undefined && raw.rating !== null) {
        const parsed = parseFloat(String(raw.rating));
        if (!isNaN(parsed) && parsed > 0) ratingNum = parsed;
      }

      const pLat = typeof raw.lat === 'number' ? raw.lat : (raw.latitude ? parseFloat(String(raw.latitude)) : undefined);
      const pLon = typeof raw.lon === 'number' ? raw.lon : (raw.longitude ? parseFloat(String(raw.longitude)) : undefined);

      items.push({
        id: String(raw.id || raw.place_id || `place-${slugify(cleanName)}`),
        name: cleanName,
        category: cat,
        tag,
        location: raw.address || raw.location || (destName ? `${destName}, India` : 'India'),
        rating: ratingNum,
        note: desc,
        price,
        imageUrl: raw.image_url || raw.imageUrl,
        lat: pLat,
        lon: pLon,
        isScheduled: false,
      });
    };

    // 1. Discovered Attractions from Trip
    const rawAttractions = activeTrip?.attractions || trip?.routeDetails?.attractions;
    if (Array.isArray(rawAttractions)) {
      rawAttractions.forEach((a: any) => addPlace(a, 'Historic Monument & Sights'));
    }

    // 2. Discovered Restaurants from Trip
    const rawRestaurants = activeTrip?.restaurants || trip?.routeDetails?.restaurants;
    if (Array.isArray(rawRestaurants)) {
      rawRestaurants.forEach((r: any) => addPlace(r, 'Dining & Gastronomy'));
    }

    // 3. Stops from day-by-day itinerary
    if (Array.isArray(days) && days.length > 0) {
      days.forEach((day) => {
        (day.activities || []).forEach((act) => {
          if (act.type !== 'airport' && act.type !== 'hotel') {
            addPlace(
              {
                id: act.id,
                name: act.title,
                category: act.type === 'restaurant' ? 'Dining & Gastronomy' : 'Sightseeing Attraction',
                description: act.description,
                location: act.location,
                lat: act.lat,
                lon: act.lon,
                rating: act.rating,
                price: act.price,
              },
              'Itinerary Stop'
            );
          }
        });
      });
    }

    // Flag activities currently scheduled in the itinerary
    const scheduledTitles = new Set(
      days.flatMap((d) => (d.activities || []).map((a) => (a.title || '').toLowerCase().trim()))
    );
    items.forEach((item) => {
      if (scheduledTitles.has(item.name.toLowerCase().trim())) {
        item.isScheduled = true;
      }
    });

    return items;
  }, [activeTrip, trip, days, destName]);

  // Combined master list:
  // If active trip has places, use trip places + any saved favorites that aren't already included
  // If no active trip or trip has 0 places, use savedPlacesStore, or sample places if explicitly toggled
  const allPlaces = useMemo<PlaceMemoryItem[]>(() => {
    if (tripPlaces.length > 0) {
      const existingNames = new Set(tripPlaces.map((p) => p.name.toLowerCase()));
      const extraSaved = savedPlacesStore.filter((p) => !existingNames.has(p.name.toLowerCase()));
      return [...tripPlaces, ...extraSaved];
    }
    if (savedPlacesStore.length > 0) {
      return savedPlacesStore;
    }
    if (showSamplePlaces) {
      return SAMPLE_DEMO_PLACES;
    }
    return [];
  }, [tripPlaces, savedPlacesStore, showSamplePlaces]);

  // Toggle saving a place to memory (persists to localStorage)
  const toggleSavePlace = (place: PlaceMemoryItem) => {
    const placeId = place.id;
    const isCurrentlySaved = savedPlaceIds.has(placeId);

    const nextIds = new Set(savedPlaceIds);
    let nextStore = [...savedPlacesStore];

    if (isCurrentlySaved) {
      nextIds.delete(placeId);
      nextStore = nextStore.filter((p) => p.id !== placeId && p.name.toLowerCase() !== place.name.toLowerCase());
      showToast(`Removed "${place.name}" from saved memory.`, 'success');
    } else {
      nextIds.add(placeId);
      if (!nextStore.some((p) => p.id === placeId || p.name.toLowerCase() === place.name.toLowerCase())) {
        nextStore.push(place);
      }
      showToast(`Saved "${place.name}" to your memory!`, 'success');
    }

    setSavedPlaceIds(nextIds);
    setSavedPlacesStore(nextStore);

    try {
      localStorage.setItem(SAVED_IDS_STORAGE_KEY, JSON.stringify(Array.from(nextIds)));
      localStorage.setItem(SAVED_ITEMS_STORAGE_KEY, JSON.stringify(nextStore));
    } catch {}
  };

  // Filter and search
  const filteredPlaces = useMemo(() => {
    return allPlaces.filter((p) => {
      if (selectedTag === 'saved' && !savedPlaceIds.has(p.id)) return false;
      if (selectedTag !== 'all' && selectedTag !== 'saved' && p.tag !== selectedTag) return false;

      if (!searchQuery.trim()) return true;
      const q = searchQuery.toLowerCase();
      return (
        p.name.toLowerCase().includes(q) ||
        p.location.toLowerCase().includes(q) ||
        p.category.toLowerCase().includes(q) ||
        p.note.toLowerCase().includes(q)
      );
    });
  }, [allPlaces, selectedTag, savedPlaceIds, searchQuery]);

  // Available tag counts
  const tagCounts = useMemo(() => {
    const counts: Record<string, number> = { all: allPlaces.length, saved: 0 };
    allPlaces.forEach((p) => {
      if (savedPlaceIds.has(p.id)) counts.saved++;
      counts[p.tag] = (counts[p.tag] || 0) + 1;
    });
    return counts;
  }, [allPlaces, savedPlaceIds]);

  const hasTrip = Boolean(trip || activeTrip);

  return (
    <div className="w-full min-h-[calc(100vh-4rem)] p-4 lg:p-8 space-y-6 relative">
      {/* Toast Notification */}
      {toast && (
        <div
          className={`fixed top-20 right-6 z-50 px-4 py-2.5 rounded-xl text-xs font-semibold shadow-2xl flex items-center gap-2 animate-in fade-in slide-in-from-top-4 ${
            toast.type === 'error'
              ? 'bg-error text-on-error'
              : 'bg-primary text-on-primary'
          }`}
        >
          {toast.type === 'error' ? <AlertCircle className="w-4 h-4" /> : <Check className="w-4 h-4" />}
          <span>{toast.message}</span>
        </div>
      )}

      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="p-2 rounded-xl bg-primary/10 text-primary">
              <Sparkles className="w-5 h-5" />
            </span>
            <h1 className="text-xl sm:text-2xl font-bold text-on-surface">
              {destName ? `Places & Memory — ${destName}` : 'Places & Saved Memory'}
            </h1>
          </div>
          <p className="text-xs sm:text-sm text-on-surface-variant mt-1">
            {destName
              ? `Verified attractions, local dining, and saved favorites for your trip to ${destination}.`
              : 'Your saved attractions, restaurants, and favorite places across your travels.'}
          </p>
        </div>

        <div className="flex items-center gap-2">
          {onGoToStudio && (
            <button
              type="button"
              onClick={onGoToStudio}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-primary text-on-primary text-xs sm:text-sm font-semibold hover:bg-primary-fixed transition-colors shadow-md self-start sm:self-auto"
            >
              <Compass className="w-4 h-4" />
              <span>Open in Planner Studio</span>
            </button>
          )}
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
            placeholder={`Search ${destName || 'places'} by name, location, or cuisine...`}
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

        {/* Filter Pills */}
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-xs text-on-surface-variant mr-1">Filter:</span>
          {[
            { id: 'all', label: `All (${tagCounts.all || 0})` },
            { id: 'saved', label: `Saved (${tagCounts.saved || 0})` },
            ...(tagCounts.dining ? [{ id: 'dining', label: `Dining (${tagCounts.dining})` }] : []),
            ...(tagCounts.heritage ? [{ id: 'heritage', label: `Heritage (${tagCounts.heritage})` }] : []),
            ...(tagCounts.nature ? [{ id: 'nature', label: `Nature (${tagCounts.nature})` }] : []),
            ...(tagCounts.beach ? [{ id: 'beach', label: `Beach (${tagCounts.beach})` }] : []),
            ...(tagCounts.culture ? [{ id: 'culture', label: `Culture (${tagCounts.culture})` }] : []),
          ].map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setSelectedTag(item.id)}
              className={`px-3 py-1 rounded-full text-xs font-semibold transition-colors ${
                selectedTag === item.id
                  ? 'bg-primary text-on-primary shadow-sm'
                  : 'bg-surface-container-high hover:bg-surface-bright text-on-surface-variant'
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      {/* Empty State when no places exist */}
      {filteredPlaces.length === 0 && (
        <div className="p-12 rounded-2xl bg-surface-container border border-surface-container-highest/60 text-center space-y-4">
          <Sparkles className="w-8 h-8 text-primary mx-auto opacity-70" />
          <div className="space-y-1">
            <h3 className="text-base font-semibold text-on-surface">
              {searchQuery
                ? 'No places matching your search'
                : selectedTag === 'saved'
                ? 'No saved favorites yet'
                : `No places recorded yet for ${destName || 'this destination'}`}
            </h3>
            <p className="text-xs sm:text-sm text-on-surface-variant max-w-md mx-auto">
              {selectedTag === 'saved'
                ? 'Click the heart icon on any attraction, restaurant, or recommendation to save it to your memory library.'
                : 'Chat with TravelAI in Planner Studio or generate an itinerary to discover verified attractions and restaurants.'}
            </p>
          </div>

          <div className="flex items-center justify-center gap-3 pt-2">
            {searchQuery || selectedTag !== 'all' ? (
              <button
                type="button"
                onClick={() => {
                  setSearchQuery('');
                  setSelectedTag('all');
                }}
                className="px-4 py-2 rounded-xl bg-surface-container-high hover:bg-surface-bright text-xs font-semibold text-primary transition-colors"
              >
                Clear Search & Filters
              </button>
            ) : null}

            {onGoToStudio && (
              <button
                type="button"
                onClick={onGoToStudio}
                className="px-4 py-2 rounded-xl bg-primary text-on-primary text-xs font-semibold hover:bg-primary-fixed transition-colors shadow-sm"
              >
                Explore in Planner Studio
              </button>
            )}

            {!hasTrip && !showSamplePlaces && (
              <button
                type="button"
                onClick={() => setShowSamplePlaces(true)}
                className="px-4 py-2 rounded-xl bg-surface-container-high hover:bg-surface-bright text-xs font-semibold text-on-surface transition-colors"
              >
                Show Sample Places
              </button>
            )}
          </div>
        </div>
      )}

      {/* Places Cards Grid */}
      {filteredPlaces.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
          {filteredPlaces.map((place) => {
            const isSaved = savedPlaceIds.has(place.id);
            const mapsQuery = place.lat && place.lon
              ? `${place.lat},${place.lon}`
              : encodeURIComponent(`${place.name} ${place.location}`);
            const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${mapsQuery}`;

            return (
              <div
                key={place.id}
                className="rounded-2xl bg-surface-container border border-surface-container-highest/60 p-5 shadow-lg space-y-3 hover:border-primary/40 motion-card flex flex-col justify-between"
              >
                <div className="space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[10px] uppercase font-bold tracking-wider text-primary">
                          {place.category}
                        </span>
                        {place.isScheduled && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-tertiary/15 text-tertiary">
                            <CalendarCheck className="w-3 h-3" />
                            <span>In Itinerary</span>
                          </span>
                        )}
                      </div>
                      <h3 className="text-base font-semibold text-on-surface">
                        {place.name}
                      </h3>
                    </div>

                    <button
                      type="button"
                      aria-pressed={isSaved}
                      aria-label={isSaved ? `Remove ${place.name} from saved` : `Save ${place.name} to memory`}
                      onClick={() => toggleSavePlace(place)}
                      className={`p-1.5 rounded-lg transition-colors ${
                        isSaved
                          ? 'text-tertiary bg-tertiary/10 hover:bg-tertiary/20'
                          : 'text-on-surface-variant hover:text-tertiary bg-surface-container-high'
                      }`}
                      title={isSaved ? 'Saved to Memory' : 'Save to Memory'}
                    >
                      <SaveHeart saved={isSaved} />
                    </button>
                  </div>

                  <div className="flex items-center gap-2 text-xs text-on-surface-variant flex-wrap">
                    <div className="flex items-center gap-1">
                      <MapPin className="w-3.5 h-3.5 text-primary flex-shrink-0" />
                      <span className="truncate max-w-[180px]">{place.location}</span>
                    </div>
                    <span>•</span>
                    <div className="flex items-center gap-1 text-tertiary font-semibold">
                      <Star className="w-3.5 h-3.5 fill-tertiary" />
                      <span>{typeof place.rating === 'number' ? place.rating.toFixed(1) : place.rating}</span>
                    </div>
                    <span>•</span>
                    <span className="text-outline">{place.price}</span>
                  </div>

                  <p className="text-xs text-on-surface-variant leading-relaxed">
                    {place.note}
                  </p>
                </div>

                <div className="pt-3 border-t border-surface-container-high/40 flex items-center justify-between text-xs">
                  <a
                    href={mapsUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-primary hover:underline font-medium text-[11px]"
                  >
                    <span>Google Maps</span>
                    <ExternalLink className="w-3 h-3" />
                  </a>

                  {onGoToStudio && (
                    <button
                      type="button"
                      onClick={onGoToStudio}
                      className="text-on-surface-variant hover:text-primary transition-colors text-[11px] font-medium"
                    >
                      {place.isScheduled ? 'View in Route →' : 'Plan with AI →'}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
