import { useState, useEffect, useCallback, MouseEvent, useRef } from 'react';
import {
  TripSummary,
  ItineraryDay,
  ActivitySegment,
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
  createNewChatWelcomeMessage,
  getApiBaseUrl,
  setApiBaseUrl,
  parseMetadataFromUserMessage,
  buildChatPromptWithFallbackContext,
  mergeTravelContexts,
  checkTripPlanningConstraints,
  deleteTrip,
  fetchTrip,
  saveTripSelections,
  ApiError,
  apiFetch,
} from '../services/api';

export function useTravelApi() {
  const [plannerView, setPlannerView] = useState<'plan' | 'trip'>(() => new URL(window.location.href).searchParams.get('view') === 'plan' ? 'plan' : 'trip');
  const conversationLoad = useRef(0);
  const [isOpeningEdit, setIsOpeningEdit] = useState(false);
  const draftKey = (id: string | null) => {
    let owner = 'session';
    try { owner = JSON.parse(localStorage.getItem('travelai_user') || '{}').id || owner; } catch {}
    return `TRAVELAI_PROMPT:${owner}:${id || 'new'}`;
  };
  // Navigation & View states
  const [activePage, setActivePage] = useState<'planner-studio' | 'itinerary-hub' | 'bookings-desk' | 'ai-places-memory' | 'payments'>(() => new URL(window.location.href).searchParams.has('payment_order') ? 'payments' : 'planner-studio');
  const [activeDashboardTab, setActiveDashboardTab] = useState<'companion-tab' | 'route-tab' | 'flights-tab' | 'hotels-tab' | 'weather-tab' | 'budget-tab'>(() => { const value = new URL(window.location.href).searchParams.get('tab'); return ['companion-tab','route-tab','flights-tab','hotels-tab','weather-tab','budget-tab'].includes(value || '') ? value as 'route-tab' : 'route-tab'; });
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(() => window.innerWidth >= 1024 && window.innerWidth < 1600);
  useEffect(() => {
    const laptop = window.matchMedia('(min-width: 1024px) and (max-width: 1599px)');
    const update = () => setIsSidebarCollapsed(laptop.matches);
    laptop.addEventListener('change', update);
    return () => laptop.removeEventListener('change', update);
  }, []);
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
  const [activeTripId, setActiveTripIdState] = useState<string>(() => new URL(window.location.href).searchParams.get('trip_id') || '');
  const activeTripIdRef = useRef(activeTripId);
  activeTripIdRef.current = activeTripId;

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
  const currentConversationRef = useRef(currentConversationId);
  currentConversationRef.current = currentConversationId;

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
  const [promptInput, setPromptInput] = useState(() => sessionStorage.getItem(draftKey(currentConversationId)) || '');
  useEffect(() => { sessionStorage.setItem(draftKey(currentConversationId), promptInput); }, [promptInput, currentConversationId]);
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
    setTrip(tripSummary);
    setDays(extractItineraryDays(tripObj));
    setFlights(fetchFlightOptions(tripObj));
    setHotels(fetchHotelOptions(tripObj));
    setNearbyHotels(fetchNearbyHotelOptions(tripObj));
    setWeather(fetchWeatherCondition(tripObj));
    setBudget(fetchBudgetOverview(tripObj));
  }, []);

  const refreshTripAccess = useCallback(async (id: string): Promise<boolean> => {
    try {
      const fresh = await fetchTrip(id);
      setRawTripsHistory(prev => [fresh, ...prev.filter(item => (item.id || item._id) !== id)]);
      if (activeTripIdRef.current === id) syncTripState(fresh);
      return fresh.plus_access === true;
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Unable to refresh trip access.');
      return false;
    }
  }, [syncTripState]);

  // Guarded setActiveTripId: Verifies existence before setting, returns boolean, sets errorMessage on failure
  const setActiveTripId = useCallback(async (id: string | null, forceRefresh = false): Promise<boolean> => {
    if (!id) {
      setErrorMessage(null);
      syncTripState(null);
      setPlannerView('plan');
      return true;
    }

    if (typeof id !== 'string') {
      setErrorMessage('Invalid trip ID supplied.');
      return false;
    }

    let matchedTrip = rawTripsHistory.find(
      (t: any) => (t.id || t._id) === id
    );

    if (!matchedTrip || forceRefresh) {
      try {
        matchedTrip = await fetchTrip(id);
        setRawTripsHistory(previous => [matchedTrip, ...previous.filter(item => (item.id || item._id) !== id)]);
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : 'Unable to load this trip.');
        return false;
      }
    }

    setErrorMessage(null);
    syncTripState(matchedTrip);
    setPlannerView('trip');
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
        } else if (activeTripId) {
          try { syncTripState(await fetchTrip(activeTripId)); }
          catch (error) { syncTripState(null); setErrorMessage('This trip is unavailable. Choose another saved trip.'); }
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
    const restoration = conversationLoad.current;
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
          if (restoration !== conversationLoad.current || convToLoad !== currentConversationRef.current) return;
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
      // Enrich prompt with fallback context from preference bar ONLY for backend understanding
      // (Backend LLM sees unmentioned preferences, user chat bubble remains exactly what user typed)
      const promptToSend = buildChatPromptWithFallbackContext(text, checkResult.mergedContext);

      // POST /api/chat/message with EXACTLY { message, conversation_id }
      const response = await sendChatMessage(promptToSend, currentConversationId);
      
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
        setPlannerView('trip');

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
  const handleSelectConversation = async (conversationId: string, expectedTripId?: string) => {
    if (isSendingMessage) { setErrorMessage('Wait for the current response before switching conversations.'); return false; }
    const request = ++conversationLoad.current;
    try {
      const detail = await fetchConversationDetail(conversationId);
      if (request !== conversationLoad.current) return false;
      if (expectedTripId && detail.current_trip_id !== expectedTripId) throw new Error('This conversation does not belong to the selected trip.');
      if (detail.current_trip_id && !await setActiveTripId(detail.current_trip_id)) return false;
      if (request !== conversationLoad.current) return false;
      setCurrentConversationId(conversationId);
      localStorage.setItem('TRAVELAI_CONVERSATION_ID', conversationId);
      setMessages(detail.messages?.length ? detail.messages.map((m: any, index: number) => ({
        id: `msg-${conversationId}-${index}`, sender: m.role === 'user' ? 'user' : 'assistant', text: m.content || '',
        timestamp: m.timestamp ? new Date(m.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''
      })) : [{ ...createNewChatWelcomeMessage(), text: expectedTripId ? `What would you like to change about your ${detail.travel_context?.destination || 'saved'} trip?` : 'Tell me about the trip you would like to plan.' }]);
      setTravelContext(detail.travel_context || null);
      setCurrentIntent(detail.current_trip_id ? 'MODIFY_ITINERARY' : 'GENERATE_ITINERARY');
      setPromptInput(sessionStorage.getItem(draftKey(conversationId)) || '');
      setPlannerView('plan'); setActivePage('planner-studio');
      return true;
    } catch (error) {
      if (request === conversationLoad.current) setErrorMessage(error instanceof Error ? error.message : 'Unable to open this conversation.');
      return false;
    }
  };

  const openTripEdit = async () => {
    if (!trip || isOpeningEdit || isSendingMessage) return false;
    const id = trip.id;
    setIsOpeningEdit(true);
    try {
      const result = await apiFetch<{ conversation_id: string; current_trip_id: string }>(`/api/trips/${encodeURIComponent(id)}/edit-session`, { method: 'POST' });
      if (activeTripIdRef.current !== id) return false;
      return await handleSelectConversation(result.conversation_id, id);
    } catch (error) { setErrorMessage(error instanceof Error ? error.message : 'Unable to open trip editing.'); return false; }
    finally { setIsOpeningEdit(false); }
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
        const next = remaining[0] || null;
        if (next) {
          setActiveTripId(next.id || next._id);
          syncTripState(next);
        } else {
          setActiveTripIdState('');
          syncTripState(null);
        }
      }
    } catch (err: any) {
      const errMsg = err instanceof Error ? err.message : 'Failed to delete trip from server';
      setErrorMessage(`Failed to delete trip: ${errMsg}`);
      console.warn(`Failed to delete saved trip ${id}:`, err);
    }
  };

  const selectionInFlight = useRef(false);
  const handleSaveSelection = async (selection: { flight_id?: string; hotel_id?: string }): Promise<boolean> => {
    if (!activeTripId || !trip || selectionInFlight.current) return false;
    const requestedTripId = activeTripId;
    selectionInFlight.current = true;
    try {
      const result = await saveTripSelections(requestedTripId, trip.revision || 1, selection);
      if (activeTripIdRef.current === requestedTripId) syncTripState(result.trip);
      setRawTripsHistory(previous => previous.map(item => (item.id || item._id) === requestedTripId ? result.trip : item));
      setErrorMessage(null);
      return true;
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        try {
          const fresh = await fetchTrip(requestedTripId);
          if (activeTripIdRef.current === requestedTripId) syncTripState(fresh);
          setRawTripsHistory(previous => previous.map(item => (item.id || item._id) === requestedTripId ? fresh : item));
        } catch {}
      }
      setErrorMessage(error instanceof Error ? error.message : 'Unable to save your selection.');
      return false;
    } finally { selectionInFlight.current = false; }
  };
  const handleSelectFlight = (flightId: string) => handleSaveSelection({ flight_id: flightId });
  const handleSelectHotel = (hotelId: string) => handleSaveSelection({ hotel_id: hotelId });

  // Handler: Start a fresh new chat session without sending any default prompt
  const handleNewChat = useCallback(() => {
    ++conversationLoad.current;
    setPlannerView('plan');
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
    
    const requestedState = { ...currentState, ...updates };
    try {
      const response = await updateExecutionState(activeTripId, requestedState, trip.revision || 1);
      if (!response) throw new Error('This trip cannot save progress.');
      const newState = response.execution_state;
      setTrip(prev => prev ? { ...prev, executionState: newState, revision: response.revision } : prev);
      setActiveTrip((prev: any) => prev ? { ...prev, execution_state: newState, executionState: newState, revision: response.revision } : prev);
      setRawTripsHistory(prev => prev.map(t => (t.id || t._id) === activeTripId ? { ...t, execution_state: newState, revision: response.revision } : t));
      localStorage.setItem(`TRAVELAI_EXEC_STATE_${activeTripId}`, JSON.stringify(newState));
      return true;
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Unable to save progress. Refresh and try again.');
      return false;
    }
  }, [trip, activeTripId]);

  const handleApplyRerouteResult = useCallback((rerouteResult: any) => {
    if (!activeTripId || !rerouteResult) return;
    const { route_details, execution_state, revision, planner_draft, budget_breakdown, final_itinerary } = rerouteResult;
    setBudget(fetchBudgetOverview({ ...activeTrip, budget_breakdown }));
    
    // 1. Update React Trip state
    setActiveTrip((prev: any) => {
      if (!prev) return prev;
      return {
        ...prev,
        route_details,
        planner_draft, budget_breakdown, final_itinerary,
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
              planner_draft, budget_breakdown, final_itinerary,
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
  }, [activeTripId, trip, activeTrip]);

  useEffect(() => {
    const url = new URL(window.location.href);
    url.searchParams.set('view', plannerView);
    url.searchParams.set('tab', activeDashboardTab);
    if (trip?.id) url.searchParams.set('trip_id', trip.id);
    else if (!isLoadingTrips) url.searchParams.delete('trip_id');
    window.history.replaceState(null, '', url);
  }, [plannerView, trip?.id, isLoadingTrips, activeDashboardTab]);

  return {
    plannerView, setPlannerView, openTripEdit, isOpeningEdit,
    refreshTripAccess,
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

