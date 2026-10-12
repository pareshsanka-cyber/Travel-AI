/**
 * TravelAI - Autonomous Trip Architecture Frontend
 * 
 * Production-ready React + TypeScript + Vite + Tailwind CSS frontend
 * configured to communicate with an existing FastAPI REST backend.
 */

import React, { useEffect, useState } from 'react';
import { AlertCircle, X } from 'lucide-react';
import { useTravelApi } from './hooks/useTravelApi';
import { Sidebar } from './components/Sidebar';
import { Header } from './components/Header';
import { ApiConfigModal } from './components/ApiConfigModal';
import { PlannerStudioPage } from './pages/PlannerStudioPage';
import { ItineraryHubPage } from './pages/ItineraryHubPage';
import { BookingsDeskPage } from './pages/BookingsDeskPage';
import { AiPlacesMemoryPage } from './pages/AiPlacesMemoryPage';
import { ErrorBoundary } from './components/ErrorBoundary';
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
    activeTrip,
    handleAppendPlaceToRoute,
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
  } = useTravelApi();

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
        onSelectPage={setActivePage}
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
        className={`flex-1 flex flex-col min-h-screen transition-all duration-300 ${
          isSidebarCollapsed ? 'lg:pl-20' : 'lg:pl-72'
        }`}
      >
        {/* Top Header */}
        <Header
          apiStatus={apiStatus}
          activeTrip={trip}
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
        <main className="w-full pt-16 flex-1 flex flex-col bg-surface">
          {activePage === 'planner-studio' && (
            <ErrorBoundary
              fallbackTitle="Planner Studio Error"
              fallbackMessage="An unexpected error occurred while loading Planner Studio. You can reload the page, try again, or switch to another section from the navigation."
            >
              <PlannerStudioPage
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
                onSwitchTab={setActiveDashboardTab}
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
              fallbackTitle="Bookings Desk Error"
              fallbackMessage="An unexpected error occurred while displaying your booking confirmations. You can reload the page or navigate to your itinerary."
            >
              <BookingsDeskPage
                trip={trip}
                flights={flights}
                hotels={hotels}
                onGoToStudio={() => setActivePage('planner-studio')}
                onNavigateToItineraryHub={() => setActivePage('itinerary-hub')}
              />
            </ErrorBoundary>
          )}

          {activePage === 'ai-places-memory' && (
            <ErrorBoundary
              fallbackTitle="AI Places Memory Error"
              fallbackMessage="An unexpected error occurred while browsing curated places. You can reload the page or return to the studio."
            >
              <AiPlacesMemoryPage
                onGoToStudio={() => {
                  setActiveDashboardTab('route-tab');
                  setActivePage('planner-studio');
                }}
                onAppendPlaceToRoute={(place) => {
                  return handleAppendPlaceToRoute(place);
                }}
                hasActiveTrip={Boolean(activeTrip && (activeTrip.id || activeTrip._id))}
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

  return <AppContent />;
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
