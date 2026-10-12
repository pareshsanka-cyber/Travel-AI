import { useState, useEffect, useCallback, MouseEvent, useRef } from 'react';
import {
  TripSummary,
  ItineraryDay,
  ActivitySegment,
  PlaceMemoryItem,
  FlightOption,
  HotelOption,
  WeatherCondition,
  BudgetOverview,
  ChatMessage,
  ApiStatusState,
  SavedTripSnippet,
  ConversationHistoryItem
} from '../types';
import {
  checkFastApiHealth,
  fetchHotelOptions,
  fetchFlightOptions,
  fetchNearbyHotelOptions,
  fetchWeatherCondition,
  fetchBudgetOverview,
  extractTripSummary,
  extractItineraryDays,
  fetchTripHistory,
  sendChatMessage,
  fetchConversationsList,
  fetchConversationDetail,
  deleteConversation,
  updateExecutionState,
  setApiStatusListener,
  INITIAL_CONVERSATIONS,
  INITIAL_CHAT_MESSAGES,
  createNewChatWelcomeMessage,
  INITIAL_TRIP,
  INITIAL_ITINERARY_DAYS,
  INITIAL_FLIGHTS,
  INITIAL_HOTELS,
  INITIAL_WEATHER,
  INITIAL_BUDGET,
  PRESET_TRIPS,
  getApiBaseUrl,
  setApiBaseUrl,
  parseMetadataFromUserMessage,
  buildChatPromptWithFallbackContext,
  mergeTravelContexts,
  checkTripPlanningConstraints,
  deleteTrip,
} from '../services/api';

export function useTravelApi() {
  // Navigation & View states
  const [activePage, setActivePage] = useState<'planner-studio' | 'itinerary-hub' | 'bookings-desk' | 'ai-places-memory'>('planner-studio');
  const [activeDashboardTab, setActiveDashboardTab] = useState<'companion-tab' | 'route-tab' | 'flights-tab' | 'hotels-tab' | 'weather-tab' | 'budget-tab'>('route-tab');
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  const [isApiModalOpen, setIsApiModalOpen] = useState(false);

  // API Status & Health State
  const [apiStatus, setApiStatus] = useState<ApiStatusState>({
    isConnected: false,
    endpointUrl: getApiBaseUrl(),
    statusCode: null,
    statusMessage: 'Connecting to FastAPI...',
    mode: 'mock-fallback',
  });
  const [isCheckingApi, setIsCheckingApi] = useState(false);

  const hasLoadedRef = useRef(false);

  // User-visible Error Feedback State
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Loading States for Async Resources
  const [isLoadingTrips, setIsLoadingTrips] = useState<boolean>(true);
  const [isLoadingConversations, setIsLoadingConversations] = useState<boolean>(true);

  // Active Trip and Raw Trip History from GET /api/trips/history
  const [rawTripsHistory, setRawTripsHistory] = useState<any[]>([]);
  const [activeTrip, setActiveTrip] = useState<any>(null);
  const [activeTripId, setActiveTripIdState] = useState<string>('');

  // Core Trip & Entity Data (Synchronized from activeTrip)
  const [trip, setTrip] = useState<TripSummary | null>(null);
  const [days, setDays] = useState<ItineraryDay[]>([]);
  const [flights, setFlights] = useState<FlightOption[]>([]);
  const [hotels, setHotels] = useState<HotelOption[]>([]);
  const [nearbyHotels, setNearbyHotels] = useState<HotelOption[]>([]);
  const [weather, setWeather] = useState<WeatherCondition | null>(null);
  const [budget, setBudget] = useState<BudgetOverview | null>(null);
  const [savedTrips, setSavedTrips] = useState<SavedTripSnippet[]>([]);

  // Conversations State
  const [conversations, setConversations] = useState<ConversationHistoryItem[]>([]);
  const [currentConversationId, setCurrentConversationId] = useState<string | null>(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('TRAVELAI_CONVERSATION_ID');
    }
    return null;
  });

  // Chat & Messaging state: restore from cached messages or default welcome message
  const [messages, setMessages] = useState<ChatMessage[]>(() => {
    if (typeof window !== 'undefined') {
      try {
        const cached = localStorage.getItem('TRAVELAI_ACTIVE_MESSAGES');
        if (cached) {
          const parsed = JSON.parse(cached);
          if (Array.isArray(parsed) && parsed.length > 0) {
            return parsed;
          }
        }
      } catch {}
    }
    return [createNewChatWelcomeMessage()];
  });
  const [promptInput, setPromptInput] = useState('');
  const [isSendingMessage, setIsSendingMessage] = useState(false);

  // Conversational Context & Intent states: restore from cached state if available
  const [travelContext, setTravelContext] = useState<Record<string, any> | null>(() => {
    if (typeof window !== 'undefined') {
      try {
        const cached = localStorage.getItem('TRAVELAI_TRAVEL_CONTEXT');
        if (cached) {
          return JSON.parse(cached);
        }
      } catch {}
    }
    return null;
  });
  const [currentIntent, setCurrentIntent] = useState<string | null>(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('TRAVELAI_CURRENT_INTENT') || 'GENERATE_ITINERARY';
    }
    return 'GENERATE_ITINERARY';
  });

  // Persist active messages to localStorage
  useEffect(() => {
    if (typeof window !== 'undefined') {
      try {
        localStorage.setItem('TRAVELAI_ACTIVE_MESSAGES', JSON.stringify(messages));
      } catch {}
    }
  }, [messages]);

  // Persist travelContext to localStorage
  useEffect(() => {
    if (typeof window !== 'undefined') {
      try {
        if (travelContext) {
          localStorage.setItem('TRAVELAI_TRAVEL_CONTEXT', JSON.stringify(travelContext));
        } else {
          localStorage.removeItem('TRAVELAI_TRAVEL_CONTEXT');
        }
      } catch {}
    }
  }, [travelContext]);

  // Persist currentIntent to localStorage
  useEffect(() => {
    if (typeof window !== 'undefined' && currentIntent) {
      try {
        localStorage.setItem('TRAVELAI_CURRENT_INTENT', currentIntent);
      } catch {}
    }
  }, [currentIntent]);

  // Synchronous State Synchronizer for Trip & Derived Entities (Eliminates render-cycle race conditions)
  const syncTripState = useCallback((tripObj: any) => {
    if (!tripObj) {
      setActiveTrip(null);
      setActiveTripIdState('');
      setTrip(null);
      setDays([]);
      setFlights([]);
      setHotels([]);
      setNearbyHotels([]);
      setWeather(null);
      setBudget(null);
      return;
    }

    const tripId = tripObj.id || tripObj._id;
    setActiveTrip(tripObj);
    setActiveTripIdState(tripId);
    
    const tripSummary = extractTripSummary(tripObj);
    if (typeof window !== 'undefined' && tripId) {
      try {
        const cached = localStorage.getItem(`TRAVELAI_EXEC_STATE_${tripId}`);
        if (cached) {
          const parsed = JSON.parse(cached);
          tripSummary.executionState = {
            ...(tripSummary.executionState || {}),
            ...parsed,
          };
        }
      } catch {}
    }
    setTrip(tripSummary);
    setDays(extractItineraryDays(tripObj));
    setFlights(fetchFlightOptions(tripObj));
    setHotels(fetchHotelOptions(tripObj));
    setNearbyHotels(fetchNearbyHotelOptions(tripObj));
    setWeather(fetchWeatherCondition(tripObj));
    setBudget(fetchBudgetOverview(tripObj));
  }, []);

  // Guarded setActiveTripId: Verifies existence before setting, returns boolean, sets errorMessage on failure
  const setActiveTripId = useCallback((id: string | null): boolean => {
    if (!id) {
      setErrorMessage(null);
      syncTripState(null);
      return true;
    }

    if (typeof id !== 'string') {
      setErrorMessage('Invalid trip ID supplied.');
      return false;
    }

    const matchedTrip = rawTripsHistory.find(
      (t: any) => (t.id || t._id) === id
    );

    if (!matchedTrip) {
      setErrorMessage(`Trip with ID "${id}" could not be found.`);
      return false;
    }

    setErrorMessage(null);
    syncTripState(matchedTrip);
    return true;
  }, [rawTripsHistory, syncTripState]);

  // Hook up global status listener so network errors in apiFetch immediately set apiStatus="disconnected"
  useEffect(() => {
    setApiStatusListener((newStatus) => {
      setApiStatus(newStatus);
    });
    return () => setApiStatusListener(null);
  }, []);

  // Load health & trip history
  const loadData = useCallback(async () => {
    setIsCheckingApi(true);
    const health = await checkFastApiHealth();
    setApiStatus(health);
    setIsCheckingApi(false);

    // 1. Fetch trip history (GET /api/trips/history)
    setIsLoadingTrips(true);
    let deletedTripIds: string[] = [];
    if (typeof window !== 'undefined') {
      try {
        deletedTripIds = JSON.parse(localStorage.getItem('TRAVELAI_DELETED_TRIP_IDS') || '[]');
      } catch {}
    }

    let tripContextMap: Record<string, any> = {};
    if (typeof window !== 'undefined') {
      try {
        tripContextMap = JSON.parse(localStorage.getItem('TRAVELAI_TRIP_CONTEXTS') || '{}');
      } catch {}
    }

    try {
      const history = await fetchTripHistory();
      if (Array.isArray(history) && history.length > 0) {
        // Merge fetched trips with presets so presets always remain available (excluding deleted)
        const validHistory = history.filter((t: any) => !deletedTripIds.includes(t.id || t._id));
        const enrichedHistory = validHistory.map((t: any) => {
          const tripId = t.id || t._id;
          const savedCtx = tripContextMap[tripId] || {};
          const parsedMeta = parseMetadataFromUserMessage(t.user_message);
          const resolvedTravelers = t.travelers ?? t.travelersCount ?? savedCtx.travelers ?? parsedMeta.travelers;
          const resolvedBudget = typeof t.budget === 'number'
            ? t.budget
            : (typeof savedCtx.budget === 'number' ? savedCtx.budget : (parsedMeta.budget ?? null));
          return {
            ...t,
            travelers: resolvedTravelers,
            travelersCount: resolvedTravelers,
            budget: resolvedBudget,
            currency: t.currency || savedCtx.currency || 'INR',
            travel_style: t.travel_style || savedCtx.travel_style,
            budget_mode: t.budget_mode || savedCtx.budget_mode,
            origin: t.origin || savedCtx.origin,
            travelContext: {
              ...(savedCtx.travelContext || savedCtx),
              ...(t.travelContext || {}),
            },
          };
        });
        const merged = [...enrichedHistory];
        setRawTripsHistory(merged);
        const snippets: SavedTripSnippet[] = merged.map((doc: any, idx: number) => ({
          id: doc.id || doc._id || `trip-${idx}`,
          name: doc.title || (doc.destination ? `${doc.destination} Circuit` : `Itinerary #${idx + 1}`),
          destinationTag: doc.destination ? doc.destination.split(',')[0] : 'India',
          daysTag: `${doc.days || 3} Days`,
        }));
        setSavedTrips(snippets);

        // Find active trip or keep current
        // Only auto-select merged[0] if we haven't explicitly cleared the trip
        const current = activeTripId 
          ? merged.find((t: any) => (t.id || t._id) === activeTripId)
          : null;
          
        if (current) {
          syncTripState(current);
        } else if (!activeTripId && merged.length > 0) {
          if (!hasLoadedRef.current) {
            syncTripState(merged[0]);
          }
        }
      } else {
        // New user or user with no created trips yet
        setRawTripsHistory([]);
        setSavedTrips([]);
        syncTripState(null);
      }
    } catch (err) {
      console.warn('Falling back to empty trips history state:', err);
      setRawTripsHistory([]);
      setSavedTrips([]);
      syncTripState(null);
    } finally {
      setIsLoadingTrips(false);
      hasLoadedRef.current = true;
    }

    // 2. Fetch conversations list (GET /api/chat/conversations)
    setIsLoadingConversations(true);
    let targetConvId = currentConversationId;
    if (typeof window !== 'undefined' && !targetConvId) {
      targetConvId = localStorage.getItem('TRAVELAI_CONVERSATION_ID');
    }

    try {
      const convList = await fetchConversationsList();
      setConversations(convList);

      const convToLoad = targetConvId && !targetConvId.startsWith('c-') ? targetConvId : null;
      if (convToLoad) {
        try {
          const detail = await fetchConversationDetail(convToLoad);
          if (detail && Array.isArray(detail.messages) && detail.messages.length > 0) {
            const mappedMessages: ChatMessage[] = detail.messages.map((m: any, idx: number) => ({
              id: `msg-${convToLoad}-${idx}`,
              sender: m.role === 'user' ? 'user' : 'assistant',
              timestamp: m.timestamp
                ? new Date(m.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                : new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
              text: m.content || '',
            }));
            setMessages(mappedMessages);
          }
          if (detail?.travel_context) {
            setTravelContext((prev) => ({
              ...(prev || {}),
              ...detail.travel_context,
            }));
          }
        } catch (detailErr) {
          console.warn(`Could not sync conversation detail for ${convToLoad}:`, detailErr);
        }
      }
    } catch (err) {
      console.warn('Falling back to default conversations state:', err);
    } finally {
      setIsLoadingConversations(false);
    }
  }, [activeTripId, syncTripState]);

  useEffect(() => {
    loadData();
    // Re-check API health periodically every 25 seconds via GET /
    const interval = setInterval(() => {
      checkFastApiHealth().then(setApiStatus);
    }, 25000);
    return () => clearInterval(interval);
  }, [loadData]);

  // Handler: Update FastAPI Base URL
  const updateApiUrl = async (newUrl: string) => {
    setApiBaseUrl(newUrl);
    setIsCheckingApi(true);
    const health = await checkFastApiHealth();
    setApiStatus(health);
    setIsCheckingApi(false);
    loadData();
  };

  // Handler: Send Chat message with return result for trip creation verification
  const handleSendMessage = async (
    textToSend?: string
  ): Promise<{ success: boolean; trip: any | null; error?: string }> => {
    const text = (typeof textToSend === 'string' && textToSend.trim() !== '' ? textToSend : promptInput).trim();
    console.log('[CHAT DEBUG] handleSendMessage called. textToSend:', textToSend, 'promptInput:', promptInput, 'resolved text:', text);
    if (!text) {
      return { success: false, trip: null, error: 'Message cannot be empty.' };
    }
    if (isSendingMessage) {
      return { success: false, trip: null, error: 'A request is currently in progress. Please wait.' };
    }

    const userMsg: ChatMessage = {
      id: `user-${Date.now()}`,
      sender: 'user',
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      text,
    };

    setMessages((prev) => [...prev, userMsg]);
    setPromptInput('');
    setIsSendingMessage(true);

    // Evaluate trip planning constraints
    const checkResult = checkTripPlanningConstraints(text, travelContext);
    
    // Always immediately update travelContext with any extracted slots (e.g. destination & dates)
    // so preference bar updates instantly in real time
    setTravelContext(checkResult.mergedContext);

    // If user is attempting to plan a trip with missing constraints, provide immediate conversational guidance
    if (checkResult.isPlanRequest && !checkResult.isFullySatisfied) {
      console.log('[CHAT DEBUG] handleSendMessage: missing trip constraints, returning guidance message');
      const guidanceAssistantMsg: ChatMessage = {
        id: `assistant-guidance-${Date.now()}`,
        sender: 'assistant',
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        text: checkResult.guidanceMessage || 'Please provide your trip details.',
      };
      setMessages((prev) => [...prev, guidanceAssistantMsg]);
      setIsSendingMessage(false);
      return { success: true, trip: null };
    }

    try {
      console.log('[CHAT DEBUG] handleSendMessage: calling sendChatMessage with text:', text, 'currentConversationId:', currentConversationId);
      // Enrich prompt with fallback context from preference bar ONLY for backend understanding
      // (Backend LLM sees unmentioned preferences, user chat bubble remains exactly what user typed)
      const promptToSend = buildChatPromptWithFallbackContext(text, checkResult.mergedContext);

      // POST /api/chat/message with EXACTLY { message, conversation_id }
      const response = await sendChatMessage(promptToSend, currentConversationId);
      console.log('[CHAT DEBUG] handleSendMessage: sendChatMessage succeeded with conversation_id:', response.rawResponse?.conversation_id);
      
      // CRITICAL: Persist conversation_id so subsequent messages thread correctly
      if (response.rawResponse?.conversation_id) {
        setCurrentConversationId(response.rawResponse.conversation_id);
        localStorage.setItem('TRAVELAI_CONVERSATION_ID', response.rawResponse.conversation_id);
      }

      // CRITICAL: Merge travel context rather than blindly overwriting with backend's stale values!
      // Chatbot explicit values WIN; preference bar values preserved for unspecified fields.
      const mergedContext = mergeTravelContexts(checkResult.mergedContext, response.rawResponse?.travel_context, text);
      setTravelContext(mergedContext);

      if (response.rawResponse?.intent) {
        setCurrentIntent(response.rawResponse.intent);
      }

      setMessages((prev) => [...prev, response.replyMessage]);

      let generatedTrip: any = null;
      if (response.rawResponse?.data?.itinerary) {
        const rawCtx = response.rawResponse.travel_context || {};
        const parsedMeta = parseMetadataFromUserMessage(text);
        const resolvedTravelers = mergedContext.travelers ?? response.rawResponse.data.itinerary.travelers ?? rawCtx.travelers ?? parsedMeta.travelers ?? 2;
        const resolvedBudget = typeof mergedContext.budget === 'number'
          ? mergedContext.budget
          : (typeof response.rawResponse.data.itinerary.budget === 'number'
            ? response.rawResponse.data.itinerary.budget
            : (typeof rawCtx.budget === 'number' ? rawCtx.budget : (parsedMeta.budget ?? null)));

        generatedTrip = {
          ...response.rawResponse.data.itinerary,
          travelers: resolvedTravelers,
          travelersCount: resolvedTravelers,
          budget: resolvedBudget,
          currency: mergedContext.currency ?? response.rawResponse.data.itinerary.currency ?? rawCtx.currency ?? 'INR',
          travel_style: mergedContext.travel_style ?? response.rawResponse.data.itinerary.travel_style ?? rawCtx.travel_style,
          budget_mode: mergedContext.budget_mode ?? response.rawResponse.data.itinerary.budget_mode ?? rawCtx.budget_mode,
          origin: mergedContext.origin ?? response.rawResponse.data.itinerary.origin ?? rawCtx.origin,
          travelContext: mergedContext,
        };
        const newTripId = response.rawResponse.data.trip_id || generatedTrip.id || `trip-${Date.now()}`;
        generatedTrip.id = newTripId;

        // Persist to localStorage trip contexts
        if (typeof window !== 'undefined') {
          try {
            const stored = JSON.parse(localStorage.getItem('TRAVELAI_TRIP_CONTEXTS') || '{}');
            stored[newTripId] = {
              travelers: resolvedTravelers,
              budget: resolvedBudget,
              currency: generatedTrip.currency,
              travel_style: generatedTrip.travel_style,
              budget_mode: generatedTrip.budget_mode,
              origin: generatedTrip.origin,
              travelContext: mergedContext,
            };
            localStorage.setItem('TRAVELAI_TRIP_CONTEXTS', JSON.stringify(stored));
          } catch {}
        }

        // Establish active trip immediately before navigation
        syncTripState(generatedTrip);

        setRawTripsHistory((prev) => [generatedTrip, ...prev.filter((t) => (t.id || t._id) !== newTripId)]);
        setSavedTrips((prev) => [
          {
            id: newTripId,
            name: generatedTrip.title || (generatedTrip.destination ? `${generatedTrip.destination} Circuit` : 'New Itinerary'),
            destinationTag: generatedTrip.destination ? generatedTrip.destination.split(',')[0] : 'India',
            daysTag: `${generatedTrip.days || 3} Days`,
          },
          ...prev.filter((s) => s.id !== newTripId),
        ]);
      }

      // Refresh conversations list in background
      fetchConversationsList().then(setConversations).catch(() => {});

      return { success: true, trip: generatedTrip };
    } catch (err: any) {
      console.error('[CHAT DEBUG] handleSendMessage caught error:', err);
      // User-visible error feedback
      const errorText = err instanceof Error ? err.message : 'Failed to reach TravelAI server.';
      setMessages((prev) => [
        ...prev,
        {
          id: `assistant-error-${Date.now()}`,
          sender: 'assistant',
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          text: `⚠️ Network Error: ${errorText}. Please ensure your backend is running on ${getApiBaseUrl()}.`,
        },
      ]);
      setErrorMessage(`Failed to send message: ${errorText}`);
      return { success: false, trip: null, error: errorText };
    } finally {
      setIsSendingMessage(false);
    }
  };

  // Handler: Select a conversation from Sidebar
  const handleSelectConversation = async (conversationId: string) => {
    try {
      setCurrentConversationId(conversationId);
      localStorage.setItem('TRAVELAI_CONVERSATION_ID', conversationId);
      
      // Presets are client-side only
      if (conversationId.startsWith('c-')) {
        return;
      }

      const detail = await fetchConversationDetail(conversationId);
      if (detail && Array.isArray(detail.messages)) {
        const mappedMessages: ChatMessage[] = detail.messages.map((m: any, idx: number) => ({
          id: `msg-${conversationId}-${idx}`,
          sender: m.role === 'user' ? 'user' : 'assistant',
          timestamp: m.timestamp
            ? new Date(m.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
            : new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          text: m.content || '',
        }));
        setMessages(mappedMessages.length > 0 ? mappedMessages : INITIAL_CHAT_MESSAGES);
      }
      if (detail?.travel_context) {
        setTravelContext(detail.travel_context);
      }
      if (detail?.current_trip_id) {
        setActiveTripId(detail.current_trip_id);
        if (detail.travel_context) {
          setRawTripsHistory((prev) =>
            prev.map((t) => {
              if ((t.id || t._id) === detail.current_trip_id) {
                const updated = {
                  ...t,
                  travelers: t.travelers ?? detail.travel_context.travelers,
                  travelersCount: t.travelersCount ?? detail.travel_context.travelers,
                  budget: typeof t.budget === 'number' ? t.budget : detail.travel_context.budget,
                  currency: t.currency || detail.travel_context.currency || 'INR',
                  travel_style: t.travel_style || detail.travel_context.travel_style,
                  budget_mode: t.budget_mode || detail.travel_context.budget_mode,
                  travelContext: {
                    ...(t.travelContext || {}),
                    ...detail.travel_context,
                  },
                };
                syncTripState(updated);
                return updated;
              }
              return t;
            })
          );
        }
      }
    } catch (err) {
      console.warn(`Could not load detail for conversation ${conversationId}:`, err);
    }
  };

  // Handler: Delete conversation
  const handleDeleteConversation = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await deleteConversation(id);
      setConversations((prev) => prev.filter((c) => c.id !== id));

      // Persist deleted conversation ID so presets/conversations don't reappear on reload
      try {
        const deleted = JSON.parse(localStorage.getItem('TRAVELAI_DELETED_CONVERSATIONS') || '[]');
        if (!deleted.includes(id)) {
          deleted.push(id);
          localStorage.setItem('TRAVELAI_DELETED_CONVERSATIONS', JSON.stringify(deleted));
        }
      } catch {}

      if (currentConversationId === id) {
        setCurrentConversationId(null);
        localStorage.removeItem('TRAVELAI_CONVERSATION_ID');
        setMessages([createNewChatWelcomeMessage()]);
      }
    } catch (err: any) {
      const errMsg = err instanceof Error ? err.message : 'Failed to delete conversation from server';
      setErrorMessage(`Failed to delete conversation: ${errMsg}`);
      console.warn(`Failed to delete conversation ${id} on backend:`, err);
    }
  };

  // Handler: Delete saved trip
  const handleDeleteTrip = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await deleteTrip(id);
      
      // Persist deleted trip ID locally as fallback
      try {
        const deleted = JSON.parse(localStorage.getItem('TRAVELAI_DELETED_TRIP_IDS') || '[]');
        if (!deleted.includes(id)) {
          deleted.push(id);
          localStorage.setItem('TRAVELAI_DELETED_TRIP_IDS', JSON.stringify(deleted));
        }
      } catch {}

      setSavedTrips((prev) => prev.filter((t) => t.id !== id));
      setRawTripsHistory((prev) => prev.filter((t) => (t.id || t._id) !== id));

      // If deleted trip was active, transition to the next available trip
      if (activeTripId === id) {
        const remaining = rawTripsHistory.filter((t) => (t.id || t._id) !== id);
        const next = remaining[0] || PRESET_TRIPS[0];
        if (next) {
          setActiveTripId(next.id || next._id);
          syncTripState(next);
        }
      }
    } catch (err: any) {
      const errMsg = err instanceof Error ? err.message : 'Failed to delete trip from server';
      setErrorMessage(`Failed to delete trip: ${errMsg}`);
      console.warn(`Failed to delete saved trip ${id}:`, err);
    }
  };

  // Handler: Select Flight
  const handleSelectFlight = (flightId: string) => {
    setFlights((prev) =>
      prev.map((f) => ({
        ...f,
        isSelected: f.id === flightId,
      }))
    );
  };

  // Handler: Select Hotel
  const handleSelectHotel = (hotelId: string) => {
    setHotels((prev) =>
      prev.map((h) => ({
        ...h,
        isBooked: h.id === hotelId,
      }))
    );
  };

  // Handler: Append Place from AI Places Memory directly to active trip route
  const handleAppendPlaceToRoute = useCallback(
    (place: PlaceMemoryItem): boolean => {
      if (!place || !place.name) {
        setErrorMessage('Invalid place object provided.');
        return false;
      }

      if (!activeTrip || !activeTripId) {
        setErrorMessage('No active trip available. Please select or create a trip first.');
        return false;
      }

      let timeOfDay: 'Morning' | 'Afternoon' | 'Evening' = 'Afternoon';
      let time = '15:30';
      let categoryColor: 'primary' | 'secondary' | 'tertiary' = 'primary';

      if (place.tag === 'dining') {
        categoryColor = 'secondary';
        timeOfDay = 'Evening';
        time = '19:30';
      } else if (place.tag === 'beach') {
        categoryColor = 'tertiary';
        timeOfDay = 'Afternoon';
        time = '16:00';
      } else {
        categoryColor = 'primary';
        timeOfDay = 'Morning';
        time = '11:00';
      }

      const newActivity: ActivitySegment = {
        timeOfDay,
        time,
        title: place.name,
        description: `${place.category} in ${place.location}. ${place.note} (${place.price})`,
        categoryColor,
        location: place.location,
      };

      let updatedDays: ItineraryDay[] = [];
      if (!days || days.length === 0) {
        updatedDays = [
          {
            dayNumber: 1,
            date: 'Day 1',
            title: `Day 1: ${activeTrip.destination || 'Destination'} Exploration`,
            transitBadge: 'Curated Route',
            activities: [newActivity],
          },
        ];
      } else {
        const targetDayIndex = days.length >= 2 ? 1 : 0;
        updatedDays = days.map((day, idx) => {
          if (idx === targetDayIndex) {
            return {
              ...day,
              activities: [...day.activities, newActivity],
            };
          }
          return day;
        });
      }

      const currentWaypoints = activeTrip.activeWaypointsCount || (trip?.activeWaypointsCount ?? 4);
      const updatedTrip = {
        ...activeTrip,
        route_details: updatedDays,
        activeWaypointsCount: currentWaypoints + 1,
      };

      setActiveTrip(updatedTrip);
      setDays(updatedDays);
      setTrip((prev) =>
        prev
          ? {
              ...prev,
              activeWaypointsCount: currentWaypoints + 1,
            }
          : prev
      );
      setRawTripsHistory((prev) =>
        prev.map((t) => ((t.id || t._id) === activeTripId ? updatedTrip : t))
      );
      setActiveDashboardTab('route-tab');
      setErrorMessage(null);

      return true;
    },
    [activeTrip, activeTripId, days, trip]
  );

  // Handler: Start a fresh new chat session without sending any default prompt
  const handleNewChat = useCallback(() => {
    setCurrentConversationId(null);
    if (typeof window !== 'undefined') {
      localStorage.removeItem('TRAVELAI_CONVERSATION_ID');
      localStorage.removeItem('TRAVELAI_ACTIVE_MESSAGES');
      localStorage.removeItem('TRAVELAI_TRAVEL_CONTEXT');
      localStorage.removeItem('TRAVELAI_CURRENT_INTENT');
    }
    setPromptInput('');
    setTravelContext(null);
    setCurrentIntent('GENERATE_ITINERARY');
    setMessages([createNewChatWelcomeMessage()]);
    setErrorMessage(null);
  }, []);

  // Handler: Clear only chat context without deleting or resetting the active trip
  const handleClearContext = useCallback(() => {
    handleNewChat();
  }, [handleNewChat]);

  // Handler: Update frontend-only travel preferences state from interactive controls
  const updateTravelPreference = useCallback((updates: Partial<Record<string, any>>) => {
    setTravelContext((prev) => ({
      ...(prev || {}),
      ...updates,
    }));
  }, []);

  const handleUpdateExecutionState = useCallback(async (updates: Partial<any>) => {
    if (!trip || !activeTripId) return false;
    
    const currentState = trip.executionState || {
      is_active: true,
      current_day_number: 1,
      activity_log: {},
      reroute_history: []
    };
    
    const newState = { ...currentState, ...updates };
    
    // 1. Instantly update React Trip state
    setTrip(prev => prev ? { ...prev, executionState: newState } : prev);
    setActiveTrip((prev: any) => prev ? { ...prev, execution_state: newState, executionState: newState } : prev);
    setRawTripsHistory((prev) =>
      prev.map((t) => ((t.id || t._id) === activeTripId ? { ...t, execution_state: newState, executionState: newState } : t))
    );

    // 2. Persist to localStorage for rock-solid reload & offline persistence
    if (typeof window !== 'undefined') {
      try {
        localStorage.setItem(`TRAVELAI_EXEC_STATE_${activeTripId}`, JSON.stringify(newState));
      } catch {}
    }
    
    // 3. Persist to server
    try {
      await updateExecutionState(activeTripId, newState);
      return true;
    } catch (e) {
      console.warn("Execution state saved locally, remote sync warning:", e);
      return true;
    }
  }, [trip, activeTripId]);

  const handleApplyRerouteResult = useCallback((rerouteResult: any) => {
    if (!activeTripId || !rerouteResult) return;
    const { route_details, execution_state, revision } = rerouteResult;
    
    // 1. Update React Trip state
    setActiveTrip((prev: any) => {
      if (!prev) return prev;
      return {
        ...prev,
        route_details,
        execution_state,
        executionState: execution_state,
        revision: revision || ((prev.revision || 1) + 1),
      };
    });

    setTrip((prev: any) => {
      if (!prev) return prev;
      return {
        ...prev,
        executionState: execution_state,
        revision: revision || ((prev.revision || 1) + 1),
      };
    });

    setRawTripsHistory((prev) =>
      prev.map((t) =>
        (t.id || t._id) === activeTripId
          ? {
              ...t,
              route_details,
              execution_state,
              executionState: execution_state,
              revision: revision || ((t.revision || 1) + 1),
            }
          : t
      )
    );

    // 2. Re-extract daily itineraries so DayDetailView, DayMapView, RouteTab & CompanionMode update immediately
    const updatedTripObj = {
      ...(trip || {}),
      route_details,
      execution_state,
    };
    setDays(extractItineraryDays(updatedTripObj));

    // 3. Persist execution state to localStorage
    if (typeof window !== 'undefined') {
      try {
        localStorage.setItem(`TRAVELAI_EXEC_STATE_${activeTripId}`, JSON.stringify(execution_state));
      } catch {}
    }
  }, [activeTripId, trip]);

  return {
    activePage,
    setActivePage,
    activeDashboardTab,
    setActiveDashboardTab,
    isSidebarCollapsed,
    setIsSidebarCollapsed,
    isMobileSidebarOpen,
    setIsMobileSidebarOpen,
    isApiModalOpen,
    setIsApiModalOpen,
    apiStatus,
    isCheckingApi,
    updateApiUrl,
    trip,
    days,
    flights,
    hotels,
    nearbyHotels,
    weather,
    budget,
    savedTrips,
    isLoadingTrips,
    conversations,
    isLoadingConversations,
    messages,
    promptInput,
    setPromptInput,
    isSendingMessage,
    handleSendMessage,
    handleSelectConversation,
    handleSelectFlight,
    handleSelectHotel,
    handleDeleteConversation,
    handleDeleteTrip,
    activeTripId,
    setActiveTripId,
    activeTrip,
    handleAppendPlaceToRoute,
    errorMessage,
    setErrorMessage,
    rawTripsHistory,
    handleClearContext,
    handleNewChat,
    travelContext,
    setTravelContext,
    updateTravelPreference,
    handleUpdateExecutionState,
    handleApplyRerouteResult,
    currentIntent,
    setCurrentIntent,
    refreshData: loadData,
  };
}

