/**
 * TravelAI - Autonomous Trip Architecture Frontend
 * 
 * Production-ready React + TypeScript + Vite + Tailwind CSS frontend
 * configured to communicate with an existing FastAPI REST backend.
 */

import React, { useEffect, useState, useRef, useCallback, lazy, Suspense } from 'react';
import { AlertCircle, X } from 'lucide-react';
import { useTravelApi } from './hooks/useTravelApi';
import { Sidebar } from './components/Sidebar';
import { Header } from './components/Header';
import { ApiConfigModal } from './components/ApiConfigModal';
const PlannerStudioPage = lazy(() => import('./pages/PlannerStudioPage').then(module => ({ default: module.PlannerStudioPage })));
const ItineraryHubPage = lazy(() => import('./pages/ItineraryHubPage').then(module => ({ default: module.ItineraryHubPage })));
const BookingsDeskPage = lazy(() => import('./pages/BookingsDeskPage').then(module => ({ default: module.BookingsDeskPage })));
const AiPlacesMemoryPage = lazy(() => import('./pages/AiPlacesMemoryPage').then(module => ({ default: module.AiPlacesMemoryPage })));
import { ErrorBoundary } from './components/ErrorBoundary';
import { fetchTrip } from './services/api';
import { useTripBookings, TripBookingsContext } from './hooks/useTripBookings';
import { paymentApi, orderUrl } from './services/payments';
const PaymentsPage = lazy(() => import('./pages/PaymentsPage').then(module => ({ default: module.PaymentsPage })));
import { AuthProvider, useAuth } from './context/AuthContext';
import { LoginPage } from './pages/LoginPage';
import { RegisterPage } from './pages/RegisterPage';

function AppContent() {
  const {
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
    setActiveTripId,
    errorMessage,
    setErrorMessage,
    rawTripsHistory,
    handleClearContext,
    handleNewChat,
    travelContext,
    updateTravelPreference,
    handleUpdateExecutionState,
    handleApplyRerouteResult,
    currentIntent,
    refreshTripAccess,
  } = useTravelApi();

  const bookings = useTripBookings(trip?.id, `${activePage}/${activeDashboardTab}/${trip?.revision || 1}`);
  const bookingInFlight = useRef(false);
  const refreshBookings = bookings.refresh;
  const confirmedBooking = useCallback(async (id: string) => {
    const access = await refreshTripAccess(id);
    await refreshBookings();
    return access;
  }, [refreshTripAccess, refreshBookings]);
  const [checkoutTripId, setCheckoutTripId] = useState<string | null>(null);
  const upgrade = () => {
    if (!trip) return;
    orderUrl(null);
    setCheckoutTripId(trip.id);
    setActivePage('payments');
  };
  const bookDemo = async (kind: 'flight' | 'hotel', id: string, source: 'discovered' | 'sample' = 'discovered') => {
    if (!trip || bookingInFlight.current) return;
    bookingInFlight.current = true;
    const tripId = trip.id;
    try {
      const status = await bookings.refresh();
      if (!status) throw new Error('Cannot check booking status. Retry status check or open API Settings.');
      const saved = status.current.find(item => item.booking?.kind === kind && item.booking.option_id === id && item.booking.source === source && item.status !== 'cancelled');
      if (saved) { openBooking(saved.id, saved.status === 'succeeded'); return; }
      if (source === 'discovered') {
        const selected = kind === 'flight' ? flights.find(item => item.id === id)?.isSelected : [...hotels, ...nearbyHotels].find(item => item.id === id)?.isSelected;
        if (!selected && !await (kind === 'flight' ? handleSelectFlight(id) : handleSelectHotel(id))) return;
      }
      const fresh = await fetchTrip(tripId);
      const order = await paymentApi.book({ trip_id: tripId, kind, source, option_id: id, expected_revision: fresh.revision || 1 });
      orderUrl(order.id); setCheckoutTripId(null); setActivePage('payments');
    } catch (error) { setErrorMessage(error instanceof Error ? error.message : 'Unable to prepare the demo booking.'); }
    finally { bookingInFlight.current = false; }
  };
  const openBooking = (id: string, confirmation = false) => { orderUrl(id); const url = new URL(window.location.href); if (confirmation) url.searchParams.set('payment_view', 'confirmation'); else url.searchParams.delete('payment_view'); window.history.replaceState(null, '', url); setCheckoutTripId(null); setActivePage('payments'); };
  const goToBookings = () => { orderUrl(null); setCheckoutTripId(null); setActivePage('bookings-desk'); };
  const returnFromPayment = async (id?: string, companion = false, tab?: 'flights-tab' | 'hotels-tab') => {
    if (id) {
      if (!await setActiveTripId(id, true)) return;
    }
    setCheckoutTripId(null);
    await bookings.refresh();
    setActiveDashboardTab(tab || (companion ? 'companion-tab' : 'route-tab'));
    setActivePage('planner-studio');
  };

  // Auto-dismiss errorMessage after 5 seconds
  useEffect(() => {
    if (errorMessage) {
      const timer = setTimeout(() => setErrorMessage(null), 5000);
      return () => clearTimeout(timer);
    }
  }, [errorMessage, setErrorMessage]);

  // Handler for New Bespoke Trip CTA (+ button): opens a fresh new chat session without sending any default prompt
  const handleNewTrip = () => {
    handleNewChat();
    setActiveTripId(null);
    setActivePage('planner-studio');
    // Focus the chat prompt textarea so the user can immediately type their bespoke prompt
    setTimeout(() => {
      const inputEl = document.getElementById('chatPromptInput') as HTMLTextAreaElement | null;
      inputEl?.focus();
    }, 100);
  };

  return (
    <TripBookingsContext.Provider value={{ ...bookings, openOrder: openBooking, openSettings: () => setIsApiModalOpen(true) }}>
    <div className="min-h-screen bg-background text-on-surface flex font-sans antialiased selection:bg-primary-container selection:text-on-primary relative">
      {/* User-visible Error Feedback Toast / Banner */}
      {errorMessage && (
        <div
          role="alert"
          aria-live="assertive"
          className="fixed top-20 right-6 z-50 max-w-md p-4 rounded-xl bg-error-container text-on-error-container border border-error/40 shadow-2xl flex items-start gap-3 animate-in fade-in slide-in-from-top-4"
        >
          <AlertCircle className="w-5 h-5 text-error flex-shrink-0 mt-0.5" />
          <div className="flex-1 text-xs sm:text-sm">
            <span className="font-bold block">Trip Action Error</span>
            <span>{errorMessage}</span>
            <div className="flex flex-wrap gap-3 mt-2">
              {trip && <button type="button" className="underline" onClick={() => void setActiveTripId(trip.id, true).then(() => bookings.refresh())}>Refresh trip</button>}
              <button type="button" className="underline" onClick={() => setIsApiModalOpen(true)}>API Settings</button>
            </div>
          </div>
          <button
            type="button"
            aria-label="Dismiss error"
            onClick={() => setErrorMessage(null)}
            className="p-1 rounded-lg hover:bg-error/10 text-on-error-container transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Sidebar Navigation */}
      <Sidebar
        activePage={activePage}
        onSelectPage={(page) => {
          orderUrl(null); setCheckoutTripId(null); setActivePage(page);
        }}
        conversations={conversations}
        isLoadingConversations={isLoadingConversations}
        savedTrips={savedTrips}
        isLoadingTrips={isLoadingTrips}
        apiStatus={apiStatus}
        onOpenApiModal={() => setIsApiModalOpen(true)}
        onDeleteConversation={handleDeleteConversation}
        onDeleteTrip={handleDeleteTrip}
        onSelectConversation={handleSelectConversation}
        onSelectTrip={async (id) => {
          const success = await setActiveTripId(id);
          if (success) {
            setActivePage('planner-studio');
          }
        }}
        onNewTrip={handleNewTrip}
        isSendingMessage={isSendingMessage}
        isCollapsed={isSidebarCollapsed}
        onToggleCollapse={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
        isMobileOpen={isMobileSidebarOpen}
        onCloseMobile={() => setIsMobileSidebarOpen(false)}
      />

      {/* Main Content Area */}
      <div
        className={`flex-1 min-w-0 flex flex-col min-h-screen transition-all duration-300 ${
          isSidebarCollapsed ? 'lg:pl-20' : 'lg:pl-72'
        }`}
      >
        {/* Top Header */}
        <Header
          apiStatus={apiStatus}
          activeTrip={trip}
          savedTrips={savedTrips}
          onOpenApiModal={() => setIsApiModalOpen(true)}
          onToggleMobileSidebar={() => setIsMobileSidebarOpen((prev) => !prev)}
          isSidebarCollapsed={isSidebarCollapsed}
          onSelectTripPreset={async (presetId) => {
            const success = await setActiveTripId(presetId);
            if (success) {
              setActivePage('planner-studio');
            }
          }}
          onSearch={(query) => {
            const lower = query.toLowerCase();
            const matched = rawTripsHistory.find(
              (t) =>
                t.title?.toLowerCase().includes(lower) ||
                t.destination?.toLowerCase().includes(lower)
            );
            if (matched) {
              setActiveTripId(matched.id || matched._id);
            } else {
              setPromptInput(query);
            }
            setActivePage('planner-studio');
          }}
        />

        {/* Dynamic Page Views */}
        <main className="w-full min-w-0 pt-16 flex-1 flex flex-col bg-surface">
          {activePage === 'planner-studio' && (
            <ErrorBoundary
              fallbackTitle="Planner Studio Error"
              fallbackMessage="An unexpected error occurred while loading Planner Studio. You can reload the page, try again, or switch to another section from the navigation."
            >
              <PlannerStudioPage
                onUpgrade={upgrade}
                onBook={bookDemo}
                onBookings={goToBookings}
                trip={trip}
                travelContext={travelContext}
                currentIntent={currentIntent}
                onUpdatePreference={updateTravelPreference}
                days={days}
                flights={flights}
                hotels={hotels}
                nearbyHotels={nearbyHotels}
                weather={weather}
                budget={budget}
                messages={messages}
                promptInput={promptInput}
                onPromptChange={setPromptInput}
                onSendMessage={handleSendMessage}
                isSending={isSendingMessage}
                activeTab={activeDashboardTab}
                onSwitchTab={(tab) => {
                  if (tab === 'companion-tab' && !trip?.plusAccess) upgrade();
                  else setActiveDashboardTab(tab);
                }}
                onSelectFlight={handleSelectFlight}
                onSelectHotel={handleSelectHotel}
                onUpdateExecutionState={handleUpdateExecutionState}
                onApplyRerouteResult={handleApplyRerouteResult}
                apiStatus={apiStatus}
                onClearContext={handleClearContext}
                onNavigateToItineraryHub={() => setActivePage('itinerary-hub')}
                onNewTrip={handleNewTrip}
              />
            </ErrorBoundary>
          )}

          {activePage === 'itinerary-hub' && (
            <ErrorBoundary
              fallbackTitle="Itinerary Hub Error"
              fallbackMessage="An unexpected error occurred while loading your expeditions. You can reload the page, try again, or navigate back to the studio."
            >
              <ItineraryHubPage
                currentTrip={trip}
                availableTrips={rawTripsHistory}
                savedTrips={savedTrips}
                isLoading={isLoadingTrips}
                onOpenTrip={async (id) => {
                  return await setActiveTripId(id);
                }}
                onGoToStudio={() => setActivePage('planner-studio')}
                onNewTrip={handleNewTrip}
                onDeleteTrip={handleDeleteTrip}
                isCreatingTrip={isSendingMessage}
              />
            </ErrorBoundary>
          )}

          {activePage === 'bookings-desk' && (
            <ErrorBoundary
              fallbackTitle="Travel Selections Error"
              fallbackMessage="An unexpected error occurred while displaying your booking confirmations. You can reload the page or navigate to your itinerary."
            >
              <BookingsDeskPage
                onUpgrade={upgrade}
                onBook={bookDemo}
                onOpenOrder={openBooking}
                trip={trip}
                flights={flights}
                hotels={[...hotels, ...nearbyHotels]}
                onGoToStudio={() => setActivePage('planner-studio')}
                onNavigateToItineraryHub={() => setActivePage('itinerary-hub')}
              />
            </ErrorBoundary>
          )}

          {activePage === 'payments' && <ErrorBoundary fallbackTitle="Payments error" fallbackMessage="Reload to resume your saved demo order.">
            <PaymentsPage trip={trip} checkoutTripId={checkoutTripId} onConfirmed={confirmedBooking} onReturn={returnFromPayment} />
          </ErrorBoundary>}
          {activePage === 'ai-places-memory' && (
            <ErrorBoundary
              fallbackTitle="Example Places Error"
              fallbackMessage="An unexpected error occurred while browsing curated places. You can reload the page or return to the studio."
            >
              <AiPlacesMemoryPage
                onGoToStudio={() => {
                  setActiveDashboardTab('route-tab');
                  setActivePage('planner-studio');
                }}

              />
            </ErrorBoundary>
          )}
        </main>
      </div>

      {/* FastAPI Backend Configuration Modal */}
      <ApiConfigModal
        isOpen={isApiModalOpen}
        onClose={() => setIsApiModalOpen(false)}
        apiStatus={apiStatus}
        onUpdateApiUrl={updateApiUrl}
        isChecking={isCheckingApi}
      />
    </div>
    </TripBookingsContext.Provider>
  );
}

function AuthenticatedApp() {
  const { isAuthenticated, isLoading } = useAuth();
  const [authView, setAuthView] = useState<'login' | 'register'>('login');

  if (isLoading) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center text-slate-200">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#89ceff]" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return authView === 'login' ? (
      <LoginPage
        onLoginSuccess={() => {}}
        onGoToRegister={() => setAuthView('register')}
      />
    ) : (
      <RegisterPage
        onRegisterSuccess={() => setAuthView('login')}
        onGoToLogin={() => setAuthView('login')}
      />
    );
  }

  return <Suspense fallback={<div role="status" className="p-8">Loading your workspace…</div>}><AppContent /></Suspense>;
}

export default function App() {
  return (
    <ErrorBoundary
      fallbackTitle="Application Error"
      fallbackMessage="A critical application error occurred. You can reload the application to restart."
    >
      <AuthProvider>
        <AuthenticatedApp />
      </AuthProvider>
    </ErrorBoundary>
  );
}
