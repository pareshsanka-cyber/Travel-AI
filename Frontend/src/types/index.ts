/**
 * TypeScript Data Models & Interfaces for TravelAI FastAPI Frontend
 */

export interface User {
  id: string;
  name: string;
  email: string;
  avatar?: string;
}

export interface AuthContextType {
  user: User | null;
  token: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<{ success: boolean; error?: string }>;
  register: (name: string, email: string, password: string) => Promise<{ success: boolean; error?: string }>;
  logout: () => void;
}

export interface LocationChip {
  label: string;
  sublabel?: string;
  icon: string;
  colorClass?: string;
}

export interface ActivitySegment {
  timezone?: string;
  timeOfDay: 'Morning' | 'Afternoon' | 'Evening';
  time: string;
  title: string;
  description: string;
  categoryColor: 'primary' | 'secondary' | 'tertiary';
  location?: string;
  cost?: number;
  thumbnail?: string;
  lat?: number;
  lon?: number;
  rating?: number | string;
  reviews?: number;
  recommendedTimeSpent?: string;
  entranceFee?: number;
  cuisine?: string;
  operatingStatus?: 'OPEN' | 'CLOSED' | 'UNKNOWN';
  operatingHours?: string[];
  scheduledDate?: string;
  dayOfWeek?: string;
  statusReason?: string;
  interests?: string[];
  category?: string;
  matchType?: string;
  fameLevel?: string;
  source?: string;
  placeId?: string;
  id?: string;
  startTime?: string;
  endTime?: string;
  duration?: string;
  travelTimeFromPrev?: string;
  travelMode?: string;
  type?: string;
  matchedInterest?: string;
  priorityRank?: number;
  whyVisit?: string;
  statusLabel?: string;
  isMealBreak?: boolean;
}

export type TravelMode = 'driving' | 'walking' | 'cab';

export interface RouteStep {
  instruction: string;
  distanceMeters: number;
  durationSeconds: number;
  name: string;
  maneuverType?: string;
  maneuverModifier?: string;
}

export interface RouteLeg {
  fromTitle: string;
  toTitle: string;
  fromCoords: [number, number]; // [lat, lon]
  toCoords: [number, number];   // [lat, lon]
  mode: TravelMode;
  distanceKm: number;
  durationMins: number;
  geometry: Array<[number, number]>; // Real street road coordinates [lat, lon]
  steps: RouteStep[];
  googleMapsUrl: string;
  status: 'ok' | 'no_route' | 'fallback' | 'error' | 'flight';
  isFlightLeg?: boolean;  // true when this leg represents an international flight
  errorMessage?: string;
}


export interface ItineraryDay {
  isoDate?: string;
  dayNumber: number;
  date: string;
  title: string;
  transitBadge: string;
  activities: ActivitySegment[];
  legs?: RouteLeg[];
}

export interface FlightMetadata {
  source?: string;
  dataStatus?: 'search_results' | 'historical_record' | 'no_flights_found' | 'error';
  fetchedAt?: string;
  lastCheckedAt?: string;
  departureDate?: string;
  departureDateDisplay?: string;
  isPastDate?: boolean;
  isEstimatedDate?: boolean;
  origin?: string;
  destination?: string;
  googleFlightsUrl?: string;
  totalOptions?: number;
  message?: string;
  error?: string;
}

export interface FlightOption {
  id: string;
  airlineCode: string;
  airlineName?: string;
  airlineLogo?: string;
  flightNumber: string;
  aircraft: string;
  departureTime: string;
  departureAirport: string;
  departureAirportName?: string;
  departureDate?: string;
  departureDateIso?: string;
  departureDateDisplay?: string;
  arrivalTime: string;
  arrivalDate?: string;
  arrivalAirport: string;
  arrivalAirportName?: string;
  duration: string;
  durationMinutes?: number;
  stops?: number;
  layovers?: Array<{
    name: string;
    duration: string;
    id?: string;
  }>;
  amenities?: string[];
  extensions?: string[];
  travelClass?: string;
  onTimePercent?: number;
  serviceType: string;
  baggageInfo: string;
  pricePerPerson: number;
  currency: string;
  totalForPax: number;
  isSelected?: boolean;
  bookingUrl?: string;
  googleFlightsUrl?: string;
  searchUrl?: string;
  source?: string;
  fetchedAt?: string;
  dataStatus?: 'search_results' | 'historical_record' | 'no_flights_found' | 'error';
  isPastDate?: boolean;
  isEstimatedDate?: boolean;
  bookingToken?: string;
}

export interface HotelOption {
  currency?: string;
  id: string;
  name: string;
  location: string;
  rating: number;
  reviewCount: number;
  imageUrl: string;
  imageAlt: string;
  pricePerNight: number;
  totalPrice: number;
  nights: number;
  roomType: string;
  features: string[];
  isSelected?: boolean;
  cancellationPolicy?: string;
}

export interface WeatherCondition {
  summary?: string;
  data_status?: string;
  temperatureCelsius: number;
  feelsLikeCelsius: number;
  conditionDescription: string;
  humidityPercent: number;
  windSpeedKmh: string;
  uvIndex: number;
  uvDescription: string;
  dailyForecast: Array<{
    dayNumber: number;
    date: string;
    dayLabel: string;
    icon: string;
    tempHigh: number | null;
    tempLow: number | null;
    rainChancePercent: number | null;
    conditionText: string;
  }>;
}

export interface BudgetItem {
  category: 'Flights' | 'Accommodations' | 'Gastronomy' | 'Activities & Spa' | 'Safety Reserve';
  allocatedAmount: number;
  percentage: number;
  sublabel: string;
  color: string;
  colorName: 'primary' | 'tertiary' | 'secondary' | 'primary-container' | 'outline';
}

export interface BudgetOverview {
  notes?: string;
  isComplete?: boolean;
  totalBudget: number;
  allocatedExpenditure: number;
  unallocatedBuffer: number;
  consumptionPercentage: number;
  currencySymbol: string;
  travelersCount?: number;
  breakdown: BudgetItem[];
  savingsInsightTitle: string;
  savingsInsightBody: string;
}

export interface ExecutionState {
  is_active: boolean;
  current_day_number: number;
  activity_log: Record<string, {
    status: 'pending' | 'in_progress' | 'completed' | 'skipped';
    actual_start_time?: string;
    actual_end_time?: string;
    user_notes?: string;
    activity_id?: string;
    activity_title?: string;
  }>;
  reroute_history: any[];
}

export interface TripSummary {
  plusAccess?: boolean;
  plusAccessSource?: "booking" | "upgrade" | null;
  startDate?: string;
  endDate?: string;
  destinationTimezone?: string;
  flightMetadata?: FlightMetadata;
  id: string;
  title: string;
  destination: string;
  duration: string;
  daysCount: number;
  nightsCount: number;
  travelersCount: number;
  budgetEstimate: string;
  status: 'Planned' | 'Confirmed Plan' | 'Drafting' | 'Archived';
  heroImageUrl: string;
  bespokeCircuitLabel: string;
  activeWaypointsCount: number;
  routeHeadline: string;
  travelStyle?: string;
  budgetMode?: string;
  executionState?: ExecutionState;
  revision?: number;
  routeDetails?: any;
}

export interface RerouteProposal {
  status: 'success' | 'error';
  proposal_id: string;
  day_number: number;
  revision: number;
  replacement_found: boolean;
  origin_location_label?: string;
  skipped_activity: {
    id: string;
    title: string;
    time?: string;
    category?: string;
  };
  replacement_activity: ActivitySegment | null;
  original_stops: ActivitySegment[];
  proposed_stops: ActivitySegment[];
  rescheduled_stops: ActivitySegment[];
  reason: string;
}

export interface RerouteApplyResult {
  status: 'success' | 'error';
  trip_id: string;
  revision: number;
  route_details: any;
  execution_state: ExecutionState;
  reroute_record?: any;
}

export interface ChatMessage {
  id: string;
  sender: 'user' | 'assistant';
  timestamp: string;
  text?: string;
  richContent?: {
    versionHeadline?: string;
    optimizationRate?: string;
    leadParagraph?: string;
    highlights?: Array<{
      icon: string;
      category: string;
      detail: string;
      color: 'primary' | 'secondary' | 'tertiary';
    }>;
    actionButton?: {
      label: string;
      tabTarget: string;
      icon: string;
    };
    hotelRecommendations?: Array<{
      id: string;
      name: string;
      locationSnippet: string;
      rating: number;
      pricePerNight: string;
      isApplied?: boolean;
    }>;
  };
}

export interface ConversationHistoryItem {
  id: string;
  title: string;
  timeAgo: string;
}

export interface SavedTripSnippet {
  id: string;
  name: string;
  destinationTag: string;
  daysTag: string;
}

export interface ApiStatusState {
  isConnected: boolean;
  endpointUrl: string;
  statusCode: number | null;
  statusMessage: string;
  mode: 'live' | 'mock-fallback';
  lastPingAt?: string;
}

export interface PlaceMemoryItem {
  id: string;
  name: string;
  category: string;
  tag: string;
  location: string;
  rating: number;
  note: string;
  price: string;
}

