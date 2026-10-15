import { BookDemoButton } from '../BookDemoButton';
import React from 'react';
import { Plane, CheckCircle2, ExternalLink, Calendar, Search, AlertCircle, ShieldCheck, Clock, Luggage, Sparkles } from 'lucide-react';
import { FlightOption, FlightMetadata } from '../../types';

interface FlightsTabProps {
  onBook: (kind: 'flight' | 'hotel', id: string, source?: 'discovered' | 'sample') => Promise<void>;
  flights: FlightOption[];
  onSelectFlight: (id: string) => Promise<boolean>;
  destination?: string;
  trip?: any;
}

export const FlightsTab: React.FC<FlightsTabProps> = ({
  flights,
  onSelectFlight,
  onBook,
  destination,
  trip,
}) => {
  const flightMeta: FlightMetadata | undefined = trip?.flightMetadata;
  const [savingId, setSavingId] = React.useState<string | null>(null);
  const select = async (id: string) => { setSavingId(id); try { await onSelectFlight(id); } finally { setSavingId(null); } };
  const first = flights && flights.length > 0 ? flights[0] : null;

  // Extract dep/arr codes
  const depCode = first?.departureAirport || trip?.origin || 'HYD';
  const arrCode = first?.arrivalAirport || destination || trip?.destination || 'DEL';

  // Check if this trip or date is historical
  const isPast = Boolean(
    flightMeta?.isPastDate ||
    flightMeta?.dataStatus === 'historical_record' ||
    (first && first.isPastDate)
  );

  // Determine header
  const routeHeader = React.useMemo(() => {
    if (first && first.departureAirport && first.arrivalAirport) {
      return `Matched Flights: ${first.departureAirport} ⇄ ${first.arrivalAirport}`;
    }
    if (destination) {
      return `Matched Flights: ${destination}`;
    }
    return 'Matched Route Flights';
  }, [first?.departureAirport, first?.arrivalAirport, destination]);

  const depDateDisplay = first?.departureDateDisplay || first?.departureDate || flightMeta?.departureDateDisplay || flightMeta?.departureDate || trip?.start_date || trip?.startDate || 'Departure Date';
  const fetchedAtTime = flightMeta?.fetchedAt ? new Date(flightMeta.fetchedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : null;

  return (
    <div className="space-y-space-md animate-in fade-in duration-200">
      {/* Header with authentic metadata */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="text-base sm:text-lg font-semibold text-on-surface">
              {routeHeader}
            </h2>
            {isPast ? (
              <span className="px-2.5 py-0.5 rounded-full bg-amber-500/15 text-amber-300 text-[11px] font-medium border border-amber-500/30 flex items-center gap-1">
                <AlertCircle className="w-3 h-3 text-amber-400" />
                Historical Itinerary
              </span>
            ) : flights.length > 0 ? (
              <span className="px-2.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300 text-[11px] font-medium border border-emerald-500/30 flex items-center gap-1">
                <ShieldCheck className="w-3 h-3 text-emerald-400" />
                Live Google Flights Search
              </span>
            ) : null}
            {(flightMeta?.isEstimatedDate || first?.isEstimatedDate) && !isPast && (
              <span className="px-2 py-0.5 rounded-full bg-surface-container-highest/60 text-on-surface-variant text-[11px] font-medium border border-surface-container-highest">
                Default Date Policy (+7d)
              </span>
            )}
          </div>
          <p className="text-xs text-on-surface-variant flex items-center gap-1.5 flex-wrap mt-0.5">
            <span>Genuine flight search powered by Google Flights (via SerpApi).</span>
            {fetchedAtTime && (
              <span className="text-[11px] text-on-surface-variant/70">
                · Synchronized at {fetchedAtTime}
              </span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2 self-start sm:self-auto">
          <span className="px-3 py-1 rounded-full bg-primary/10 text-primary text-xs font-medium border border-primary/20">
            {flights.length} {flights.length === 1 ? 'Option' : 'Options'}
          </span>
        </div>
      </div>

      {/* Historical Record Notice */}
      {isPast && (
        <div className="rounded-xl p-4 bg-amber-500/10 border border-amber-500/30 text-amber-200 space-y-2.5">
          <div className="flex items-start gap-2.5">
            <AlertCircle className="w-5 h-5 text-amber-400 mt-0.5 shrink-0" />
            <div className="space-y-1">
              <h4 className="font-semibold text-xs sm:text-sm text-amber-300">
                Departure Date in the Past ({depDateDisplay})
              </h4>
              <p className="text-xs text-amber-200/90 leading-relaxed">
                This trip was recorded for historical dates. Live commercial airline reservation systems only offer bookable inventory for future dates.
              </p>
            </div>
          </div>
          <div className="pt-1 flex items-center gap-2">
            <a
              href={`https://www.google.com/travel/flights?q=Flights%20to%20${arrCode}%20from%20${depCode}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 text-amber-200 text-xs font-semibold border border-amber-500/40 transition-colors"
            >
              <span>Search Current Live Flights on Google Flights</span>
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
          </div>
        </div>
      )}

      {/* Empty State when no flights exist */}
      {(!flights || flights.length === 0) ? (
        <div className="flex flex-col items-center justify-center p-10 rounded-2xl bg-surface-container border border-surface-container-highest/60 text-center space-y-3">
          <div className="w-12 h-12 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
            <Plane className="w-6 h-6" />
          </div>
          <h3 className="text-base font-semibold text-on-surface">
            {flightMeta?.dataStatus === 'no_flights_found' ? 'No Commercial Flights Found' : 'No Flights Available'}
          </h3>
          <p className="text-xs text-on-surface-variant max-w-md">
            {flightMeta?.message ||
              `No live commercial flights were matched between ${depCode} and ${arrCode}. Check regional airports or explore available dates directly.`}
          </p>
          <a
            href={`https://www.google.com/travel/flights?q=Flights%20to%20${arrCode}%20from%20${depCode}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary/10 hover:bg-primary/20 text-primary text-xs font-semibold border border-primary/20 transition-colors"
          >
            <span>Search Alternative Routes on Google Flights</span>
            <ExternalLink className="w-3.5 h-3.5" />
          </a>
        </div>
      ) : (
        /* Real Flights List */
        flights.map((flight, idx) => {
          const isSelected = flight.isSelected;
          const depDate = flight.departureDateDisplay || flight.departureDate || depDateDisplay;
          const depIso = flight.departureDateIso || (flight.departureDate && flight.departureDate.includes('-') ? flight.departureDate : '');

          const googleUrl = flight.googleFlightsUrl || (
            depIso
              ? `https://www.google.com/travel/flights?q=Flights%20to%20${flight.arrivalAirport}%20from%20${flight.departureAirport}%20on%20${depIso}`
              : `https://www.google.com/travel/flights?q=Flights%20to%20${flight.arrivalAirport}%20from%20${flight.departureAirport}`
          );
          const searchUrl = flight.searchUrl || `https://www.google.com/search?q=${encodeURIComponent(`${flight.airlineName || flight.airlineCode || 'Flight'} ${flight.flightNumber} ${flight.departureAirport} to ${flight.arrivalAirport} ${depIso || depDate}`)}`;

          // Stop description
          const stopsText = typeof flight.stops === 'number'
            ? (flight.stops === 0 ? 'Nonstop' : `${flight.stops} ${flight.stops === 1 ? 'stop' : 'stops'}`)
            : 'Direct Non-Stop';

          return (
            <div
              key={flight.id || `flight-${idx}`}
              className={`rounded-xl p-space-md shadow-md space-y-space-sm border transition-all ${
                isSelected
                  ? 'bg-surface-container border-primary/40 ring-1 ring-primary/20'
                  : 'bg-surface-container/70 border-surface-container-highest/40 hover:border-surface-container-highest opacity-85 hover:opacity-100'
              }`}
            >
              {/* Top row: Airline info & Selection button */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  {flight.airlineLogo ? (
                    <img
                      src={flight.airlineLogo}
                      alt={flight.airlineName || flight.airlineCode}
                      className="w-8 h-8 rounded-lg object-contain bg-white p-0.5 border border-surface-container-highest/60"
                      onError={(e) => {
                        // Fallback to text badge if logo fails to load
                        (e.target as HTMLElement).style.display = 'none';
                      }}
                    />
                  ) : (
                    <span
                      className="w-8 h-8 rounded-lg flex items-center justify-center font-bold text-xs bg-primary/20 text-primary border border-primary/30"
                    >
                      {flight.airlineCode}
                    </span>
                  )}
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-sm text-on-surface">
                        {flight.airlineName ? `${flight.airlineName} (${flight.flightNumber})` : flight.flightNumber}
                      </span>
                      {depDate && (
                        <span className="hidden sm:inline-flex items-center gap-1 text-[11px] font-medium text-tertiary bg-tertiary/10 px-2 py-0.5 rounded-full border border-tertiary/20">
                          <Calendar className="w-2.5 h-2.5" />
                          <span>{depDate}</span>
                          {(flight.isEstimatedDate || flightMeta?.isEstimatedDate) && (
                            <span className="text-[10px] text-tertiary/80 font-normal">· Default (+7d)</span>
                          )}
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-on-surface-variant">
                      {flight.aircraft}
                    </div>
                  </div>
                </div>

                {isSelected ? (
                  <span className="px-3 py-1 rounded-full bg-tertiary-container/30 text-tertiary text-xs font-semibold flex items-center gap-1.5 border border-tertiary/20">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span>Selected for Trip</span>
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => void select(flight.id)}
                    disabled={savingId !== null}
                    aria-busy={savingId === flight.id}
                    className="px-3 py-1 rounded-full bg-surface-container-highest hover:bg-primary hover:text-on-primary text-on-surface text-xs font-medium transition-colors"
                  >
                    {savingId === flight.id ? 'Saving…' : 'Select Alternative'}
                  </button>
                )}
              </div>

              {/* Flight Transit Graphic */}
              <div className="grid grid-cols-3 items-center py-2">
                <div>
                  <div className="text-xl sm:text-2xl font-bold text-on-surface">
                    {flight.departureTime}
                  </div>
                  <div className="text-xs font-semibold text-on-surface">
                    {flight.departureAirport}
                  </div>
                  {flight.departureAirportName && (
                    <div className="text-[11px] text-on-surface-variant truncate max-w-[130px] sm:max-w-[200px]" title={flight.departureAirportName}>
                      {flight.departureAirportName}
                    </div>
                  )}
                  <p className="text-[11px] text-on-surface-variant">{flight.departureDateIso || flight.departureDate}</p>
                </div>

                <div className="flex flex-col items-center text-center px-1">
                  <span className="text-[11px] text-outline font-medium">{flight.duration}</span>
                  <div className="w-full flex items-center gap-1 my-1">
                    <div className="h-0.5 flex-1 bg-surface-container-highest" />
                    <Plane
                      className={`w-4 h-4 shrink-0 ${
                        isSelected ? 'text-primary' : 'text-outline'
                      }`}
                    />
                    <div className="h-0.5 flex-1 bg-surface-container-highest" />
                  </div>
                  <div className="flex flex-col items-center">
                    <span className="text-[11px] font-medium text-on-surface">
                      {stopsText}
                    </span>
                    {flight.layovers && flight.layovers.length > 0 && (
                      <span className="text-[10px] text-outline truncate max-w-[140px] sm:max-w-[220px]" title={flight.layovers.map(l => `${l.name} (${l.duration})`).join(', ')}>
                        via {flight.layovers[0].name} ({flight.layovers[0].duration})
                      </span>
                    )}
                  </div>
                </div>

                <div className="text-right">
                  <div className="text-xl sm:text-2xl font-bold text-on-surface">
                    {flight.arrivalTime}
                  </div>
                  <div className="text-xs font-semibold text-on-surface">
                    {flight.arrivalAirport}
                  </div>
                  {flight.arrivalAirportName && (
                    <div className="text-[11px] text-on-surface-variant truncate max-w-[130px] sm:max-w-[200px] ml-auto" title={flight.arrivalAirportName}>
                      {flight.arrivalAirportName}
                    </div>
                  )}
                  {flight.arrivalDate && <p className="text-[11px] text-primary">Arrives {flight.arrivalDate}</p>}
                </div>
              </div>

              {/* Amenities & Extensions tags */}
              {((flight.amenities && flight.amenities.length > 0) || (flight.extensions && flight.extensions.length > 0)) && (
                <div className="flex items-center gap-1.5 flex-wrap pt-0.5">
                  {(flight.amenities || flight.extensions || []).slice(0, 4).map((amenity, aIdx) => (
                    <span
                      key={aIdx}
                      className="inline-flex items-center gap-1 text-[10px] text-on-surface-variant/90 bg-surface-container-highest/60 px-2 py-0.5 rounded-full border border-surface-container-highest"
                    >
                      <Sparkles className="w-2.5 h-2.5 text-primary/70" />
                      <span>{amenity}</span>
                    </span>
                  ))}
                  <span className="text-[10px] text-on-surface-variant bg-surface-container-highest/40 px-2 py-0.5 rounded-full">
                    {flight.travelClass || flight.serviceType || 'Economy'}
                  </span>
                </div>
              )}

              {/* Price, Baggage and Google Flights Deep Link Footer */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pt-1 bg-surface-container-low p-2.5 rounded-lg border border-surface-container-high/30">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs text-on-surface-variant flex items-center gap-1">
                    <Luggage className="w-3.5 h-3.5 text-outline" />
                    <span>{flight.baggageInfo}</span>
                  </span>
                  <div className="flex items-center gap-1.5">
                    <a
                      href={googleUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-[11px] font-semibold text-primary hover:underline hover:text-primary/80 transition-colors bg-primary/10 px-2 py-0.5 rounded border border-primary/20"
                      title={`Verify & book on Google Flights: ${flight.departureAirport} ⇄ ${flight.arrivalAirport}`}
                    >
                      <span>Google Flights</span>
                      <ExternalLink className="w-3 h-3" />
                    </a>
                    <a
                      href={searchUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-[11px] text-on-surface-variant hover:text-on-surface hover:underline transition-colors px-1.5 py-0.5"
                      title={`Cross-check ${flight.flightNumber} details`}
                    >
                      <Search className="w-2.5 h-2.5" />
                      <span>Schedule Search</span>
                    </a>
                  </div>
                </div>
                <div
                  className={`text-sm sm:text-base font-bold ${
                    isSelected ? 'text-primary' : 'text-on-surface'
                  }`}
                >
                  {flight.currency}
                  {Math.round(flight.pricePerPerson).toLocaleString()}{' '}
                  <span className="text-xs text-on-surface-variant font-normal">
                    / person ({flight.currency}{Math.round(flight.totalForPax).toLocaleString()} total)
                  </span>
                </div>
              </div>
              <BookDemoButton kind="flight" id={flight.id} price={flight.pricePerPerson} onBook={onBook} />
            </div>
          );
        })
      )}
    </div>
  );
};
