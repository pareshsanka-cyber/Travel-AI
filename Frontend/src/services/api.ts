/**
 * FastAPI REST Client & Service Layer
 * 
 * Configured via Vite environment variable VITE_FASTAPI_URL.
 * Supports fallback to graceful mock state if the backend is not yet started or endpoint is in development.
 */

import {
  TripSummary,
  ItineraryDay,
  ActivitySegment,
  FlightOption,
  HotelOption,
  WeatherCondition,
  BudgetOverview,
  ChatMessage,
  SavedTripSnippet,
  ConversationHistoryItem,
  ApiStatusState
} from '../types';


// Environment variable with runtime local-storage override capability
const ENV_API_URL = (typeof import.meta !== 'undefined' && import.meta?.env ? (import.meta.env.VITE_FASTAPI_URL || import.meta.env.VITE_API_URL) : undefined) || 'http://localhost:8000';

export function getApiBaseUrl(): string {
  if (typeof window !== 'undefined') {
    const customUrl = localStorage.getItem('TRAVELAI_FASTAPI_URL');
    if (customUrl) return customUrl.trim();
  }
  return ENV_API_URL;
}

export function setApiBaseUrl(url: string): void {
  if (typeof window !== 'undefined') {
    if (!url || url.trim() === '') {
      localStorage.removeItem('TRAVELAI_FASTAPI_URL');
    } else {
      localStorage.setItem('TRAVELAI_FASTAPI_URL', url.trim());
    }
  }
}

// -------------------------------------------------------------
// ONE Unified Base Fetch Helper: apiFetch
// -------------------------------------------------------------
type StatusListener = (status: ApiStatusState) => void;
let statusListener: StatusListener | null = null;

export function setApiStatusListener(listener: StatusListener | null) {
  statusListener = listener;
}

export interface ApiFetchOptions extends RequestInit {
  timeoutMs?: number;
}

export async function apiFetch<T>(
  endpoint: string,
  options: ApiFetchOptions = {}
): Promise<T> {
  const baseUrl = getApiBaseUrl().replace(/\/+$/, '');
  const cleanEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
  const url = `${baseUrl}${cleanEndpoint}`;

  const controller = new AbortController();

  // If caller provided an AbortSignal, propagate its abortion to our controller
  if (options.signal) {
    if (options.signal.aborted) {
      controller.abort(options.signal.reason);
    } else {
      options.signal.addEventListener('abort', () => {
        controller.abort(options.signal?.reason);
      });
    }
  }

  // Set timeout ONLY if explicitly passed (e.g. for quick health checks)
  // Chat messages and trip planning generation remain pending until completion or network failure
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  if (typeof options.timeoutMs === 'number' && options.timeoutMs > 0) {
    timeoutId = setTimeout(() => {
      controller.abort(new DOMException(`Request timed out after ${options.timeoutMs}ms`, 'TimeoutError'));
    }, options.timeoutMs);
  }

  try {
    if (endpoint.includes('/api/chat/message')) {
      console.log(`[CHAT DEBUG] apiFetch: initiating fetch to ${url}`);
    }

    // Attach user auth & identity headers if present in localStorage
    const storedUserStr = typeof window !== 'undefined' ? localStorage.getItem('travelai_user') : null;
    const storedToken = typeof window !== 'undefined' ? localStorage.getItem('travelai_token') : null;
    const authHeaders: Record<string, string> = {};
    if (storedUserStr) {
      try {
        const u = JSON.parse(storedUserStr);
        if (u && (u.id || u.email)) {
          authHeaders['x-user-id'] = u.id || u.email;
        }
      } catch {}
    }
    if (storedToken) {
      authHeaders['Authorization'] = `Bearer ${storedToken}`;
    }

    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        ...authHeaders,
        ...(options.headers || {}),
      },
    });

    if (timeoutId) clearTimeout(timeoutId);

    if (endpoint.includes('/api/chat/message')) {
      console.log(`[CHAT DEBUG] apiFetch: received HTTP ${response.status} from ${url}`);
    }

    if (!response.ok) {
      let errorDetail = `HTTP ${response.status}: ${response.statusText}`;
      try {
        const errorJson = await response.json();
        if (errorJson && errorJson.detail) {
          errorDetail = typeof errorJson.detail === 'string' ? errorJson.detail : JSON.stringify(errorJson.detail);
        }
      } catch {
        // keep default error detail
      }
      throw new Error(errorDetail);
    }

    return (await response.json()) as T;
  } catch (err: unknown) {
    if (timeoutId) clearTimeout(timeoutId);
    if (statusListener) {
      statusListener({
        isConnected: false,
        endpointUrl: baseUrl,
        statusCode: null,
        statusMessage: 'Disconnected',
        mode: 'mock-fallback',
        lastPingAt: new Date().toLocaleTimeString(),
      });
    }
    const msg = err instanceof Error ? err.message : 'Network request failed';
    throw new Error(msg);
  }
}

// -------------------------------------------------------------
// Health Check (Calls GET / directly - dropping /api/health)
// -------------------------------------------------------------
export async function checkFastApiHealth(): Promise<ApiStatusState> {
  const baseUrl = getApiBaseUrl();
  try {
    const res = await apiFetch<{ status?: string; message?: string }>('/', {
      timeoutMs: 5000,
    });
    const state: ApiStatusState = {
      isConnected: true,
      endpointUrl: baseUrl,
      statusCode: 200,
      statusMessage: res?.message || '200 OK - Connected',
      mode: 'live',
      lastPingAt: new Date().toLocaleTimeString(),
    };
    if (statusListener) statusListener(state);
    return state;
  } catch {
    const state: ApiStatusState = {
      isConnected: false,
      endpointUrl: baseUrl,
      statusCode: null,
      statusMessage: 'Disconnected',
      mode: 'mock-fallback',
      lastPingAt: new Date().toLocaleTimeString(),
    };
    if (statusListener) statusListener(state);
    return state;
  }
}


// -------------------------------------------------------------
// Fallback Mock Data (matches Stitch design exactly)
// -------------------------------------------------------------
export const INITIAL_TRIP: TripSummary = {
  id: 'goa-coastal-v24',
  title: 'Goa Coastal Splendor & Heritage',
  destination: 'Goa, India',
  duration: '4 Days, 3 Nights',
  daysCount: 4,
  nightsCount: 3,
  travelersCount: 2,
  budgetEstimate: '₹50,000 Est. Budget',
  status: 'Confirmed Plan',
  heroImageUrl: 'https://lh3.googleusercontent.com/aida-public/AB6AXuBlx7gAJoMQBXDwbj6pcwTqIFcYOsmHvoW4FP-ompYmqI5sdLnZA_V_Vo7s2KaplYKZasc62M2PUG1oCM8TH0Z07k10P6QveYrXQL7OAzs_LtZujhGa5DgZj2B1Lt83FtvfbX5cf4OzbSPNc0HxZSxA0n70yRDsXRUzj3Cs3tyKLFvOticj1qWp-a5SvwUFFe5M7wTtu3leSHjY1VvKgmhcc0WV-OM1qDNk60-lJxEzj7UZUxDQDjkCFg',
  bespokeCircuitLabel: 'Bespoke Circuit',
  activeWaypointsCount: 4,
  routeHeadline: 'North Coast • Old Goa • Chapora River',
};

export const INITIAL_ITINERARY_DAYS: ItineraryDay[] = [
  {
    dayNumber: 1,
    date: 'Apr 12',
    title: 'Day 1: North Goa Coastline & Sunset Arrival',
    transitBadge: 'Private Chauffeur Sedan',
    activities: [
      {
        timeOfDay: 'Morning',
        time: '11:30',
        title: 'Touchdown GOX & Transfer',
        description: 'Executive pickup from Manohar International Airport; check-in at Taj Holiday Village Candolim.',
        categoryColor: 'primary',
      },
      {
        timeOfDay: 'Afternoon',
        time: '14:00',
        title: 'Thalassa Vagator Dining',
        description: 'Greek & fresh seafood lunch with cliff views overlooking Ozran Beach shoreline.',
        categoryColor: 'secondary',
      },
      {
        timeOfDay: 'Evening',
        time: '17:45',
        title: 'Sunset Cruise on Chapora',
        description: 'Private catamaran voyage with handcrafted cocktails and coastal acoustics.',
        categoryColor: 'tertiary',
      },
    ],
  },
  {
    dayNumber: 2,
    date: 'Apr 13',
    title: 'Day 2: Old Goa Heritage & Fontainhas Latin Quarter',
    transitBadge: 'Guided Heritage Escort',
    activities: [
      {
        timeOfDay: 'Morning',
        time: '09:30',
        title: 'Basilica of Bom Jesus UNESCO',
        description: 'Walk through 16th-century baroque architecture and Se Cathedral heritage archives.',
        categoryColor: 'primary',
      },
      {
        timeOfDay: 'Afternoon',
        time: '13:30',
        title: 'Fontainhas Walk & Lunch',
        description: 'Explore colorful Portuguese colonial residences followed by authentic Indo-Portuguese degustation.',
        categoryColor: 'secondary',
      },
      {
        timeOfDay: 'Evening',
        time: '19:30',
        title: 'Baga Beachfront Dining',
        description: 'Private candle-lit beachfront table with tiger prawns & Kingfish recheado.',
        categoryColor: 'tertiary',
      },
    ],
  },
  {
    dayNumber: 3,
    date: 'Apr 14',
    title: 'Day 3: Private Catamaran & Rejuvenation Spa',
    transitBadge: 'Private Yacht Charter',
    activities: [
      {
        timeOfDay: 'Morning',
        time: '08:30',
        title: 'South Coast Dolphin Cruise',
        description: 'Private charter navigating calm waters with wild dolphin spotting and reef swimming.',
        categoryColor: 'primary',
      },
      {
        timeOfDay: 'Afternoon',
        time: '15:00',
        title: 'Jiva Ayurvedic Wellness',
        description: '90-minute signature herbal massage and hydrotherapy at Taj Wellness Spa.',
        categoryColor: 'secondary',
      },
      {
        timeOfDay: 'Evening',
        time: '20:00',
        title: "Chef's Table at Cavatina",
        description: 'Contemporary Goan gastronomy curated by Chef Avinash Martins.',
        categoryColor: 'tertiary',
      },
    ],
  },
  {
    dayNumber: 4,
    date: 'Apr 15',
    title: 'Day 4: Serene Morjim Beach & Departure',
    transitBadge: 'Outbound Flight DEL',
    activities: [
      {
        timeOfDay: 'Morning',
        time: '08:00',
        title: 'Morjim Shoreline Yoga',
        description: 'Morning beach session, organic tropical smoothies, and turtle sanctuary walk.',
        categoryColor: 'primary',
      },
      {
        timeOfDay: 'Afternoon',
        time: '13:00',
        title: 'Artisanal Cashew & Spice Market',
        description: 'Boutique shopping for feni, roasted organic cashews, and indigenous spices in Mapusa.',
        categoryColor: 'secondary',
      },
      {
        timeOfDay: 'Evening',
        time: '17:30',
        title: 'GOI Airport Transfer',
        description: 'Chauffeured sedan to Goa Dabolim / GOX for evening direct flight to New Delhi.',
        categoryColor: 'tertiary',
      },
    ],
  },
];

export const INITIAL_FLIGHTS: FlightOption[] = [
  {
    id: 'fl-6e204',
    airlineCode: '6E',
    airlineName: 'IndiGo',
    flightNumber: '6E-204',
    aircraft: 'Airbus A321neo • Direct Non-Stop',
    departureTime: '08:15 AM',
    departureAirport: 'DEL',
    departureDate: '12 Jan 2027',
    departureDateIso: '2027-01-12',
    arrivalTime: '10:40 AM',
    arrivalAirport: 'GOI',
    duration: '2h 25m',
    onTimePercent: 96,
    serviceType: 'Standard Class',
    baggageInfo: 'Includes 15kg Baggage + Standard Seat Selection',
    pricePerPerson: 6450,
    currency: '₹',
    totalForPax: 12900,
    isSelected: true,
    googleFlightsUrl: 'https://www.google.com/travel/flights?q=Flights%20to%20GOI%20from%20DEL%20on%202027-01-12',
    searchUrl: 'https://www.google.com/search?q=IndiGo%206E-204%20DEL%20to%20GOI%202027-01-12',
    bookingUrl: 'https://www.google.com/travel/flights?q=Flights%20to%20GOI%20from%20DEL%20on%202027-01-12',
  },
  {
    id: 'fl-ai883',
    airlineCode: 'AI',
    airlineName: 'Air India',
    flightNumber: 'AI-883',
    aircraft: 'Boeing 787-8 • Full Service Direct',
    departureTime: '11:10 AM',
    departureAirport: 'DEL',
    departureDate: '12 Jan 2027',
    departureDateIso: '2027-01-12',
    arrivalTime: '01:45 PM',
    arrivalAirport: 'GOI',
    duration: '2h 35m',
    onTimePercent: 94,
    serviceType: 'Hot Meal Included',
    baggageInfo: 'Includes 25kg Baggage + Hot Gourmet Meal',
    pricePerPerson: 7890,
    currency: '₹',
    totalForPax: 15780,
    isSelected: false,
    googleFlightsUrl: 'https://www.google.com/travel/flights?q=Flights%20to%20GOI%20from%20DEL%20on%202027-01-12',
    searchUrl: 'https://www.google.com/search?q=Air%20India%20AI-883%20DEL%20to%20GOI%202027-01-12',
    bookingUrl: 'https://www.google.com/travel/flights?q=Flights%20to%20GOI%20from%20DEL%20on%202027-01-12',
  },
  {
    id: 'fl-qp1341',
    airlineCode: 'QP',
    airlineName: 'Akasa Air',
    flightNumber: 'QP-1341',
    aircraft: 'Boeing 737 MAX 8 • Express Direct',
    departureTime: '02:20 PM',
    departureAirport: 'DEL',
    departureDate: '12 Jan 2027',
    departureDateIso: '2027-01-12',
    arrivalTime: '04:50 PM',
    arrivalAirport: 'GOI',
    duration: '2h 30m',
    onTimePercent: 96,
    serviceType: 'Eco Express',
    baggageInfo: 'Includes 15kg Checked Baggage',
    pricePerPerson: 5920,
    currency: '₹',
    totalForPax: 11840,
    isSelected: false,
    googleFlightsUrl: 'https://www.google.com/travel/flights?q=Flights%20to%20GOI%20from%20DEL%20on%202027-01-12',
    searchUrl: 'https://www.google.com/search?q=Akasa%20Air%20QP-1341%20DEL%20to%20GOI%202027-01-12',
    bookingUrl: 'https://www.google.com/travel/flights?q=Flights%20to%20GOI%20from%20DEL%20on%202027-01-12',
  },
];

export const INITIAL_HOTELS: HotelOption[] = [
  {
    id: 'ht-taj-village',
    name: 'Taj Holiday Village Resort & Spa',
    location: 'Sinquerim Beach, Candolim, North Goa',
    rating: 4.9,
    reviewCount: 1240,
    imageUrl: 'https://lh3.googleusercontent.com/aida-public/AB6AXuAarl8JpZER6C92bP4Z09unjUmjhIRwgcisHQIl3iLYYS8KpZqi-62cTQCYeiESVvEzVNKDr4ocefQ5F2OTubQ95KBO4kpatrjFSzrqpy2cshjmLM0NKo4j68HD81jJ_VddnQCqKZ9uevPFU4cjgcGweFBm8oTW2YsUHczINBgZJy-V4V3SIjKOSdai9Au-y2TTIzbT7-yzeZvSdseJO56O1HTHAvzhtECr8wcFMrUz_VL0VDOBXPvNmA',
    imageAlt: 'Luxury beachfront villa at Taj Holiday Village in Goa with lush coconut palms, sea-view patio, terracotta architecture.',
    pricePerNight: 14200,
    totalPrice: 21300,
    nights: 3,
    roomType: 'Sea-view Villa',
    features: ['Sea-view Villa', 'Complimentary Breakfast', 'Jiva Spa Access', 'Infinity Lap Pool'],
    isBooked: true,
  },
  {
    id: 'ht-w-goa',
    name: 'W Goa, Vagator',
    location: 'Vagator Beach, North Goa',
    rating: 4.8,
    reviewCount: 890,
    imageUrl: 'https://lh3.googleusercontent.com/aida-public/AB6AXuAsaYyNq5PWaAfEwGiq6HHbKuJiQx_WzOQnX0OWEO0TzCAkxzivcQrHTCzBLArS06p4hAXuobk48J36hNa1TTDMflMM8PDU0V9H0IjDaGoFk68w_hYBPvTGbkLC6E58yN7iAn9Zgxn3GCHR_9xenqJ9ElUAVzx9ufvHu7JpM3IRokGDHmOFQhgbm3ra7Kamzd0lVdao_nPVfFpBTUyBaECWbc6c6gbhkLH8ZgSviUPxHkUy1IulfVYUdA',
    imageAlt: 'High-end modern luxury resort W Goa in Vagator with elevated cliffside pool deck overlooking the Arabian Sea.',
    pricePerNight: 16400,
    totalPrice: 24600,
    nights: 3,
    roomType: 'Wonderful Room',
    features: ['Wonderful Room', 'Rock Pool Deck', 'Cocktail Lounge'],
    isBooked: false,
    cancellationPolicy: 'Flexible cancellation up to 48h',
  },
];

export const INITIAL_WEATHER: WeatherCondition = {
  temperatureCelsius: 31,
  feelsLikeCelsius: 33,
  conditionDescription: 'Sunny & Breezy',
  humidityPercent: 68,
  windSpeedKmh: '14 km/h • WSW Calm Swells',
  uvIndex: 8,
  uvDescription: 'UV Index • Sunscreen Advised',
  dailyForecast: [
    {
      dayNumber: 1,
      date: 'Apr 12',
      dayLabel: 'Day 1',
      icon: 'sunny',
      tempHigh: 31,
      tempLow: 24,
      rainChancePercent: 0,
      conditionText: '0% Rain',
    },
    {
      dayNumber: 2,
      date: 'Apr 13',
      dayLabel: 'Day 2',
      icon: 'partly_cloudy_day',
      tempHigh: 32,
      tempLow: 25,
      rainChancePercent: 5,
      conditionText: '5% Rain',
    },
    {
      dayNumber: 3,
      date: 'Apr 14',
      dayLabel: 'Day 3',
      icon: 'wb_sunny',
      tempHigh: 30,
      tempLow: 24,
      rainChancePercent: 0,
      conditionText: '0% Rain',
    },
    {
      dayNumber: 4,
      date: 'Apr 15',
      dayLabel: 'Day 4',
      icon: 'air',
      tempHigh: 31,
      tempLow: 24,
      rainChancePercent: 0,
      conditionText: 'Breezy',
    },
  ],
};

export const INITIAL_BUDGET: BudgetOverview = {
  totalBudget: 50000,
  allocatedExpenditure: 46800,
  unallocatedBuffer: 3200,
  consumptionPercentage: 93.6,
  currencySymbol: '₹',
  breakdown: [
    {
      category: 'Flights',
      allocatedAmount: 12900,
      percentage: 25.8,
      sublabel: '25.8% (2 Pax)',
      color: '#89ceff',
      colorName: 'primary',
    },
    {
      category: 'Accommodations',
      allocatedAmount: 21300,
      percentage: 42.6,
      sublabel: '42.6% (Taj Stay)',
      color: '#4edea3',
      colorName: 'tertiary',
    },
    {
      category: 'Gastronomy',
      allocatedAmount: 8400,
      percentage: 16.8,
      sublabel: '16.8% (Fine Dining)',
      color: '#c0c1ff',
      colorName: 'secondary',
    },
    {
      category: 'Activities & Spa',
      allocatedAmount: 4200,
      percentage: 8.4,
      sublabel: '8.4% (Cruise & Tours)',
      color: '#0ea5e9',
      colorName: 'primary-container',
    },
    {
      category: 'Safety Reserve',
      allocatedAmount: 3200,
      percentage: 6.4,
      sublabel: '6.4% Cash Buffer',
      color: '#88929b',
      colorName: 'outline',
    },
  ],
  savingsInsightTitle: 'TravelAI Dynamic Savings Insight',
  savingsInsightBody:
    'Booking your departure flight via GOI Dabolim instead of GOX saved ₹2,880 on transfer surcharges. Total package aligns with luxury tier parameters without exceeding the ceiling.',
};

export function createNewChatWelcomeMessage(): ChatMessage {
  return {
    id: `welcome-${Date.now()}`,
    sender: 'assistant',
    timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    text: "👋 Welcome to TravelAI! Where would you like to travel? Tell me your destination, duration, budget, or preferences, and I'll craft a bespoke itinerary for you.",
  };
}

export const INITIAL_CHAT_MESSAGES: ChatMessage[] = [
  {
    id: 'msg-1',
    sender: 'user',
    timestamp: '10:24 AM',
    text: 'Plan an unforgettable 4-day luxury trip to Goa for 2 people with a ₹50,000 budget. Include heritage forts, beach clubs, and fine seafood dining.',
  },
  {
    id: 'msg-2',
    sender: 'assistant',
    timestamp: '10:25 AM',
    richContent: {
      versionHeadline: 'Goa Coastal Architecture • v2.4',
      optimizationRate: 'Optimization 99.4%',
      leadParagraph:
        'I have compiled a premier 4-day bespoke coastal route combining Portuguese heritage architecture, sunset cruises on the Chapora River, and handpicked seafood gastronomy.',
      highlights: [
        {
          icon: 'flight_takeoff',
          category: 'Transit',
          detail: 'IndiGo non-stop flights synchronized with private chauffeur sedan.',
          color: 'primary',
        },
        {
          icon: 'hotel',
          category: 'Stay',
          detail: 'Taj Holiday Village Candolim (Sea-facing Cottage).',
          color: 'tertiary',
        },
        {
          icon: 'restaurant',
          category: 'Catering',
          detail: 'Reserved slots at Thalassa Vagator and Cavatina South Goa.',
          color: 'secondary',
        },
      ],
      actionButton: {
        label: 'Inspect Route & Logistics Matrix',
        tabTarget: 'route-tab',
        icon: 'visibility',
      },
    },
  },
  {
    id: 'msg-3',
    sender: 'user',
    timestamp: '10:28 AM',
    text: 'Can you recommend luxury beachfront stays in North Goa with infinity pools?',
  },
  {
    id: 'msg-4',
    sender: 'assistant',
    timestamp: '10:29 AM',
    richContent: {
      leadParagraph:
        'Selected two coastal sanctuaries matching your criteria with private pools, signature dining, and prompt checkout access:',
      hotelRecommendations: [
        {
          id: 'ht-w-goa-mini',
          name: 'W Goa',
          locationSnippet: 'Vagator Cliff Edge • Rock Pool',
          rating: 4.9,
          pricePerNight: '₹16,400',
          isApplied: false,
        },
        {
          id: 'ht-taj-mini',
          name: 'Taj Holiday Village',
          locationSnippet: 'Candolim Beachfront Villa',
          rating: 4.9,
          pricePerNight: '₹14,200',
          isApplied: true,
        },
      ],
    },
  },
];

export const INITIAL_CONVERSATIONS: ConversationHistoryItem[] = [
  { id: 'c-kyoto', title: 'Kyoto Cherry Blossoms 2025', timeAgo: '2h ago' },
  { id: 'c-amalfi', title: 'Amalfi Coast Road Trip', timeAgo: 'Yesterday' },
  { id: 'c-swiss', title: 'Swiss Alps Summer Trek', timeAgo: '3d ago' },
];

// -------------------------------------------------------------
// Preset Trips with Full Data (Preserves state across all pages)
// -------------------------------------------------------------
export const PRESET_TRIPS: any[] = [
  {
    id: 'goa-coastal-v24',
    title: 'Goa Coastal Splendor & Heritage',
    destination: 'Goa, India',
    days: 4,
    budget: 50000,
    preferences: 'Bespoke Circuit',
    planner_draft: '# Goa Coastal Splendor & Heritage\nNorth Coast • Old Goa • Chapora River',
    heroImageUrl: 'https://lh3.googleusercontent.com/aida-public/AB6AXuBlx7gAJoMQBXDwbj6pcwTqIFcYOsmHvoW4FP-ompYmqI5sdLnZA_V_Vo7s2KaplYKZasc62M2PUG1oCM8TH0Z07k10P6QveYrXQL7OAzs_LtZujhGa5DgZj2B1Lt83FtvfbX5cf4OzbSPNc0HxZSxA0n70yRDsXRUzj3Cs3tyKLFvOticj1qWp-a5SvwUFFe5M7wTtu3leSHjY1VvKgmhcc0WV-OM1qDNk60-lJxEzj7UZUxDQDjkCFg',
    flights: INITIAL_FLIGHTS,
    hotels: INITIAL_HOTELS,
    weather: INITIAL_WEATHER,
    budget_breakdown: INITIAL_BUDGET,
    route_details: INITIAL_ITINERARY_DAYS,
    status: 'Confirmed Plan',
  },
  {
    id: 'tokyo-explorer',
    title: 'Tokyo Explorer & High-Speed Transit',
    destination: 'Tokyo, Japan',
    days: 7,
    budget: 320000,
    preferences: 'High-Speed Transit & Modern Urban Culture',
    planner_draft: '# Tokyo Explorer & High-Speed Transit\nShinjuku • teamLab Planets • Hakone Onsen',
    heroImageUrl: 'https://images.unsplash.com/photo-1503899036084-c55cdd92da26?auto=format&fit=crop&w=800&q=80',
    flights: [
      {
        id: 'fl-hnd-101',
        airlineCode: 'JL',
        flightNumber: 'Japan Airlines JL-740',
        aircraft: 'Boeing 777-300ER • Direct Non-Stop',
        departureTime: '19:15',
        departureAirport: 'DEL (Indira Gandhi T3)',
        arrivalTime: '06:55',
        arrivalAirport: 'HND (Tokyo Haneda)',
        duration: '8h 10m',
        onTimePercent: 98,
        serviceType: 'Selected for Trip',
        baggageInfo: 'Includes 2x23kg Baggage + Japanese Gourmet Meal',
        pricePerPerson: 42000,
        currency: '₹',
        totalForPax: 84000,
        isSelected: true,
      },
      {
        id: 'fl-nrt-202',
        airlineCode: 'NH',
        flightNumber: 'ANA NH-828',
        aircraft: 'Boeing 787-9 Dreamliner',
        departureTime: '20:30',
        departureAirport: 'DEL (Terminal 3)',
        arrivalTime: '08:20',
        arrivalAirport: 'NRT (Tokyo Narita)',
        duration: '8h 20m',
        serviceType: 'Full Service Direct',
        baggageInfo: 'Includes 2x23kg Baggage + In-Flight WiFi',
        pricePerPerson: 46500,
        currency: '₹',
        totalForPax: 93000,
        isSelected: false,
      },
    ],
    hotels: [
      {
        id: 'ht-aman-tokyo',
        name: 'Aman Tokyo & Otemachi Garden',
        location: 'Otemachi, Chiyoda-ku, Tokyo',
        rating: 4.9,
        reviewCount: 940,
        imageUrl: 'https://images.unsplash.com/photo-1542314831-068cd1dbfeeb?auto=format&fit=crop&w=800&q=80',
        imageAlt: 'Luxury high-rise hotel suite overlooking Tokyo skyline and Mount Fuji.',
        pricePerNight: 48000,
        totalPrice: 288000,
        nights: 6,
        roomType: 'Premier Suite',
        features: ['Skyline Panoramic View', 'Traditional Onsen Spa', 'Michelin Kaiseki Dining', 'High-speed Metro Access'],
        isBooked: true,
      },
      {
        id: 'ht-park-hyatt-tokyo',
        name: 'Park Hyatt Tokyo, Shinjuku',
        location: 'Nishi-Shinjuku, Tokyo',
        rating: 4.8,
        reviewCount: 1120,
        imageUrl: 'https://images.unsplash.com/photo-1566073771259-6a8506099945?auto=format&fit=crop&w=800&q=80',
        imageAlt: 'Sleek luxury hotel overlooking Shinjuku neon metropolis.',
        pricePerNight: 42000,
        totalPrice: 252000,
        nights: 6,
        roomType: 'Deluxe King Room',
        features: ['Peak Bar Access', 'Indoor Sky Pool', 'Shinjuku Gyoen Views'],
        isBooked: false,
        cancellationPolicy: 'Flexible cancellation up to 48h',
      },
    ],
    weather: {
      temperatureCelsius: 18,
      feelsLikeCelsius: 17,
      conditionDescription: 'Mild & Clear Cherry Blossom Spring',
      humidityPercent: 52,
      windSpeedKmh: '9 km/h • Gentle Breeze',
      uvIndex: 5,
      uvDescription: 'UV Index • Low to Moderate',
      dailyForecast: [
        { dayNumber: 1, date: 'Apr 12', dayLabel: 'Day 1', icon: 'sunny', tempHigh: 19, tempLow: 11, rainChancePercent: 0, conditionText: 'Clear & Mild' },
        { dayNumber: 2, date: 'Apr 13', dayLabel: 'Day 2', icon: 'partly_cloudy_day', tempHigh: 18, tempLow: 12, rainChancePercent: 10, conditionText: 'Partly Cloudy' },
        { dayNumber: 3, date: 'Apr 14', dayLabel: 'Day 3', icon: 'wb_sunny', tempHigh: 21, tempLow: 13, rainChancePercent: 0, conditionText: 'Sunny Spring' },
        { dayNumber: 4, date: 'Apr 15', dayLabel: 'Day 4', icon: 'air', tempHigh: 17, tempLow: 10, rainChancePercent: 5, conditionText: 'Breezy' },
      ],
    },
    budget_breakdown: {
      totalBudget: 320000,
      allocatedExpenditure: 298000,
      unallocatedBuffer: 22000,
      consumptionPercentage: 93.1,
      currencySymbol: '¥',
      breakdown: [
        { category: 'Flights', allocatedAmount: 84000, percentage: 26.2, sublabel: '26.2% JAL Direct', color: '#89ceff', colorName: 'primary' },
        { category: 'Accommodations', allocatedAmount: 144000, percentage: 45.0, sublabel: '45.0% Aman Tokyo', color: '#4edea3', colorName: 'tertiary' },
        { category: 'Gastronomy', allocatedAmount: 42000, percentage: 13.1, sublabel: '13.1% Kaiseki & Omakase', color: '#c0c1ff', colorName: 'secondary' },
        { category: 'Activities & Spa', allocatedAmount: 28000, percentage: 8.8, sublabel: '8.8% Shinkansen & teamLab', color: '#0ea5e9', colorName: 'primary-container' },
        { category: 'Safety Reserve', allocatedAmount: 22000, percentage: 6.9, sublabel: '6.9% Cash Buffer', color: '#88929b', colorName: 'outline' },
      ],
      savingsInsightTitle: 'Shinkansen Gran Class Optimization',
      savingsInsightBody: 'JR Pass regional coverage saved ¥18,500 on the Hakone-Tokyo corridor.',
    },
    route_details: [
      {
        dayNumber: 1,
        date: 'Apr 12',
        title: 'Day 1: Arrival Haneda & Shinjuku Neon Nightscape',
        transitBadge: 'Executive Chauffeur Limousine',
        activities: [
          { timeOfDay: 'Morning', time: '08:30', title: 'Touchdown HND & Fast-track Transfer', description: 'VIP tarmac pickup and transfer to Aman Tokyo Otemachi.', categoryColor: 'primary' },
          { timeOfDay: 'Afternoon', time: '14:00', title: 'Meiji Jingu Shrine & Harajuku', description: 'Tranquil cedar forest walk through historic shrine grounds.', categoryColor: 'secondary' },
          { timeOfDay: 'Evening', time: '18:30', title: 'Shinjuku High-Altitude Omakase', description: 'Private sushi omakase overlooking the neon skyline.', categoryColor: 'tertiary' },
        ],
      },
      {
        dayNumber: 2,
        date: 'Apr 13',
        title: 'Day 2: teamLab Planets & Ginza Flagships',
        transitBadge: 'Private Chauffeur Sedan',
        activities: [
          { timeOfDay: 'Morning', time: '09:30', title: 'teamLab Planets Immersive Art', description: 'Private morning slot through barefoot water exhibitions in Toyosu.', categoryColor: 'primary' },
          { timeOfDay: 'Afternoon', time: '13:30', title: 'Ginza Haute Horlogerie & Tea Tasting', description: 'Artisanal matcha degustation and architectural stroll.', categoryColor: 'secondary' },
          { timeOfDay: 'Evening', time: '19:00', title: 'Roppongi Hills Sunset Observatory', description: 'Panoramic evening dusk view of Tokyo Tower and Roppongi.', categoryColor: 'tertiary' },
        ],
      },
      {
        dayNumber: 3,
        date: 'Apr 14',
        title: 'Day 3: Mount Fuji & Hakone Private Onsen Escape',
        transitBadge: 'Private Romancecar Express',
        activities: [
          { timeOfDay: 'Morning', time: '08:00', title: 'Lake Ashi Catamaran & Mt Fuji', description: 'Private boat excursion across Lake Ashi with Fuji vistas.', categoryColor: 'primary' },
          { timeOfDay: 'Afternoon', time: '13:00', title: 'Gora Hakone Mineral Spring', description: 'Outdoor thermal spring relaxation in bamboo forest pavilion.', categoryColor: 'secondary' },
          { timeOfDay: 'Evening', time: '19:30', title: 'Traditional Ryokan Multi-Course Feast', description: 'Multi-course seasonal Kaiseki dining featuring local wagyu.', categoryColor: 'tertiary' },
        ],
      },
    ],
    status: 'In Review',
  },
  {
    id: 'rajasthan-heritage',
    title: 'Rajasthan Royal Haveli Heritage',
    destination: 'Jaipur, India',
    days: 3,
    budget: 38000,
    preferences: 'Rajasthan Royal Haveli Heritage',
    planner_draft: '# Rajasthan Royal Haveli Heritage\nAmber Fort • City Palace • Jal Mahal',
    heroImageUrl: 'https://images.unsplash.com/photo-1477587458883-47145ed94245?auto=format&fit=crop&w=800&q=80',
    flights: [
      {
        id: 'fl-del-jai-01',
        airlineCode: '6E',
        flightNumber: 'IndiGo 6E-2194',
        aircraft: 'ATR 72-600 • Direct Express',
        departureTime: '07:45',
        departureAirport: 'DEL (Terminal 1D)',
        arrivalTime: '08:45',
        arrivalAirport: 'JAI (Jaipur Intl)',
        duration: '1h 00m',
        onTimePercent: 95,
        serviceType: 'Selected for Trip',
        baggageInfo: 'Includes 15kg Baggage + Priority Baggage Delivery',
        pricePerPerson: 3850,
        currency: '₹',
        totalForPax: 7700,
        isSelected: true,
      },
    ],
    hotels: [
      {
        id: 'ht-rambagh-palace',
        name: 'Rambagh Palace Jaipur',
        location: 'Bhawani Singh Road, Jaipur',
        rating: 4.9,
        reviewCount: 1450,
        imageUrl: 'https://images.unsplash.com/photo-1582719478250-c89cae4dc85b?auto=format&fit=crop&w=800&q=80',
        imageAlt: 'Grand royal heritage palace with Mughal gardens in Jaipur.',
        pricePerNight: 16500,
        totalPrice: 33000,
        nights: 2,
        roomType: 'Palace Room (Garden View)',
        features: ['Historical Heritage Suite', 'Royal Peacock Garden Walk', 'Jiva Spa Ayurvedic Therapy', 'Butler Service'],
        isBooked: true,
      },
    ],
    weather: {
      temperatureCelsius: 34,
      feelsLikeCelsius: 36,
      conditionDescription: 'Warm & Golden Desert Sunshine',
      humidityPercent: 35,
      windSpeedKmh: '11 km/h • Dry Continental',
      uvIndex: 9,
      uvDescription: 'UV Index • Very High',
      dailyForecast: [
        { dayNumber: 1, date: 'May 04', dayLabel: 'Day 1', icon: 'wb_sunny', tempHigh: 35, tempLow: 24, rainChancePercent: 0, conditionText: 'Sunny' },
        { dayNumber: 2, date: 'May 05', dayLabel: 'Day 2', icon: 'sunny', tempHigh: 36, tempLow: 25, rainChancePercent: 0, conditionText: 'Hot & Clear' },
        { dayNumber: 3, date: 'May 06', dayLabel: 'Day 3', icon: 'partly_cloudy_day', tempHigh: 34, tempLow: 23, rainChancePercent: 0, conditionText: 'Sunny' },
      ],
    },
    budget_breakdown: {
      totalBudget: 38000,
      allocatedExpenditure: 35200,
      unallocatedBuffer: 2800,
      consumptionPercentage: 92.6,
      currencySymbol: '₹',
      breakdown: [
        { category: 'Flights', allocatedAmount: 7700, percentage: 20.3, sublabel: '20.3% IndiGo Direct', color: '#89ceff', colorName: 'primary' },
        { category: 'Accommodations', allocatedAmount: 18000, percentage: 47.4, sublabel: '47.4% Rambagh Stay', color: '#4edea3', colorName: 'tertiary' },
        { category: 'Gastronomy', allocatedAmount: 5500, percentage: 14.5, sublabel: '14.5% Royal Thali Dining', color: '#c0c1ff', colorName: 'secondary' },
        { category: 'Activities & Spa', allocatedAmount: 4000, percentage: 10.5, sublabel: '10.5% Amber Fort & Palace', color: '#0ea5e9', colorName: 'primary-container' },
        { category: 'Safety Reserve', allocatedAmount: 2800, percentage: 7.3, sublabel: '7.3% Cash Buffer', color: '#88929b', colorName: 'outline' },
      ],
      savingsInsightTitle: 'Heritage Pass Advantage',
      savingsInsightBody: 'Composite heritage ticketing saved ₹1,600 on palace admissions.',
    },
    route_details: [
      {
        dayNumber: 1,
        date: 'May 04',
        title: 'Day 1: Pink City Gates & Hawa Mahal',
        transitBadge: 'Royal Chauffeur Sedan',
        activities: [
          { timeOfDay: 'Morning', time: '09:30', title: 'Hawa Mahal Sunrise Architecture', description: 'Early access to the Palace of Winds facade and rooftop cafe vista.', categoryColor: 'primary' },
          { timeOfDay: 'Afternoon', time: '13:00', title: 'City Palace Museum & Chandra Mahal', description: 'Private courtyard walkthrough of royal relics and textiles.', categoryColor: 'secondary' },
          { timeOfDay: 'Evening', time: '18:30', title: 'Suvarna Mahal Royal Dining', description: 'Authentic Rajasthani royal degustation under gilded ceilings.', categoryColor: 'tertiary' },
        ],
      },
      {
        dayNumber: 2,
        date: 'May 05',
        title: 'Day 2: Amber Fort Ramparts & Jal Mahal',
        transitBadge: 'Guided Escort Sedan',
        activities: [
          { timeOfDay: 'Morning', time: '08:30', title: 'Amber Fort Sheesh Mahal', description: 'Mirror palace exploration with local historian guide.', categoryColor: 'primary' },
          { timeOfDay: 'Afternoon', time: '14:00', title: 'Anokhi Handblock Printing Museum', description: 'Hands-on heritage textile workshop in historic haveli.', categoryColor: 'secondary' },
          { timeOfDay: 'Evening', time: '18:00', title: 'Jal Mahal Promenade Sunset', description: 'Sunset reflection photography over Man Sagar Lake.', categoryColor: 'tertiary' },
        ],
      },
      {
        dayNumber: 3,
        date: 'May 06',
        title: 'Day 3: Nahargarh Fort Panoramic & Departure',
        transitBadge: 'Airport Transfer Sedan',
        activities: [
          { timeOfDay: 'Morning', time: '09:00', title: 'Nahargarh Fort Aravalli Views', description: 'Panoramic cliffside view across the entire Pink City basin.', categoryColor: 'primary' },
          { timeOfDay: 'Afternoon', time: '12:30', title: 'Johari Bazaar Gem & Textile Walk', description: 'Curated shopping for blue pottery and silver jewelry.', categoryColor: 'secondary' },
          { timeOfDay: 'Evening', time: '17:00', title: 'JAI Airport Chauffeur Dropoff', description: 'Direct transfer to Jaipur International for return flight to DEL.', categoryColor: 'tertiary' },
        ],
      },
    ],
    status: 'Drafting',
  },
];

export const INITIAL_SAVED_TRIPS: SavedTripSnippet[] = PRESET_TRIPS.map((t) => ({
  id: t.id,
  name: t.title || `${t.destination} Circuit`,
  destinationTag: t.destination.split(',')[0],
  daysTag: `${t.days} Days`,
}));

// -------------------------------------------------------------
// Time formatting helper
// -------------------------------------------------------------
function formatTimeAgo(dateString?: string): string {
  if (!dateString) return 'Recently';
  try {
    const diffMs = Date.now() - new Date(dateString).getTime();
    const diffMins = Math.floor(diffMs / 60000);
    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    const diffDays = Math.floor(diffHours / 24);
    return `${diffDays}d ago`;
  } catch {
    return 'Recently';
  }
}

// -------------------------------------------------------------
// Pure Functions: Read from ACTIVE TRIP OBJECT (No Network Fetching)
// -------------------------------------------------------------

export function getTripStartDate(trip?: any): { dateObj: Date; isoDate: string; formattedDate: string } {
  const rawStart = trip?.start_date || trip?.startDate || trip?.travelContext?.start_date || trip?.travel_context?.start_date;
  let baseDate: Date | null = null;
  if (rawStart && typeof rawStart === 'string') {
    const parsed = new Date(rawStart);
    if (!isNaN(parsed.getTime())) {
      baseDate = parsed;
    } else {
      const m = rawStart.match(/([a-z]{3,9})[\s\-]*(\d{1,2})(?:[\s,]*(\d{4}))?/i) ||
                rawStart.match(/(\d{1,2})[\s\-]*([a-z]{3,9})(?:[\s,]*(\d{4}))?/i);
      if (m) {
        const monthNames = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
        const mStr = (isNaN(Number(m[1])) ? m[1] : m[2]).toLowerCase().slice(0, 3);
        const dayNum = isNaN(Number(m[1])) ? Number(m[2]) : Number(m[1]);
        const yearNum = Number(m[3]) || new Date().getFullYear();
        const mIdx = monthNames.findIndex((mo) => mStr.startsWith(mo));
        if (mIdx !== -1) {
          baseDate = new Date(yearNum, mIdx, dayNum);
        }
      }
    }
  }

  // Fallback: If no start_date specified, compute from today + 7 days
  if (!baseDate || isNaN(baseDate.getTime())) {
    const today = new Date();
    baseDate = new Date(today.getTime() + 7 * 24 * 60 * 60 * 1000);
  }

  const yyyy = baseDate.getFullYear();
  const mm = String(baseDate.getMonth() + 1).padStart(2, '0');
  const dd = String(baseDate.getDate()).padStart(2, '0');
  const isoDate = `${yyyy}-${mm}-${dd}`;
  const monthAbbr = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const formattedDate = `${dd} ${monthAbbr[baseDate.getMonth()]} ${yyyy}`;

  return { dateObj: baseDate, isoDate, formattedDate };
}

export function resolveAirportCode(place?: string, defaultCode = 'HYD'): string {
  if (!place || typeof place !== 'string') return defaultCode;
  const p = place.toLowerCase().trim();
  if (p.includes('hyd') || p.includes('hyderabad') || p.includes('begumpet')) return 'HYD';
  if (p.includes('cok') || p.includes('kochi') || p.includes('cochin') || p.includes('kerala') || p.includes('ernakulam')) return 'COK';
  if (p.includes('del') || p.includes('delhi') || p.includes('new delhi') || p.includes('ncr')) return 'DEL';
  if (p.includes('goa') || p.includes('goi') || p.includes('gox') || p.includes('dabolim') || p.includes('mopa')) return 'GOI';
  if (p.includes('bom') || p.includes('mumbai') || p.includes('bombay')) return 'BOM';
  if (p.includes('blr') || p.includes('bangalore') || p.includes('bengaluru')) return 'BLR';
  if (p.includes('maa') || p.includes('chennai') || p.includes('madras')) return 'MAA';
  if (p.includes('ccu') || p.includes('kolkata') || p.includes('calcutta')) return 'CCU';
  if (p.includes('jai') || p.includes('jaipur')) return 'JAI';
  if (p.includes('amd') || p.includes('ahmedabad')) return 'AMD';
  if (p.includes('pnq') || p.includes('pune')) return 'PNQ';
  if (p.includes('vns') || p.includes('varanasi') || p.includes('banaras')) return 'VNS';
  if (p.includes('sxr') || p.includes('srinagar') || p.includes('kashmir')) return 'SXR';
  if (p.includes('atq') || p.includes('amritsar')) return 'ATQ';
  if (p.includes('dxb') || p.includes('dubai')) return 'DXB';
  if (p.includes('sin') || p.includes('singapore')) return 'SIN';
  if (p.includes('bkk') || p.includes('bangkok') || p.includes('thailand')) return 'BKK';
  if (p.includes('tokyo') || p.includes('japan') || p.includes('hnd') || p.includes('nrt')) return 'HND';
  if (p.includes('paris') || p.includes('france') || p.includes('cdg')) return 'CDG';
  if (p.includes('london') || p.includes('uk') || p.includes('lhr')) return 'LHR';
  if (p.includes('bali') || p.includes('dps') || p.includes('indonesia')) return 'DPS';
  
  const m = place.match(/\b([A-Z]{3})\b/);
  if (m) return m[1];
  return defaultCode;
}

function getRouteScheduleData(depCode: string, arrCode: string) {
  const pair = `${depCode}-${arrCode}`;
  switch (pair) {
    case 'HYD-COK':
      return {
        duration: '1h 40m',
        flights: [
          { airlineCode: '6E', airlineName: 'IndiGo', flightNumber: '6E-6712', departureTime: '07:20 AM', arrivalTime: '09:00 AM', price: 4500, aircraft: 'Airbus A320neo • Direct Non-Stop' },
          { airlineCode: '6E', airlineName: 'IndiGo', flightNumber: '6E-531', departureTime: '09:55 AM', arrivalTime: '11:35 AM', price: 4800, aircraft: 'Airbus A321neo • Direct Non-Stop' },
          { airlineCode: '6E', airlineName: 'IndiGo', flightNumber: '6E-728', departureTime: '01:55 PM', arrivalTime: '03:35 PM', price: 4600, aircraft: 'Airbus A320neo • Direct Non-Stop' },
          { airlineCode: 'QP', airlineName: 'Akasa Air', flightNumber: 'QP-1342', departureTime: '10:45 AM', arrivalTime: '12:25 PM', price: 4100, aircraft: 'Boeing 737 MAX 8 • Direct Non-Stop' },
          { airlineCode: 'AI', airlineName: 'Air India', flightNumber: 'AI-518', departureTime: '04:30 PM', arrivalTime: '06:10 PM', price: 5200, aircraft: 'Airbus A321 • Full Service Direct' },
        ],
      };
    case 'COK-HYD':
      return {
        duration: '1h 40m',
        flights: [
          { airlineCode: '6E', airlineName: 'IndiGo', flightNumber: '6E-6713', departureTime: '09:35 AM', arrivalTime: '11:15 AM', price: 4500, aircraft: 'Airbus A320neo • Direct Non-Stop' },
          { airlineCode: '6E', airlineName: 'IndiGo', flightNumber: '6E-532', departureTime: '12:10 PM', arrivalTime: '01:50 PM', price: 4800, aircraft: 'Airbus A321neo • Direct Non-Stop' },
          { airlineCode: '6E', airlineName: 'IndiGo', flightNumber: '6E-729', departureTime: '04:10 PM', arrivalTime: '05:50 PM', price: 4600, aircraft: 'Airbus A320neo • Direct Non-Stop' },
          { airlineCode: 'QP', airlineName: 'Akasa Air', flightNumber: 'QP-1343', departureTime: '01:05 PM', arrivalTime: '02:45 PM', price: 4100, aircraft: 'Boeing 737 MAX 8 • Direct Non-Stop' },
          { airlineCode: 'AI', airlineName: 'Air India', flightNumber: 'AI-519', departureTime: '06:45 PM', arrivalTime: '08:25 PM', price: 5200, aircraft: 'Airbus A321 • Full Service Direct' },
        ],
      };
    case 'HYD-DEL':
      return {
        duration: '2h 15m',
        flights: [
          { airlineCode: '6E', airlineName: 'IndiGo', flightNumber: '6E-2012', departureTime: '06:00 AM', arrivalTime: '08:15 AM', price: 4800, aircraft: 'Airbus A321neo • Direct Non-Stop' },
          { airlineCode: 'AI', airlineName: 'Air India', flightNumber: 'AI-840', departureTime: '10:15 AM', arrivalTime: '12:35 PM', price: 5500, aircraft: 'Boeing 787-8 • Full Service Direct' },
          { airlineCode: 'QP', airlineName: 'Akasa Air', flightNumber: 'QP-1422', departureTime: '05:20 PM', arrivalTime: '07:45 PM', price: 4600, aircraft: 'Boeing 737 MAX 8 • Direct Non-Stop' },
        ],
      };
    case 'DEL-HYD':
      return {
        duration: '2h 20m',
        flights: [
          { airlineCode: '6E', airlineName: 'IndiGo', flightNumber: '6E-2013', departureTime: '09:00 AM', arrivalTime: '11:20 AM', price: 4800, aircraft: 'Airbus A321neo • Direct Non-Stop' },
          { airlineCode: 'AI', airlineName: 'Air India', flightNumber: 'AI-841', departureTime: '01:30 PM', arrivalTime: '03:50 PM', price: 5500, aircraft: 'Boeing 787-8 • Full Service Direct' },
          { airlineCode: 'QP', airlineName: 'Akasa Air', flightNumber: 'QP-1423', departureTime: '08:25 PM', arrivalTime: '10:45 PM', price: 4600, aircraft: 'Boeing 737 MAX 8 • Direct Non-Stop' },
        ],
      };
    case 'HYD-GOI':
      return {
        duration: '1h 20m',
        flights: [
          { airlineCode: '6E', airlineName: 'IndiGo', flightNumber: '6E-344', departureTime: '07:10 AM', arrivalTime: '08:30 AM', price: 4100, aircraft: 'ATR 72-600 • Direct Non-Stop' },
          { airlineCode: 'QP', airlineName: 'Akasa Air', flightNumber: 'QP-1123', departureTime: '11:00 AM', arrivalTime: '12:20 PM', price: 4300, aircraft: 'Boeing 737 MAX 8 • Direct Non-Stop' },
          { airlineCode: 'AI', airlineName: 'Air India', flightNumber: 'AI-622', departureTime: '03:45 PM', arrivalTime: '05:05 PM', price: 5100, aircraft: 'Airbus A320neo • Full Service Direct' },
        ],
      };
    case 'GOI-HYD':
      return {
        duration: '1h 20m',
        flights: [
          { airlineCode: '6E', airlineName: 'IndiGo', flightNumber: '6E-345', departureTime: '09:10 AM', arrivalTime: '10:30 AM', price: 4100, aircraft: 'ATR 72-600 • Direct Non-Stop' },
          { airlineCode: 'QP', airlineName: 'Akasa Air', flightNumber: 'QP-1124', departureTime: '01:00 PM', arrivalTime: '02:20 PM', price: 4300, aircraft: 'Boeing 737 MAX 8 • Direct Non-Stop' },
          { airlineCode: 'AI', airlineName: 'Air India', flightNumber: 'AI-623', departureTime: '05:45 PM', arrivalTime: '07:05 PM', price: 5100, aircraft: 'Airbus A320neo • Full Service Direct' },
        ],
      };
    case 'HYD-BOM':
      return {
        duration: '1h 30m',
        flights: [
          { airlineCode: '6E', airlineName: 'IndiGo', flightNumber: '6E-5341', departureTime: '06:30 AM', arrivalTime: '08:00 AM', price: 3800, aircraft: 'Airbus A320neo • Direct Non-Stop' },
          { airlineCode: 'AI', airlineName: 'Air India', flightNumber: 'AI-618', departureTime: '11:15 AM', arrivalTime: '12:45 PM', price: 4600, aircraft: 'Airbus A321 • Full Service Direct' },
          { airlineCode: 'QP', airlineName: 'Akasa Air', flightNumber: 'QP-1144', departureTime: '05:00 PM', arrivalTime: '06:30 PM', price: 3950, aircraft: 'Boeing 737 MAX 8 • Direct Non-Stop' },
        ],
      };
    case 'HYD-BLR':
      return {
        duration: '1h 10m',
        flights: [
          { airlineCode: '6E', airlineName: 'IndiGo', flightNumber: '6E-405', departureTime: '07:00 AM', arrivalTime: '08:10 AM', price: 3200, aircraft: 'Airbus A320neo • Direct Non-Stop' },
          { airlineCode: 'QP', airlineName: 'Akasa Air', flightNumber: 'QP-1502', departureTime: '12:00 PM', arrivalTime: '01:10 PM', price: 3400, aircraft: 'Boeing 737 MAX 8 • Direct Non-Stop' },
          { airlineCode: 'AI', airlineName: 'Air India', flightNumber: 'AI-512', departureTime: '06:15 PM', arrivalTime: '07:25 PM', price: 4100, aircraft: 'Airbus A321 • Full Service Direct' },
        ],
      };
    case 'DEL-GOI':
      return {
        duration: '2h 25m',
        flights: [
          { airlineCode: '6E', airlineName: 'IndiGo', flightNumber: '6E-204', departureTime: '08:15 AM', arrivalTime: '10:40 AM', price: 6450, aircraft: 'Airbus A321neo • Direct Non-Stop' },
          { airlineCode: 'AI', airlineName: 'Air India', flightNumber: 'AI-883', departureTime: '11:10 AM', arrivalTime: '01:45 PM', price: 7890, aircraft: 'Boeing 787-8 • Full Service Direct' },
          { airlineCode: 'QP', airlineName: 'Akasa Air', flightNumber: 'QP-1341', departureTime: '02:20 PM', arrivalTime: '04:50 PM', price: 5920, aircraft: 'Boeing 737 MAX 8 • Express Direct' },
        ],
      };
    default:
      return {
        duration: '2h 10m',
        flights: [
          { airlineCode: '6E', airlineName: 'IndiGo', flightNumber: '6E-512', departureTime: '06:15 AM', arrivalTime: '08:25 AM', price: 4500, aircraft: 'Airbus A320 • Direct Non-Stop' },
          { airlineCode: 'QP', airlineName: 'Akasa Air', flightNumber: 'QP-1342', departureTime: '09:45 AM', arrivalTime: '11:55 AM', price: 4200, aircraft: 'Boeing 737 MAX 8 • Direct Non-Stop' },
          { airlineCode: 'AI', airlineName: 'Air India', flightNumber: 'AI-840', departureTime: '04:30 PM', arrivalTime: '06:40 PM', price: 5400, aircraft: 'Airbus A321 • Full Service Direct' },
        ],
      };
  }
}

export function computeTripDates(trip?: any, daysCount?: number): string[] {
  const days = daysCount || Number(trip?.days || trip?.daysCount || 3);
  const { dateObj } = getTripStartDate(trip);

  const resultDates: string[] = [];
  const monthAbbr = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  for (let i = 0; i < days; i++) {
    const d = new Date(dateObj.getTime() + i * 24 * 60 * 60 * 1000);
    resultDates.push(`${monthAbbr[d.getMonth()]} ${d.getDate()}`);
  }
  return resultDates;
}

export function fetchFlightOptions(trip?: any): FlightOption[] {
  const destStr = trip?.destination || trip?.travelContext?.destination || trip?.travel_context?.destination || 'Goa';
  const originStr = trip?.origin || trip?.travelContext?.origin || trip?.travel_context?.origin || 'Hyderabad';
  const travelersCount = Number(trip?.travelers || trip?.travelersCount || trip?.travelContext?.travelers || 2);
  const currency = trip?.currency || trip?.travelContext?.currency || 'INR';
  const currencySymbol = currency === 'USD' ? '$' : currency === 'EUR' ? '€' : '₹';

  const depCode = resolveAirportCode(originStr, 'HYD');
  const arrCode = resolveAirportCode(destStr, 'GOI');
  const { isoDate, formattedDate } = getTripStartDate(trip);
  const scheduleData = getRouteScheduleData(depCode, arrCode);

  if (trip && trip.flights && Array.isArray(trip.flights) && trip.flights.length > 0) {
    return trip.flights.map((f: any, idx: number) => {
      const matchedSchedule = scheduleData.flights.find(sf => sf.flightNumber.toLowerCase() === (f.flightNumber || f.flight_no || '').toLowerCase()) || scheduleData.flights[idx % scheduleData.flights.length];

      let rawPrice = typeof f.price === 'number' ? f.price : (parseFloat(f.price) || matchedSchedule?.price || 4500);
      if (currency === 'INR' && rawPrice < 1500) {
        rawPrice = matchedSchedule ? matchedSchedule.price : (4200 + (idx * 650));
      } else if (currency === 'USD' && rawPrice < 30) {
        rawPrice = 75 + (idx * 20);
      }
      const fAirlineCode = f.airlineCode || f.airline_code || matchedSchedule?.airlineCode || (idx === 0 ? '6E' : idx === 1 ? 'QP' : 'AI');
      const fAirlineName = f.airline || f.airlineName || matchedSchedule?.airlineName || (fAirlineCode === '6E' ? 'IndiGo' : fAirlineCode === 'AI' ? 'Air India' : fAirlineCode === 'QP' ? 'Akasa Air' : 'Airline');
      const fFlightNumber = f.flightNumber || f.flight_no || matchedSchedule?.flightNumber || (idx === 0 ? '6E-6712' : idx === 1 ? '6E-531' : 'AI-518');
      const fDep = f.departureAirport || f.origin || depCode;
      const fArr = f.arrivalAirport || f.destination || arrCode;
      const fDepCode = resolveAirportCode(fDep, depCode);
      const fArrCode = resolveAirportCode(fArr, arrCode);
      
      const isHydCokMismatch = depCode === 'HYD' && arrCode === 'COK' && (f.duration === '2h 30m' || f.departureTime === '06:00 AM');
      const departureTime = isHydCokMismatch ? matchedSchedule?.departureTime : (f.departureTime || f.departure || matchedSchedule?.departureTime || '07:20 AM');
      const arrivalTime = isHydCokMismatch ? matchedSchedule?.arrivalTime : (f.arrivalTime || f.arrival || matchedSchedule?.arrivalTime || '09:00 AM');
      const duration = isHydCokMismatch ? scheduleData.duration : (f.duration || scheduleData.duration || '1h 40m');
      const aircraft = f.aircraft || matchedSchedule?.aircraft || 'Direct Non-Stop';

      const googleFlightsUrl = `https://www.google.com/travel/flights?q=Flights%20to%20${fArrCode}%20from%20${fDepCode}%20on%20${isoDate}`;
      const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(`${fAirlineName} ${fFlightNumber} ${fDepCode} to ${fArrCode} ${isoDate}`)}`;

      return {
        id: f.id || `fl-${idx}`,
        airlineCode: fAirlineCode,
        airlineName: fAirlineName,
        flightNumber: fFlightNumber,
        aircraft,
        departureTime,
        departureAirport: fDepCode,
        departureDate: formattedDate,
        departureDateIso: isoDate,
        arrivalTime,
        arrivalAirport: fArrCode,
        duration,
        onTimePercent: f.onTimePercent || (idx === 0 ? 98 : idx === 1 ? 96 : 94),
        serviceType: f.serviceType || 'Standard Class',
        baggageInfo: f.baggageInfo || 'Includes 15kg Checked Baggage',
        pricePerPerson: rawPrice,
        currency: currencySymbol,
        totalForPax: rawPrice * travelersCount,
        isSelected: idx === 0,
        googleFlightsUrl,
        searchUrl,
        bookingUrl: googleFlightsUrl,
      };
    });
  }

  // Realistic route-specific default flights
  return scheduleData.flights.map((f, idx) => {
    let fare = f.price;
    if (currency === 'USD') {
      fare = Math.round(fare / 80);
    } else if (currency === 'EUR') {
      fare = Math.round(fare / 90);
    }
    const googleFlightsUrl = `https://www.google.com/travel/flights?q=Flights%20to%20${arrCode}%20from%20${depCode}%20on%20${isoDate}`;
    const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(`${f.airlineName} ${f.flightNumber} ${depCode} to ${arrCode} ${isoDate}`)}`;

    return {
      id: `fl-${idx + 1}`,
      airlineCode: f.airlineCode,
      airlineName: f.airlineName,
      flightNumber: f.flightNumber,
      aircraft: f.aircraft,
      departureTime: f.departureTime,
      departureAirport: depCode,
      departureDate: formattedDate,
      departureDateIso: isoDate,
      arrivalTime: f.arrivalTime,
      arrivalAirport: arrCode,
      duration: scheduleData.duration,
      onTimePercent: idx === 0 ? 98 : idx === 1 ? 96 : 94,
      serviceType: idx === 0 ? 'Standard Class' : idx === 1 ? 'Economy Saver' : 'Flexi Plus',
      baggageInfo: idx === 2 ? 'Includes 25kg Checked Baggage' : 'Includes 15kg Checked Baggage',
      pricePerPerson: fare,
      currency: currencySymbol,
      totalForPax: fare * travelersCount,
      isSelected: idx === 0,
      googleFlightsUrl,
      searchUrl,
      bookingUrl: googleFlightsUrl,
    };
  });
}

export function fetchHotelOptions(trip?: any): HotelOption[] {
  const dest = trip?.destination || 'Goa';
  const days = Number(trip?.days || trip?.daysCount || 3);
  const nights = Math.max(1, days - 1);
  const currency = trip?.currency || trip?.travelContext?.currency || 'INR';
  const userBudget = typeof trip?.budget === 'number' ? trip.budget : (currency === 'INR' ? 70000 : 1000);

  const targetNightly = Math.round((userBudget * 0.40) / nights);
  const defaultNightly = currency === 'INR' ? Math.max(4500, Math.min(18000, targetNightly)) : Math.max(70, Math.min(300, targetNightly));

  if (trip && trip.hotels && Array.isArray(trip.hotels) && trip.hotels.length > 0) {
    return trip.hotels.map((h: any, idx: number) => {
      let nightly = typeof h.price_per_night === 'number' ? h.price_per_night : (typeof h.price === 'number' ? h.price : defaultNightly);
      if (currency === 'INR' && nightly < 1500) {
        nightly = defaultNightly + (idx * 1200);
      } else if (currency === 'USD' && nightly < 35) {
        nightly = defaultNightly + (idx * 25);
      }
      return {
        id: h.id || `ht-${idx}`,
        name: h.name || h.hotel_name || `${dest} Boutique Resort & Spa`,
        location: h.location || h.address || dest,
        rating: typeof h.rating === 'number' ? h.rating : (parseFloat(h.rating) || 4.8),
        reviewCount: h.reviewCount || 1020,
        imageUrl: h.imageUrl || (idx % 2 === 0 ? INITIAL_HOTELS[0].imageUrl : INITIAL_HOTELS[1].imageUrl),
        imageAlt: h.name || 'Hotel stay',
        pricePerNight: nightly,
        totalPrice: nightly * nights,
        nights,
        roomType: h.room_type || h.roomType || (idx === 0 ? 'Deluxe Ocean View Villa' : 'Executive Suite'),
        features: Array.isArray(h.features) ? h.features : (Array.isArray(h.amenities) ? h.amenities : ['Infinity Pool', 'Breakfast Included', 'Ocean/City View', 'Free High-Speed WiFi']),
        isBooked: idx === 0,
        cancellationPolicy: h.cancellationPolicy || 'Flexible cancellation up to 24h prior',
      };
    });
  }

  return [
    {
      id: 'ht-1',
      name: `Taj Holiday Village Resort & Spa, ${dest}`,
      location: `Beachfront / Candolim, ${dest}`,
      rating: 4.9,
      reviewCount: 1450,
      imageUrl: INITIAL_HOTELS[0].imageUrl,
      imageAlt: 'Taj Resort',
      pricePerNight: defaultNightly,
      totalPrice: defaultNightly * nights,
      nights,
      roomType: 'Deluxe Heritage Cottage',
      features: ['Private Beach Access', 'Infinity Pool', 'Complimentary Breakfast', 'Luxury Jiva Spa'],
      isBooked: true,
      cancellationPolicy: 'Flexible cancellation up to 24h prior',
    },
    {
      id: 'ht-2',
      name: `The Leela Beach Resort, ${dest}`,
      location: `South Coast / Cavelossim, ${dest}`,
      rating: 4.8,
      reviewCount: 1120,
      imageUrl: INITIAL_HOTELS[1].imageUrl,
      imageAlt: 'The Leela Resort',
      pricePerNight: Math.round(defaultNightly * 1.15),
      totalPrice: Math.round(defaultNightly * 1.15) * nights,
      nights,
      roomType: 'Lagoon Terrace Suite',
      features: ['Golf Course', 'Private Lagoon & Beach', 'Fine Dining Pavilions', 'Free High-Speed WiFi'],
      isBooked: false,
      cancellationPolicy: 'Free cancellation until 48 hours before check-in',
    },
    {
      id: 'ht-3',
      name: `Heritage Village Resort & Spa, ${dest}`,
      location: `Arossim Beach, ${dest}`,
      rating: 4.7,
      reviewCount: 890,
      imageUrl: INITIAL_HOTELS[0].imageUrl,
      imageAlt: 'Heritage Resort',
      pricePerNight: Math.round(defaultNightly * 0.85),
      totalPrice: Math.round(defaultNightly * 0.85) * nights,
      nights,
      roomType: 'Grand Club Room',
      features: ['Swimming Pool', 'Ayurvedic Spa', 'Bicycle Tours', 'Breakfast Included'],
      isBooked: false,
      cancellationPolicy: 'Free cancellation up to 24h prior',
    },
  ];
}

export function fetchWeatherCondition(trip?: any): WeatherCondition | null {
  const daysCount = Number(trip?.days || trip?.daysCount || 4);
  const formattedDates = computeTripDates(trip, daysCount);
  const w = trip?.weather;

  const currentTemp = w?.temperatureCelsius ?? (typeof w?.average_temp === 'string' ? parseInt(w.average_temp, 10) : (w?.temp ?? 31));
  const currentCondition = w?.conditionDescription ?? (w?.condition || 'Sunny & Pleasant');
  const humidity = w?.humidityPercent ?? (w?.humidity ?? 68);

  const forecast = formattedDates.map((dateStr, i) => ({
    dayNumber: i + 1,
    date: dateStr,
    dayLabel: `Day ${i + 1}`,
    icon: (i % 3 === 0) ? 'sunny' : (i % 3 === 1 ? 'partly-cloudy' : 'windy'),
    tempHigh: currentTemp + (i % 2 === 0 ? 0 : 1),
    tempLow: currentTemp - 7,
    rainChancePercent: (currentCondition.toLowerCase().includes('rain') || currentCondition.toLowerCase().includes('drizzle')) ? 40 : (i === 1 ? 5 : 0),
    conditionText: currentCondition,
  }));

  return {
    temperatureCelsius: currentTemp,
    feelsLikeCelsius: currentTemp + 2,
    conditionDescription: currentCondition,
    humidityPercent: humidity,
    windSpeedKmh: w?.windSpeedKmh ?? (w?.wind_speed ? `${w.wind_speed} km/h` : '14 km/h'),
    uvIndex: w?.uvIndex ?? 8,
    uvDescription: w?.uvDescription ?? 'UV Index • Moderate',
    dailyForecast: forecast,
  };
}

export function fetchBudgetOverview(trip?: any): BudgetOverview | null {
  const travelers = Number(trip?.travelers || trip?.travelersCount || trip?.travelContext?.travelers || 2);
  const days = Number(trip?.days || trip?.daysCount || 3);
  const nights = Math.max(1, days - 1);
  const currency = trip?.currency || trip?.travelContext?.currency || 'INR';
  const currencySymbol = currency === 'USD' ? '$' : currency === 'EUR' ? '€' : '₹';

  const totalBudget = typeof trip?.budget === 'number'
    ? trip.budget
    : (typeof trip?.travelContext?.budget === 'number'
      ? trip.travelContext.budget
      : (currency === 'INR' ? 70000 : 1000));

  const flightAmount = Math.round(totalBudget * 0.26);
  const accommodationAmount = Math.round(totalBudget * 0.38);
  const gastronomyAmount = Math.round(totalBudget * 0.18);
  const activitiesAmount = Math.round(totalBudget * 0.10);
  const allocatedExpenditure = flightAmount + accommodationAmount + gastronomyAmount + activitiesAmount;
  const unallocatedBuffer = Math.max(0, totalBudget - allocatedExpenditure);
  const consumptionPercentage = Number(((allocatedExpenditure / totalBudget) * 100).toFixed(1));

  const flightPercent = Number(((flightAmount / totalBudget) * 100).toFixed(1));
  const hotelPercent = Number(((accommodationAmount / totalBudget) * 100).toFixed(1));
  const gastroPercent = Number(((gastronomyAmount / totalBudget) * 100).toFixed(1));
  const actPercent = Number(((activitiesAmount / totalBudget) * 100).toFixed(1));
  const bufferPercent = Number(((unallocatedBuffer / totalBudget) * 100).toFixed(1));

  const hotelName = (trip?.hotels && trip.hotels[0]?.name) || 'Curated Resort Stay';

  return {
    totalBudget,
    allocatedExpenditure,
    unallocatedBuffer,
    consumptionPercentage,
    currencySymbol,
    travelersCount: travelers,
    breakdown: [
      {
        category: 'Flights',
        allocatedAmount: flightAmount,
        percentage: flightPercent,
        sublabel: `${flightPercent}% (${travelers} Pax)`,
        color: '#4B88FF',
        colorName: 'primary',
      },
      {
        category: 'Accommodations',
        allocatedAmount: accommodationAmount,
        percentage: hotelPercent,
        sublabel: `${hotelPercent}% (${nights} Nights)`,
        color: '#00D68F',
        colorName: 'tertiary',
      },
      {
        category: 'Gastronomy',
        allocatedAmount: gastronomyAmount,
        percentage: gastroPercent,
        sublabel: `${gastroPercent}% (Curated Dining)`,
        color: '#FFB800',
        colorName: 'secondary',
      },
      {
        category: 'Activities & Spa',
        allocatedAmount: activitiesAmount,
        percentage: actPercent,
        sublabel: `${actPercent}% (Sightseeing & Tours)`,
        color: '#8A56FF',
        colorName: 'primary-container',
      },
      {
        category: 'Safety Reserve',
        allocatedAmount: unallocatedBuffer,
        percentage: bufferPercent,
        sublabel: `${bufferPercent}% (Unallocated Buffer)`,
        color: '#718096',
        colorName: 'outline',
      },
    ],
    savingsInsightTitle: 'TravelAI Budget Optimization',
    savingsInsightBody: 'Allocated parameters aligned with destination tier without exceeding the ceiling.',
  };
}

export interface ParsedUserMessageMeta {
  travelers?: number;
  budget?: number;
  days?: number;
  destination?: string;
  origin?: string;
  adults?: number;
  children?: number;
  infants?: number;
  currency?: string;
}

export interface ExplicitChatbotSlots {
  origin?: string;
  destination?: string;
  hasDestinationIntent?: boolean;
  budget?: number;
  currency?: string;
  days?: number;
  startDate?: string;
  endDate?: string;
  travelers?: number;
  adults?: number;
  children?: number;
  infants?: number;
  preferences?: string[];
  travelStyle?: string;
  budgetMode?: string;
}

const COMMON_VERBS = [
  'travel', 'go', 'fly', 'book', 'make', 'plan', 'change', 'be', 'stay',
  'spend', 'do', 'see', 'eat', 'take', 'have', 'explore', 'visit', 'relax'
];

const KNOWN_INTEREST_WORDS = [
  'beaches', 'beach', 'temples', 'temple', 'nature', 'food', 'nightlife',
  'adventure', 'history', 'shopping', 'relaxation', 'spa', 'wildlife', 'culture'
];

export function parseExplicitChatbotSlots(message?: string): ExplicitChatbotSlots {
  if (!message || typeof message !== 'string') return {};
  const lower = message.toLowerCase().trim();
  const res: ExplicitChatbotSlots = {};

  // 1. Origin / Source:
  // "from Hyderabad to Japan", "start from Bengaluru", "starting from X", "departing from X", "origin is X"
  const fromToMatch = lower.match(/\b(?:from|starting from|start from|departing from|depart from)\s+([a-z\s]+?)(?:\s+(?:to|for|with|under|on|in|during)\b|\s*,\s*|$|\.)/i);
  if (fromToMatch) {
    const raw = fromToMatch[1].trim();
    if (raw && !['here', 'my', 'the', 'home'].includes(raw)) {
      res.origin = raw.split(/\s+/).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
    }
  } else {
    const originMatch = lower.match(/\b(?:origin|source)\s+(?:is|=|to)?\s*([a-z\s]+?)(?:\s+(?:to|for|with|under|on|in)\b|\s*,\s*|$|\.)/i);
    if (originMatch) {
      const raw = originMatch[1].trim();
      if (raw) {
        res.origin = raw.split(/\s+/).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
      }
    }
  }

  // 2. Destination:
  // "to Japan", "destination to Delhi", "change the destination to Delhi", "trip to Japan", "visit Japan"
  const toMatch = lower.match(/\b(?:to|destination(?:\s+(?:is|to|=))?|visit|head to|going to)\s+([a-z\s]+?)(?:\s+(?:for|with|under|on|from|during|around|approx)\b|\s*,\s*|$|\.)/i);
  if (toMatch) {
    let raw = toMatch[1].trim();
    raw = raw.replace(/^(?:visit|see|explore|experience|check out|travel to|go to)\s+/i, '').trim();
    const words = raw.toLowerCase().split(/\s+/);
    if (
      raw &&
      !['a', 'the', 'some', 'our', 'my'].includes(raw.toLowerCase()) &&
      !(words.length === 1 && (COMMON_VERBS.includes(words[0]) || KNOWN_INTEREST_WORDS.includes(words[0])))
    ) {
      res.destination = raw.split(/\s+/).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
      res.hasDestinationIntent = true;
    }
  }

  // 3. Budget & Currency:
  // "Increase the budget to ₹400,000", "Make it ₹400,000", "budget 30k", "budget of 20000"
  const lakhMatch = lower.match(/(?:[₹$€£]|rs\.?|inr|usd)?\s*([\d\.]+)\s*(?:lakh|lac)/i);
  if (lakhMatch) {
    res.budget = parseFloat(lakhMatch[1]) * 100000;
  } else {
    const kMatch = lower.match(/(?:[₹$€£]|rs\.?|inr|usd)?\s*(\d+)\s*k\b/i);
    if (kMatch) {
      res.budget = parseInt(kMatch[1], 10) * 1000;
    } else {
      const numBudgetMatch = lower.match(/(?:budget|make it|increase(?: the budget)? to|increase to|under|around|for)\s*(?:is|=|of)?\s*(?:[₹$€£]|rs\.?|inr|usd)?\s*([\d,]{4,})/i);
      if (numBudgetMatch) {
        res.budget = parseInt(numBudgetMatch[1].replace(/,/g, ''), 10);
      } else {
        const directCurMatch = lower.match(/(?:[₹$€£]|rs\.?|inr|usd)\s*([\d,]{4,})/i);
        if (directCurMatch) {
          res.budget = parseInt(directCurMatch[1].replace(/,/g, ''), 10);
        }
      }
    }
  }

  if (lower.includes('$') || lower.includes('usd') || lower.includes('dollar')) res.currency = 'USD';
  else if (lower.includes('€') || lower.includes('eur') || lower.includes('euro')) res.currency = 'EUR';
  else if (lower.includes('£') || lower.includes('gbp') || lower.includes('pound')) res.currency = 'GBP';
  else if (lower.includes('₹') || lower.includes('inr') || lower.includes('rupee') || lower.includes('rs.')) res.currency = 'INR';

  // 4. Duration / Days:
  // "Make the trip 2 days", "Plan it for 2 days", "for 2 days"
  const daysMatch = lower.match(/(?:for|make it|make the trip|duration of?|plan it for)\s*(\d+)\s*(?:days?|d\b)/i) ||
                    lower.match(/\b(\d+)\s*(?:days?|d\b)(?!\s*pax|\s*people|\s*members)/i);
  if (daysMatch) {
    res.days = parseInt(daysMatch[1], 10);
  }

  // Explicit Date Range (e.g. "12 Jan to 21 Jan", "2027-01-12 to 2027-01-21")
  const dateRangeIso = lower.match(/(\d{4}-\d{2}-\d{2})\s*(?:to|–|-)\s*(\d{4}-\d{2}-\d{2})/);
  if (dateRangeIso) {
    res.startDate = dateRangeIso[1];
    res.endDate = dateRangeIso[2];
  } else {
    const textDates = lower.match(/(\d{1,2}\s+[a-z]{3,}(?:\s+\d{4})?)\s*(?:to|–|-)\s*(\d{1,2}\s+[a-z]{3,}\s+\d{4})/i);
    if (textDates) {
      res.startDate = textDates[1];
      res.endDate = textDates[2];
    }
  }

  // 5. Travelers / Adults / Children:
  const adultMatch = lower.match(/(\d+)\s*(?:adults?|grown-?ups?)/i);
  const childMatch = lower.match(/(\d+)\s*(?:children|kids?|child)/i);
  const infantMatch = lower.match(/(\d+)\s*(?:infants?|toddlers?|babies|baby)/i);
  const paxMatch = lower.match(/(\d+)\s*(?:members?|people|travelers?|travellers?|persons?|pax)/i);

  if (adultMatch || childMatch || infantMatch) {
    if (adultMatch) res.adults = parseInt(adultMatch[1], 10);
    if (childMatch) res.children = parseInt(childMatch[1], 10);
    if (infantMatch) res.infants = parseInt(infantMatch[1], 10);
    res.travelers = (res.adults || 0) + (res.children || 0) + (res.infants || 0);
  } else if (paxMatch) {
    res.travelers = parseInt(paxMatch[1], 10);
  }

  // 6. Interests / Preferences:
  const interestKeywords = [
    { name: 'Beaches', re: /\bbeach(?:es)?\b/i },
    { name: 'Temples', re: /\btemple(?:s)?\b/i },
    { name: 'Heritage', re: /\bheritage|monuments?|historic\b/i },
    { name: 'History', re: /\bhistory|historical\b/i },
    { name: 'Nature', re: /\bnature|scenic|wildlife|mountains?\b/i },
    { name: 'Food', re: /\bfood|restaurants?|culinary|dining\b/i },
    { name: 'Adventure', re: /\badventure|trekking|hiking|watersports\b/i },
    { name: 'Nightlife', re: /\bnightlife|clubs?|bars?\b/i },
    { name: 'Shopping', re: /\bshopping|markets?\b/i },
    { name: 'Relaxation', re: /\brelax(?:ation)?|spa|wellness\b/i },
  ];
  const foundInterests: string[] = [];
  for (const kw of interestKeywords) {
    if (kw.re.test(lower)) {
      foundInterests.push(kw.name);
    }
  }
  if (foundInterests.length > 0) {
    res.preferences = foundInterests;
  }

  return res;
}

export interface TripConstraintCheckResult {
  isPlanRequest: boolean;
  hasWhere: boolean;
  hasWhen: boolean;
  hasBudget: boolean;
  hasTravelers: boolean;
  hasInterests: boolean;
  isFullySatisfied: boolean;
  mergedContext: Record<string, any>;
  guidanceMessage?: string;
}

export function checkTripPlanningConstraints(
  message: string,
  currentContext?: Record<string, any> | null
): TripConstraintCheckResult {
  const lower = message.toLowerCase().trim();
  const explicit = parseExplicitChatbotSlots(message);
  const merged = mergeTravelContexts(currentContext, null, message);

  // Check if this is a general informational question (e.g. "What is the best time to visit Paris?")
  const isInformationalQuery =
    /^(?:what|how|why|when|where|who|tell me|is there|are there|can you tell|describe|explain)\b/i.test(lower) &&
    !/\b(?:plan|itinerary|schedule|curate|build)\b/i.test(lower);

  // Check if this is a trip planning request or continuation of one
  const planKeywords = /\b(?:plan|itinerary|trip|vacation|holiday|tour|travel to|bespoke|getaway|schedule a trip|book a trip|craft|curate)\b/i;
  const isDirectPlanRequest = !isInformationalQuery && planKeywords.test(lower);
  
  // A continuation is when the user provides constraints (budget, travelers, dates, preferences) when a destination or partial context is already established
  const hasEstablishedContext = Boolean(currentContext?.destination || currentContext?.days || currentContext?.budget);
  const providesConstraints = Boolean(
    explicit.budget !== undefined ||
    explicit.travelers !== undefined ||
    explicit.adults !== undefined ||
    explicit.days !== undefined ||
    explicit.startDate !== undefined ||
    (explicit.preferences && explicit.preferences.length > 0)
  );
  
  const isPlanRequest = isDirectPlanRequest || (hasEstablishedContext && providesConstraints);

  // If not a trip planning request at all (e.g. general FAQ, "hello", etc.), it shouldn't be blocked by constraints
  if (!isPlanRequest) {
    return {
      isPlanRequest: false,
      hasWhere: false,
      hasWhen: false,
      hasBudget: false,
      hasTravelers: false,
      hasInterests: false,
      isFullySatisfied: true,
      mergedContext: merged,
    };
  }

  const hasWhere = Boolean(
    merged.destination &&
    typeof merged.destination === 'string' &&
    merged.destination.trim() !== '' &&
    merged.destination.toLowerCase() !== 'where to?'
  );
  const hasWhen = Boolean(
    (merged.days && Number(merged.days) > 0) ||
    (merged.start_date && merged.end_date)
  );
  const hasBudget = Boolean(merged.budget !== undefined && merged.budget !== null && Number(merged.budget) > 0);
  const hasTravelers = Boolean(
    (merged.travelers !== undefined && merged.travelers !== null && Number(merged.travelers) > 0) ||
    (merged.adults !== undefined && merged.adults !== null && Number(merged.adults) > 0)
  );
  const hasInterests = Boolean(
    (Array.isArray(merged.preferences) && merged.preferences.length > 0) ||
    (merged.travel_style && typeof merged.travel_style === 'string')
  );

  // If all core constraints (Where, When, Budget, Travelers) are present, it is fully satisfied to generate!
  const isFullySatisfied = hasWhere && hasWhen && hasBudget && hasTravelers;

  if (isFullySatisfied) {
    return {
      isPlanRequest: true,
      hasWhere,
      hasWhen,
      hasBudget,
      hasTravelers,
      hasInterests,
      isFullySatisfied: true,
      mergedContext: merged,
    };
  }

  // Case 1: No Where AND no When (User asked to plan a trip with zero/minimal constraints)
  if (!hasWhere && !hasWhen) {
    const guidanceMessage = `To help me craft your bespoke itinerary, please provide your trip details or configure them in the preference bar above:
- 📍 **Where**: Departure city & destination (e.g. *Hyderabad to Delhi*)
- 📅 **When**: Travel dates or duration (e.g. *4 Days, 3 Nights*)
- 💰 **Budget**: Estimated total budget (e.g. *₹50,000*)
- 👥 **Travelers**: Number of adults & children (e.g. *2 Adults, 1 Child*)
- ✨ **Interests**: Preferred travel style & activities (e.g. *Beaches, Heritage, Food*)`;

    return {
      isPlanRequest: true,
      hasWhere,
      hasWhen,
      hasBudget,
      hasTravelers,
      hasInterests,
      isFullySatisfied: false,
      mergedContext: merged,
      guidanceMessage,
    };
  }

  // Case 2: Where and When are present, but missing Budget, Travelers, or Interests
  if (hasWhere && hasWhen) {
    const missingItems: string[] = [];
    if (!hasBudget) {
      missingItems.push('- 💰 **Budget**: Estimated total budget (e.g. *₹30,000* or click **Set Budget** above)');
    }
    if (!hasTravelers) {
      missingItems.push('- 👥 **Travelers**: Number of travelers (e.g. *2 Adults, 1 Child* or click **Add Travelers** above)');
    }
    if (!hasInterests) {
      missingItems.push('- ✨ **Interests**: Trip preferences (e.g. *Heritage, Food, Culture* or click **Add Interests** above)');
    }

    const destLabel = merged.origin ? `${merged.origin} → ${merged.destination}` : merged.destination;
    let durationLabel = '';
    if (merged.start_date && merged.end_date) {
      durationLabel = `${merged.start_date} to ${merged.end_date}`;
    } else if (merged.days) {
      const d = Number(merged.days);
      const n = Math.max(1, d - 1);
      durationLabel = `${d} Days, ${n} ${n === 1 ? 'Night' : 'Nights'}`;
    }

    const guidanceMessage = `Great choice! I've noted your trip to **${destLabel}** for **${durationLabel}**.\n\nTo tailor the best flights, accommodations, and curated day-by-day activities, please provide the remaining details:\n${missingItems.join('\n')}\n\nYou can reply directly here or configure them using the preference controls above!`;

    return {
      isPlanRequest: true,
      hasWhere,
      hasWhen,
      hasBudget,
      hasTravelers,
      hasInterests,
      isFullySatisfied: false,
      mergedContext: merged,
      guidanceMessage,
    };
  }

  // Case 3: Where is present, but When is missing (and possibly Budget/Travelers/Interests)
  if (hasWhere && !hasWhen) {
    const missingItems: string[] = [
      '- 📅 **When**: Travel dates or duration (e.g. *4 Days, 3 Nights* or click **Select Dates** above)'
    ];
    if (!hasBudget) {
      missingItems.push('- 💰 **Budget**: Estimated total budget (e.g. *₹50,000* or click **Set Budget** above)');
    }
    if (!hasTravelers) {
      missingItems.push('- 👥 **Travelers**: Number of travelers (e.g. *2 Adults, 1 Child* or click **Add Travelers** above)');
    }
    if (!hasInterests) {
      missingItems.push('- ✨ **Interests**: Trip preferences (e.g. *Heritage, Food, Beaches* or click **Add Interests** above)');
    }

    const destLabel = merged.origin ? `${merged.origin} → ${merged.destination}` : merged.destination;
    const guidanceMessage = `Great! I've noted your destination as **${destLabel}**.\n\nPlease provide your travel timing and remaining details to build your itinerary:\n${missingItems.join('\n')}\n\nYou can reply directly here or configure them using the preference controls above!`;

    return {
      isPlanRequest: true,
      hasWhere,
      hasWhen,
      hasBudget,
      hasTravelers,
      hasInterests,
      isFullySatisfied: false,
      mergedContext: merged,
      guidanceMessage,
    };
  }

  // Case 4: When is present, but Where is missing
  const missingItems: string[] = [
    '- 📍 **Where**: Departure city & destination (e.g. *Hyderabad to Delhi*)'
  ];
  if (!hasBudget) {
    missingItems.push('- 💰 **Budget**: Estimated total budget (e.g. *₹50,000*)');
  }
  if (!hasTravelers) {
    missingItems.push('- 👥 **Travelers**: Number of travelers (e.g. *2 Adults, 1 Child*)');
  }
  if (!hasInterests) {
    missingItems.push('- ✨ **Interests**: Trip preferences (e.g. *Heritage, Food, Beaches*)');
  }

  const guidanceMessage = `I see you are planning a **${merged.days} Day** trip! Where would you like to go?\n\nPlease provide your destination and other trip details:\n${missingItems.join('\n')}\n\nYou can reply directly here or configure them in the preference bar above!`;

  return {
    isPlanRequest: true,
    hasWhere,
    hasWhen,
    hasBudget,
    hasTravelers,
    hasInterests,
    isFullySatisfied: false,
    mergedContext: merged,
    guidanceMessage,
  };
}

export function buildChatPromptWithFallbackContext(
  userMessage: string,
  currentContext?: Record<string, any> | null
): string {
  if (!currentContext) return userMessage;
  const explicit = parseExplicitChatbotSlots(userMessage);
  const fallbackParts: string[] = [];

  // If user didn't specify origin, but preference bar has origin
  if (!explicit.origin && currentContext.origin) {
    fallbackParts.push(`Origin: ${currentContext.origin}`);
  }
  // If user didn't specify destination, but preference bar has destination
  if (!explicit.destination && currentContext.destination) {
    const destStr = Array.isArray(currentContext.destination)
      ? currentContext.destination.join(', ')
      : currentContext.destination;
    fallbackParts.push(`Destination: ${destStr}`);
  }
  // If user didn't specify duration or dates, but preference bar has them
  if (!explicit.days && !explicit.startDate && (currentContext.days || (currentContext.start_date && currentContext.end_date))) {
    if (currentContext.start_date && currentContext.end_date) {
      fallbackParts.push(`Dates: ${currentContext.start_date} to ${currentContext.end_date}${currentContext.days ? ` (${currentContext.days} days)` : ''}`);
    } else if (currentContext.days) {
      fallbackParts.push(`Duration: ${currentContext.days} days`);
    }
  }
  // If user didn't specify budget, but preference bar has budget
  if (explicit.budget === undefined && currentContext.budget !== undefined && currentContext.budget !== null) {
    fallbackParts.push(`Budget: ${currentContext.budget} ${currentContext.currency || 'INR'}`);
  }
  // If user didn't specify travelers or adults, but preference bar has travelers
  if (explicit.travelers === undefined && explicit.adults === undefined && (currentContext.travelers !== undefined || currentContext.adults !== undefined)) {
    const tCount = currentContext.travelers || ((currentContext.adults || 0) + (currentContext.children || 0) + (currentContext.infants || 0));
    const paxDetails: string[] = [];
    if (currentContext.adults) paxDetails.push(`${currentContext.adults} ${currentContext.adults === 1 ? 'adult' : 'adults'}`);
    if (currentContext.children) paxDetails.push(`${currentContext.children} ${currentContext.children === 1 ? 'child' : 'children'}`);
    if (currentContext.infants) paxDetails.push(`${currentContext.infants} ${currentContext.infants === 1 ? 'infant' : 'infants'}`);
    const detailsStr = paxDetails.length > 0 ? ` (${paxDetails.join(', ')})` : '';
    fallbackParts.push(`Travelers: ${tCount}${detailsStr}`);
  }
  // If user didn't specify interests, but preference bar has preferences
  if (!explicit.preferences && Array.isArray(currentContext.preferences) && currentContext.preferences.length > 0) {
    fallbackParts.push(`Interests: ${currentContext.preferences.join(', ')}`);
  }

  if (fallbackParts.length > 0) {
    return `${userMessage}\n[Context: ${fallbackParts.join(' | ')}]`;
  }
  return userMessage;
}

export function mergeTravelContexts(
  preferenceContext?: Record<string, any> | null,
  backendContext?: Record<string, any> | null,
  userMessage?: string
): Record<string, any> {
  const pref = preferenceContext || {};
  const back = backendContext || {};
  const explicit = parseExplicitChatbotSlots(userMessage);

  const merged: Record<string, any> = { ...pref };

  // 1. Origin: Chatbot explicit wins > preference bar > backend
  if (explicit.origin) {
    merged.origin = explicit.origin;
  } else if (pref.origin) {
    merged.origin = pref.origin;
  } else if (back.origin) {
    merged.origin = back.origin;
  }

  // 2. Destination: Chatbot explicit wins > backend if user had destination intent > preference bar > backend
  if (explicit.destination) {
    merged.destination = explicit.destination;
  } else if (back.destination && (!pref.destination || explicit.hasDestinationIntent)) {
    merged.destination = back.destination;
  } else if (pref.destination) {
    merged.destination = pref.destination;
  } else if (back.destination) {
    merged.destination = back.destination;
  }

  // 3. Dates & Duration:
  // If the chatbot explicitly specifies duration (e.g. "Make the trip 2 days"):
  // override days and clear previously fixed date bounds if they don't match.
  if (explicit.days) {
    merged.days = explicit.days;
    if (explicit.startDate && explicit.endDate) {
      merged.start_date = explicit.startDate;
      merged.end_date = explicit.endDate;
    } else {
      delete merged.start_date;
      delete merged.end_date;
    }
  } else if (explicit.startDate && explicit.endDate) {
    merged.start_date = explicit.startDate;
    merged.end_date = explicit.endDate;
  } else if (pref.start_date && pref.end_date) {
    merged.start_date = pref.start_date;
    merged.end_date = pref.end_date;
    merged.days = pref.days;
  } else if (pref.days) {
    merged.days = pref.days;
  } else if (back.days && !pref.start_date && !pref.end_date) {
    merged.days = back.days;
  }

  // 4. Budget & Currency:
  // If chatbot specifies budget, chatbot wins; else preserve preference bar; else backend.
  if (explicit.budget !== undefined && explicit.budget !== null) {
    merged.budget = explicit.budget;
    if (explicit.currency) merged.currency = explicit.currency;
  } else if (pref.budget !== undefined && pref.budget !== null) {
    merged.budget = pref.budget;
    merged.currency = pref.currency || back.currency || 'INR';
  } else if (back.budget !== undefined && back.budget !== null) {
    merged.budget = back.budget;
    merged.currency = back.currency || 'INR';
  }

  // 5. Travelers / Pax:
  // If chatbot specifies travelers/adults/children, chatbot wins; else preserve preference bar.
  if (explicit.adults !== undefined || explicit.children !== undefined || explicit.travelers !== undefined) {
    if (explicit.adults !== undefined) merged.adults = explicit.adults;
    else delete merged.adults;
    if (explicit.children !== undefined) merged.children = explicit.children;
    else delete merged.children;
    if (explicit.infants !== undefined) merged.infants = explicit.infants;
    else delete merged.infants;
    merged.travelers = explicit.travelers ?? ((explicit.adults || 0) + (explicit.children || 0) + (explicit.infants || 0));
  } else if (pref.adults !== undefined || pref.children !== undefined || pref.travelers !== undefined) {
    merged.adults = pref.adults;
    merged.children = pref.children;
    merged.infants = pref.infants ?? 0;
    merged.travelers = pref.travelers ?? ((pref.adults || 0) + (pref.children || 0) + (pref.infants || 0));
  } else if (back.travelers !== undefined) {
    merged.travelers = back.travelers;
  }

  // 6. Interests / Preferences:
  // If chatbot specifies interests, merge them with preference bar; else preserve preference bar.
  if (explicit.preferences && explicit.preferences.length > 0) {
    const existing = Array.isArray(pref.preferences) ? pref.preferences : [];
    merged.preferences = Array.from(new Set([...existing, ...explicit.preferences]));
  } else if (Array.isArray(pref.preferences) && pref.preferences.length > 0) {
    merged.preferences = pref.preferences;
  } else if (Array.isArray(back.preferences) && back.preferences.length > 0) {
    merged.preferences = back.preferences;
  }

  // 7. Travel Style & Budget Mode: DO NOT invent defaults!
  if (explicit.travelStyle) {
    merged.travel_style = explicit.travelStyle;
  } else if (pref.travel_style) {
    merged.travel_style = pref.travel_style;
  } else {
    delete merged.travel_style;
  }

  if (explicit.budgetMode) {
    merged.budget_mode = explicit.budgetMode;
  } else if (pref.budget_mode) {
    merged.budget_mode = pref.budget_mode;
  } else {
    delete merged.budget_mode;
  }

  return merged;
}

export function parseMetadataFromUserMessage(userMessage?: string): ParsedUserMessageMeta {
  if (!userMessage || typeof userMessage !== 'string') return {};
  const slots = parseExplicitChatbotSlots(userMessage);
  return {
    travelers: slots.travelers,
    budget: slots.budget,
    days: slots.days,
    destination: slots.destination,
    origin: slots.origin,
    adults: slots.adults,
    children: slots.children,
    infants: slots.infants,
    currency: slots.currency,
  };
}

export function extractTripSummary(trip?: any): TripSummary {
  if (!trip) return INITIAL_TRIP;
  const parsedMeta = parseMetadataFromUserMessage(trip.user_message);
  const rawBudget = typeof trip.budget === 'number'
    ? trip.budget
    : (typeof trip.travelContext?.budget === 'number'
      ? trip.travelContext.budget
      : (typeof trip.travel_context?.budget === 'number'
        ? trip.travel_context.budget
        : (typeof parsedMeta.budget === 'number' ? parsedMeta.budget : null)));
  const currency = trip.currency || trip.travelContext?.currency || trip.travel_context?.currency || 'INR';
  const currencySymbol = currency === 'USD' ? '$' : currency === 'EUR' ? '€' : '₹';
  const budgetEstimate = trip.budgetEstimate || (
    rawBudget !== null
      ? `${currencySymbol}${rawBudget.toLocaleString()} Est. Budget`
      : '₹50,000 Est. Budget'
  );
  const travelersCount = trip.travelers || trip.travelersCount || trip.travelContext?.travelers || trip.travel_context?.travelers || parsedMeta.travelers || 2;
  const daysNum = trip.days || trip.daysCount || parsedMeta.days || 3;
  const nightsNum = Math.max(1, daysNum - 1);
  const travelStyle = trip.travel_style || trip.travelStyle || trip.travelContext?.travel_style || trip.travel_context?.travel_style;
  const budgetMode = trip.budget_mode || trip.budgetMode || trip.travelContext?.budget_mode || trip.travel_context?.budget_mode;

  return {
    id: trip.id || 'active-trip',
    title: trip.destination ? `${trip.destination} Curated Itinerary` : INITIAL_TRIP.title,
    destination: trip.destination || INITIAL_TRIP.destination,
    duration: `${daysNum} Days, ${nightsNum} ${nightsNum === 1 ? 'Night' : 'Nights'}`,
    daysCount: daysNum,
    nightsCount: nightsNum,
    travelersCount,
    budgetEstimate,
    status: 'Confirmed Plan',
    heroImageUrl: trip.heroImageUrl || INITIAL_TRIP.heroImageUrl,
    bespokeCircuitLabel: trip.preferences || (travelStyle ? `${travelStyle} Tier` : 'Bespoke Circuit'),
    activeWaypointsCount: Array.isArray(trip.attractions) && trip.attractions.length > 0 ? trip.attractions.length : 4,
    routeHeadline: trip.planner_draft ? (trip.planner_draft.split('\n')[0].replace(/^#+\s*/, '') || trip.destination) : INITIAL_TRIP.routeHeadline,
    travelStyle: travelStyle || undefined,
    budgetMode: budgetMode || undefined,
  };
}

export function extractItineraryDays(trip?: any): ItineraryDay[] {
  if (!trip) return INITIAL_ITINERARY_DAYS;

  const daysNum = Number(trip.days || trip.daysCount || 3);
  const formattedDates = computeTripDates(trip, daysNum);
  const destName = trip.destination ? trip.destination.split(',')[0] : 'Destination';

  const parseCoord = (val: any): number | undefined => {
    if (val === undefined || val === null || val === '') return undefined;
    const num = Number(val);
    return isNaN(num) ? undefined : num;
  };

  // 1. If route_details is available from backend LLM / route_agent
  const dailyRoutes = Array.isArray(trip.route_details)
    ? trip.route_details
    : (trip.route_details?.day_by_day_route || trip.route_details?.days);

  if (Array.isArray(dailyRoutes) && dailyRoutes.length > 0) {
    return dailyRoutes.map((d: any, idx: number) => {
      // If stops exist as normalized objects {name, lat, lon, type} or strings
      const activities: ActivitySegment[] = Array.isArray(d.stops) && d.stops.length > 0
        ? d.stops.map((stop: any, sIdx: number) => {
            const isObj = typeof stop === 'object' && stop !== null;
            const title = isObj ? (stop.name || stop.title || 'Scheduled Stop') : String(stop);
            const lat = isObj ? parseCoord(stop.lat) : undefined;
            const lon = isObj ? parseCoord(stop.lon) : undefined;
            const timeOfDay: 'Morning' | 'Afternoon' | 'Evening' = sIdx === 0 ? 'Morning' : sIdx === 1 ? 'Afternoon' : 'Evening';
            const categoryColor: 'primary' | 'secondary' | 'tertiary' = sIdx === 0 ? 'primary' : sIdx === 1 ? 'secondary' : 'tertiary';

            return {
              timeOfDay,
              time: sIdx === 0 ? '09:00' : sIdx === 1 ? '13:30' : '18:00',
              title,
              description: (isObj && stop.description) ? stop.description : (d.travel_tips || `Curated stop in ${destName}.`),
              categoryColor,
              location: destName,
              thumbnail: isObj ? stop.image_url : undefined,
              rating: isObj && stop.rating ? Number(stop.rating) : undefined,
              reviews: isObj && stop.review_count ? Number(stop.review_count) : undefined,
              operatingHours: isObj ? stop.opening_hours : undefined,
              lat,
              lon,
            };
          })
        : (Array.isArray(d.activities) ? d.activities : []);

      return {
        ...d,
        dayNumber: idx + 1,
        date: formattedDates[idx] || `Day ${idx + 1}`,
        title: d.title || `Day ${idx + 1}: ${destName} Exploration & Sightseeing`,
        transitBadge: d.is_flight_day ? '✈️ Flight Day' : 'Curated Private Chauffeur',
        activities,
      };
    });
  }

  // 2. Fallback: Parse attractions, restaurants, and hotels into structured days
  const attractions = Array.isArray(trip.attractions) ? trip.attractions : [];
  const restaurants = Array.isArray(trip.restaurants) ? trip.restaurants : [];
  const hotels = Array.isArray(trip.hotels) ? trip.hotels : [];

  const days: ItineraryDay[] = [];
  for (let i = 1; i <= daysNum; i++) {
    const curDate = formattedDates[i - 1] || `Day ${i}`;
    const dayAttraction = attractions[i - 1] || (attractions.length > 0 ? attractions[(i - 1) % attractions.length] : null);
    const dayDining = restaurants[i - 1] || (restaurants.length > 0 ? restaurants[(i - 1) % restaurants.length] : null);
    const dayHotel = hotels[0] || null;

    let dayTitle = `Day ${i}: ${destName} Highlights & Exploration`;
    if (i === 1) {
      dayTitle = `Day 1: Arrival & ${destName} Coastal Highlights`;
    } else if (i === daysNum) {
      dayTitle = `Day ${i}: Heritage, Leisure & Departure`;
    } else if (i === 2) {
      dayTitle = `Day 2: Historical Landmarks & Cultural Quarter`;
    } else if (i === 3) {
      dayTitle = `Day 3: Scenic Island Cruise & Fine Dining`;
    }

    days.push({
      dayNumber: i,
      date: curDate,
      title: dayTitle,
      transitBadge: i === 1 ? 'Airport Chauffeur Transfer' : 'Curated Private Chauffeur',
      activities: [
        {
          timeOfDay: 'Morning',
          time: '09:00',
          title: dayAttraction ? (dayAttraction.name || dayAttraction.title || 'Morning Exploration') : `Morning Heritage Tour in ${destName}`,
          description: dayAttraction?.description || `Explore the historic landmarks and scenic viewpoints of ${destName}.`,
          categoryColor: 'primary',
          location: dayAttraction?.address || destName,
          thumbnail: dayAttraction?.thumbnail || dayAttraction?.image || dayAttraction?.image_url,
          lat: parseCoord(dayAttraction?.lat),
          lon: parseCoord(dayAttraction?.lon),
          rating: dayAttraction?.rating || 4.7,
          reviews: dayAttraction?.reviews || (dayAttraction?.rating ? 342 : undefined),
          recommendedTimeSpent: dayAttraction?.recommended_time_spent || '1.5 - 2 Hours',
          entranceFee: dayAttraction?.entrance_fee !== undefined ? Number(dayAttraction.entrance_fee) : 0,
          operatingStatus: dayAttraction?.status?.toUpperCase() || undefined,
          operatingHours: dayAttraction?.opening_hours || undefined,
          scheduledDate: dayAttraction?.scheduled_date || undefined,
          dayOfWeek: dayAttraction?.day_of_week || undefined,
          statusReason: dayAttraction?.reason || undefined,
        },
        {
          timeOfDay: 'Afternoon',
          time: '13:30',
          title: dayDining ? (dayDining.name || 'Artisanal Culinary Experience') : `Gastronomy & Local Dining`,
          description: dayDining?.description || (dayDining?.cuisine ? `Authentic ${dayDining.cuisine} dining experience.` : `Curated lunch tasting local delicacies.`),
          categoryColor: 'secondary',
          location: dayDining?.address || destName,
          thumbnail: dayDining?.thumbnail || dayDining?.image || dayDining?.image_url,
          lat: parseCoord(dayDining?.lat),
          lon: parseCoord(dayDining?.lon),
          rating: dayDining?.rating || 4.6,
          cuisine: dayDining?.cuisine || 'Regional Delicacies',
          recommendedTimeSpent: '1 - 1.5 Hours',
        },
        {
          timeOfDay: 'Evening',
          time: '18:00',
          title: i === 1 ? `Sunset Check-in at ${dayHotel?.name || 'Hotel'}` : 'Sunset Panoramic Spot & Evening Stroll',
          description: i === 1 ? `Check-in at ${dayHotel?.name || 'resort'} followed by evening cocktail and leisure hour.` : `Panoramic sunset vista and vibrant evening stroll through ${destName}.`,
          categoryColor: 'tertiary',
          location: dayHotel?.location || destName,
          thumbnail: dayHotel?.imageUrl || dayHotel?.thumbnail,
          lat: parseCoord(dayHotel?.lat),
          lon: parseCoord(dayHotel?.lon),
          rating: dayHotel?.rating || 4.8,
          recommendedTimeSpent: 'Evening Leisure',
        },
      ],
    });
  }
  return days;
}

// Pure helper for trip itinerary without network call
export function selectTripItinerary(trip?: any): {
  trip: TripSummary;
  days: ItineraryDay[];
} {
  return {
    trip: extractTripSummary(trip),
    days: extractItineraryDays(trip),
  };
}

// -------------------------------------------------------------
// Real FastAPI REST Endpoints (ONLY the 7 verified routes)
// -------------------------------------------------------------

// 1. POST /api/trips/plan
export interface PlanTripRequest {
  user_message?: string;
  destination?: string;
  days?: number;
  budget?: number;
  preferences?: string;
}

export async function createTripPlan(payload: PlanTripRequest): Promise<any> {
  return await apiFetch<any>('/api/trips/plan', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

// 2. GET /api/trips/history
export async function fetchTripHistory(): Promise<any[]> {
  return await apiFetch<any[]>('/api/trips/history');
}

export async function fetchSavedTripsList(): Promise<SavedTripSnippet[]> {
  let deletedTripIds: string[] = [];
  try {
    deletedTripIds = JSON.parse(localStorage.getItem('TRAVELAI_DELETED_TRIP_IDS') || '[]');
  } catch {}

  try {
    const history = await fetchTripHistory();
    if (Array.isArray(history)) {
      return history
        .map((doc: any, idx: number) => ({
          id: doc.id || doc._id || `trip-${idx}`,
          name: doc.destination ? `${doc.destination} Circuit` : `Itinerary #${idx + 1}`,
          destinationTag: doc.destination || 'India',
          daysTag: `${doc.days || 3} Days`,
        }))
        .filter((t) => !deletedTripIds.includes(t.id));
    }
    return INITIAL_SAVED_TRIPS.filter((t) => !deletedTripIds.includes(t.id));
  } catch {
    return INITIAL_SAVED_TRIPS.filter((t) => !deletedTripIds.includes(t.id));
  }
}

export async function deleteTrip(tripId: string): Promise<void> {
  // If it's a client preset or temporary trip, it is not on the server
  if (!tripId || tripId.startsWith('trip-') || ['goa-coastal-v24', 'tokyo-explorer', 'paris-weekend', 'new-york-culture', 'swiss-alps-adventure'].includes(tripId)) {
    return;
  }
  try {
    await apiFetch<any>(`/api/trips/${tripId}`, {
      method: 'DELETE',
    });
  } catch (err: any) {
    const msg = (err?.message || '').toLowerCase();
    if (msg.includes('not found') || msg.includes('404')) {
      return;
    }
    throw err;
  }
}

// 3. POST /api/chat/message (EXACTLY { message, conversation_id })
export interface ChatMessageResponsePayload {
  conversation_id: string;
  message: {
    role: string;
    content: string;
  };
  intent?: string;
  travel_context?: Record<string, any>;
  data?: {
    type?: string;
    trip_id?: string;
    itinerary?: any;
  } | null;
}

export async function sendChatMessage(
  prompt: string,
  conversationId?: string | null
): Promise<{ replyMessage: ChatMessage; rawResponse: ChatMessageResponsePayload }> {
  const requestBody: { message: string; conversation_id?: string } = {
    message: prompt,
  };
  if (conversationId && !conversationId.startsWith('c-') && conversationId.trim() !== '') {
    requestBody.conversation_id = conversationId;
  }

  console.log('[CHAT DEBUG] sendChatMessage: sending POST /api/chat/message with body:', requestBody);

  try {
    const res = await apiFetch<ChatMessageResponsePayload>('/api/chat/message', {
      method: 'POST',
      body: JSON.stringify(requestBody),
    });

    console.log('[CHAT DEBUG] sendChatMessage: received response from /api/chat/message:', res);

    const replyMessage: ChatMessage = {
      id: `assistant-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      sender: 'assistant',
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      text: res.message?.content || 'Acknowledged.',
    };

    return { replyMessage, rawResponse: res };
  } catch (err) {
    console.error('[CHAT DEBUG] sendChatMessage: failed to POST /api/chat/message:', err);
    throw err;
  }
}

// 4. GET /api/chat/conversations
export async function fetchConversationsList(): Promise<ConversationHistoryItem[]> {
  let deletedIds: string[] = [];
  try {
    deletedIds = JSON.parse(localStorage.getItem('TRAVELAI_DELETED_CONVERSATIONS') || '[]');
  } catch {}

  try {
    const convs = await apiFetch<any[]>('/api/chat/conversations');
    if (Array.isArray(convs)) {
      return convs
        .map((c: any) => ({
          id: c.conversation_id,
          title: c.title || 'Travel Conversation',
          timeAgo: formatTimeAgo(c.updated_at),
        }))
        .filter((c) => !deletedIds.includes(c.id));
    }
    return INITIAL_CONVERSATIONS.filter((c) => !deletedIds.includes(c.id));
  } catch {
    return INITIAL_CONVERSATIONS.filter((c) => !deletedIds.includes(c.id));
  }
}

// 5. GET /api/chat/conversations/{id}
export async function fetchConversationDetail(conversationId: string): Promise<any> {
  // If it's a client preset, it is not on the server
  if (conversationId.startsWith('c-')) {
    return null;
  }
  return await apiFetch<any>(`/api/chat/conversations/${conversationId}`);
}


// 6. DELETE /api/chat/conversations/{id}
export async function deleteConversation(conversationId: string): Promise<void> {
  // If it's a client preset, it does not exist in MongoDB
  if (conversationId.startsWith('c-')) {
    return;
  }
  try {
    await apiFetch<any>(`/api/chat/conversations/${conversationId}`, {
      method: 'DELETE',
    });
  } catch (err: any) {
    // If conversation is already not found (404), it is successfully absent from MongoDB
    const msg = (err?.message || '').toLowerCase();
    if (msg.includes('not found') || msg.includes('404')) {
      return;
    }
    throw err;
  }
}
