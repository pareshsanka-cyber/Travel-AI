import { SaveHeart } from '../motion/SaveHeart';
import React, { useState, useMemo } from 'react';
import {
  Sparkles,
  MapPin,
  Star,
  Compass,
  Search,
  X,
  Check,
  AlertCircle
} from 'lucide-react';
import { PlaceMemoryItem } from '../types';

interface AiPlacesMemoryPageProps {
  onGoToStudio?: () => void;
}

export const AiPlacesMemoryPage: React.FC<AiPlacesMemoryPageProps> = ({
  onGoToStudio,
}) => {
  const [selectedTag, setSelectedTag] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  const [savedPlaceIds, setSavedPlaceIds] = useState<Set<string>>(
    () => new Set(['p-cavatina', 'p-thalassa', 'p-bom-jesus', 'p-fontainhas', 'p-morjim'])
  );

  const showToast = (message: string, type: 'success' | 'error' = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3500);
  };

  const places: PlaceMemoryItem[] = [
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

  const toggleSavePlace = (placeId: string, placeName: string) => {
    setSavedPlaceIds((prev) => {
      const next = new Set(prev);
      if (next.has(placeId)) {
        next.delete(placeId);
        showToast(`Removed "${placeName}" from memory.`, 'success');
      } else {
        next.add(placeId);
        showToast(`Saved "${placeName}" to memory!`, 'success');
      }
      return next;
    });
  };

  const filteredPlaces = useMemo(() => {
    return places.filter((p) => {
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
  }, [places, selectedTag, savedPlaceIds, searchQuery]);

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
              Example Places Library (Demo)
            </h1>
          </div>
          <p className="text-xs sm:text-sm text-on-surface-variant mt-1">
            Sample places for exploring the interface. Availability, prices, and opening hours are unverified.
          </p>
        </div>

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

      {/* Filter and Search Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3 rounded-2xl bg-surface-container border border-surface-container-highest/60">
        <div className="relative flex-1 max-w-md">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search places by name, location, or cuisine..."
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
            { id: 'all', label: 'All' },
            { id: 'dining', label: 'Dining' },
            { id: 'beach', label: 'Beach' },
            { id: 'heritage', label: 'Heritage' },
            { id: 'saved', label: `Saved (${savedPlaceIds.size})` },
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

      {/* Empty State when filter/search yields 0 results */}
      {filteredPlaces.length === 0 && (
        <div className="p-8 rounded-2xl bg-surface-container border border-surface-container-highest/60 text-center space-y-3">
          <p className="text-sm text-on-surface-variant">
            No remembered places found matching your search criteria.
          </p>
          <button
            type="button"
            onClick={() => {
              setSearchQuery('');
              setSelectedTag('all');
            }}
            className="text-xs text-primary hover:underline font-medium"
          >
            Clear Search & Filters
          </button>
        </div>
      )}

      {/* Places Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
        {filteredPlaces.map((place) => {
          const isSaved = savedPlaceIds.has(place.id);
          return (
            <div
              key={place.id}
              className="rounded-2xl bg-surface-container border border-surface-container-highest/60 p-5 shadow-lg space-y-3 hover:border-primary/40 motion-card flex flex-col justify-between"
            >
              <div className="space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <span className="text-[10px] uppercase font-bold tracking-wider text-primary">
                      {place.category}
                    </span>
                    <h3 className="text-base font-semibold text-on-surface mt-0.5">
                      {place.name}
                    </h3>
                  </div>
                  <button
                    type="button"
                    aria-pressed={isSaved}
                    aria-label={isSaved ? `Remove ${place.name} from saved` : `Save ${place.name} to memory`}
                    onClick={() => toggleSavePlace(place.id, place.name)}
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

                <div className="flex items-center gap-2 text-xs text-on-surface-variant">
                  <div className="flex items-center gap-1">
                    <MapPin className="w-3.5 h-3.5 text-primary" />
                    <span>{place.location}</span>
                  </div>
                  <span>•</span>
                  <div className="flex items-center gap-1 text-tertiary font-semibold">
                    <Star className="w-3.5 h-3.5 fill-tertiary" />
                    <span>{place.rating}</span>
                  </div>
                  <span>•</span>
                  <span className="text-outline">{place.price}</span>
                </div>

                <p className="text-xs text-on-surface-variant leading-relaxed">
                  {place.note}
                </p>
              </div>

              <div className="pt-2 border-t border-surface-container-high/40 flex items-center justify-between text-xs">
                <span className="text-outline text-[11px]">Demo reference; request itinerary changes in Planner Studio.</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
