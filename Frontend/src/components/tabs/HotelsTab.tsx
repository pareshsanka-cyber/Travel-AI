import React, { useState } from 'react';
import { MapPin, Star, Check } from 'lucide-react';
import { HotelOption } from '../../types';

interface HotelsTabProps {
  hotels: HotelOption[];
  nearbyHotels?: HotelOption[];
  onSelectHotel: (id: string) => void;
}

export const HotelsTab: React.FC<HotelsTabProps> = ({
  hotels,
  nearbyHotels = [],
  onSelectHotel,
}) => {
  const [expandedHotelId, setExpandedHotelId] = useState<string | null>(null);
  return (
    <div className="space-y-space-md animate-in fade-in duration-200">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        <div>
          <h2 className="text-base sm:text-lg font-semibold text-on-surface">
            Handpicked 5-Star Accommodations
          </h2>
          <p className="text-xs text-on-surface-variant">
            Filtered by luxury score, beachfront location, and user ratings &gt; 4.8
          </p>
        </div>
        <span className="px-3 py-1 rounded-full bg-tertiary/10 text-tertiary text-xs font-semibold self-start sm:self-auto border border-tertiary/20">
          {hotels.length} Matches
        </span>
      </div>

      {(!hotels || hotels.length === 0) ? (
        <div className="flex flex-col items-center justify-center p-12 rounded-2xl bg-surface-container border border-surface-container-highest/60 text-center space-y-3">
          <div className="w-12 h-12 rounded-xl bg-tertiary/10 text-tertiary flex items-center justify-center">
            <MapPin className="w-6 h-6" />
          </div>
          <h3 className="text-base font-semibold text-on-surface">No hotels yet</h3>
          <p className="text-xs text-on-surface-variant max-w-sm">
            No luxury accommodations have been allocated for this circuit. Ask TravelAI in Dispatch Studio to recommend hotels.
          </p>
        </div>
      ) : (
        hotels.map((hotel, idx) => {
          const isBooked = hotel.isBooked;
          return (
            <div
              key={hotel.id || `hotel-${idx}`}
              className={`rounded-xl p-space-md shadow-md grid grid-cols-1 md:grid-cols-12 gap-space-md items-center border transition-all ${
              isBooked
                ? 'bg-surface-container border-tertiary/40 ring-1 ring-tertiary/20'
                : 'bg-surface-container/70 border-surface-container-highest/40 hover:border-surface-container-highest opacity-85 hover:opacity-100'
            }`}
          >
            {/* Hotel Image with Review overlay */}
            <div className="md:col-span-4 h-48 rounded-lg overflow-hidden relative">
              <img
                src={hotel.imageUrl}
                alt={hotel.imageAlt}
                className="w-full h-full object-cover"
                referrerPolicy="no-referrer"
              />
              <span className="absolute top-2 left-2 px-2.5 py-1 rounded-full bg-surface-container-lowest/85 backdrop-blur-md text-tertiary text-[11px] font-semibold flex items-center gap-1 border border-surface-container-highest/60">
                <Star className="w-3.5 h-3.5 fill-tertiary text-tertiary" />
                <span>
                  {hotel.rating} ({hotel.reviewCount} Reviews)
                </span>
              </span>
            </div>

            {/* Hotel Information */}
            <div className="md:col-span-8 flex flex-col justify-between space-y-space-sm h-full">
              <div className="flex items-start justify-between gap-space-xs">
                <div>
                  <h3 className="text-base sm:text-lg font-bold text-on-surface">
                    {hotel.name}
                  </h3>
                  <div className="text-xs text-on-surface-variant flex items-center gap-1 mt-0.5">
                    <MapPin className="w-3.5 h-3.5 text-primary flex-shrink-0" />
                    <span>{hotel.location}</span>
                  </div>
                </div>

                {isBooked ? (
                  <span className="px-3 py-1 rounded-full bg-primary-container text-on-primary text-xs font-semibold whitespace-nowrap flex items-center gap-1">
                    <Check className="w-3.5 h-3.5" />
                    <span>Active Booking</span>
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => onSelectHotel(hotel.id)}
                    className="px-3 py-1 rounded-full bg-surface-container-high hover:bg-primary hover:text-on-primary text-on-surface text-xs font-medium transition-colors"
                  >
                    Switch Stay
                  </button>
                )}
              </div>

              {/* Feature Badges */}
              <div className="flex flex-wrap items-center gap-1.5 text-on-surface-variant text-xs">
                {hotel.features.map((feat, idx) => (
                  <span
                    key={`${hotel.id}-feat-${idx}-${feat}`}
                    className="px-2.5 py-1 rounded bg-surface-container-high border border-surface-container-highest/60 text-[11px]"
                  >
                    {feat}
                  </span>
                ))}
              </div>

              {/* Pricing & Actions */}
              <div className="flex items-center justify-between pt-2 border-t border-surface-container-high/40">
                <div>
                  <div className="text-lg font-bold text-tertiary">
                    ₹{hotel.pricePerNight.toLocaleString()}{' '}
                    <span className="text-xs text-on-surface-variant font-normal">
                      / night
                    </span>
                  </div>
                  <div className="text-[11px] text-on-surface-variant">
                    ₹{hotel.totalPrice.toLocaleString()} total for {hotel.nights} nights (shared)
                  </div>
                </div>

                {isBooked ? (
                  <button
                    type="button"
                    onClick={() => setExpandedHotelId(expandedHotelId === hotel.id ? null : hotel.id)}
                    className="px-space-md py-2 rounded-lg bg-surface-container-highest hover:bg-surface-bright text-on-surface text-xs font-medium transition-colors border border-surface-container-highest"
                  >
                    {expandedHotelId === hotel.id ? 'Hide Room Details' : 'View Room Details'}
                  </button>
                ) : (
                  <span className="text-xs text-outline hidden sm:inline">
                    {hotel.cancellationPolicy || 'Flexible cancellation'}
                  </span>
                )}
              </div>

              {/* Expandable Room Details Panel */}
              {isBooked && expandedHotelId === hotel.id && (
                <div className="mt-3 p-3 rounded-lg bg-surface-container-low border border-surface-container-high/60 text-xs space-y-2 animate-in fade-in duration-150">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1 border-b border-surface-container-high/40 pb-2">
                    <span className="font-semibold text-on-surface">
                      Selected Category: <span className="text-primary font-normal">{hotel.roomType}</span>
                    </span>
                    <span className="text-tertiary font-medium flex items-center gap-1">
                      <Check className="w-3.5 h-3.5" /> Confirmed Active Reservation
                    </span>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-on-surface-variant">
                    <div>
                      <span className="font-medium text-on-surface">Stay Duration:</span> {hotel.nights} Nights ({hotel.nights + 1} Days)
                    </div>
                    <div>
                      <span className="font-medium text-on-surface">Cancellation Policy:</span> {hotel.cancellationPolicy || 'Free cancellation up to 48 hours prior'}
                    </div>
                  </div>
                  <div>
                    <span className="font-medium text-on-surface">Included In-Room Amenities:</span>
                    <div className="flex flex-wrap gap-1 mt-1">
                      {hotel.features.map((feat, fIdx) => (
                        <span
                          key={`${hotel.id}-detail-feat-${fIdx}-${feat}`}
                          className="px-2 py-0.5 rounded bg-surface-container-high text-[11px] text-on-surface"
                        >
                          ✓ {feat}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        );
      }))}

      {/* More Hotels Nearby Section */}
      {nearbyHotels && nearbyHotels.length > 0 && (
        <div className="mt-8 pt-6 border-t border-surface-container-highest">
          <h3 className="text-sm font-semibold text-on-surface mb-3 flex items-center gap-1.5">
            <MapPin className="w-4 h-4 text-tertiary" />
            More Hotels Nearby
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
            {nearbyHotels.map((hotel, idx) => (
              <div
                key={`nearby-${hotel.id || idx}`}
                className="flex items-center gap-3 p-2.5 rounded-lg bg-surface-container-low border border-surface-container-highest/40 hover:border-surface-container-highest transition-colors cursor-pointer"
                onClick={() => onSelectHotel(hotel.id)}
              >
                <div className="w-14 h-14 rounded-md overflow-hidden flex-shrink-0 relative">
                  <img
                    src={hotel.imageUrl}
                    alt={hotel.imageAlt}
                    className="w-full h-full object-cover"
                    referrerPolicy="no-referrer"
                  />
                </div>
                <div className="flex-1 min-w-0">
                  <h4 className="text-[11px] font-semibold text-on-surface line-clamp-1">
                    {hotel.name}
                  </h4>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <span className="flex items-center gap-0.5 text-[9px] font-semibold text-tertiary">
                      <Star className="w-2.5 h-2.5 fill-tertiary" />
                      {hotel.rating}
                    </span>
                    <span className="text-[9px] text-on-surface-variant font-medium">
                      ₹{hotel.pricePerNight.toLocaleString()}/nt
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
