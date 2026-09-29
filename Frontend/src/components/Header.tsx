import React, { useState } from 'react';
import {
  Menu,
  PlaneTakeoff,
  ChevronDown,
  Search,
  Bell,
  Settings,
  User,
  Check,
  LogOut,
  Sun,
  Moon
} from 'lucide-react';
import { ApiStatusState, TripSummary } from '../types';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';

interface HeaderProps {
  apiStatus: ApiStatusState;
  activeTrip: TripSummary | null;
  onOpenApiModal: () => void;
  onToggleMobileSidebar: () => void;
  isSidebarCollapsed: boolean;
  onSelectTripPreset?: (presetId: string) => void | Promise<void>;
  onSearch?: (query: string) => void;
}

export const Header: React.FC<HeaderProps> = ({
  apiStatus,
  activeTrip,
  onOpenApiModal,
  onToggleMobileSidebar,
  isSidebarCollapsed,
  onSelectTripPreset,
  onSearch,
}) => {
  const { user, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const [isTripDropdownOpen, setIsTripDropdownOpen] = useState(false);
  const [showUserDropdown, setShowUserDropdown] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [showNotifications, setShowNotifications] = useState(false);
  const [notifications, setNotifications] = useState([
    {
      id: '1',
      title: 'Goa Flight Alert',
      desc: 'IndiGo 6E-204 fare synchronized via FastAPI :8001.',
      read: false,
    },
    {
      id: '2',
      title: 'Taj Holiday Village Confirmation',
      desc: 'Sea-view Cottage booked with complimentary breakfast.',
      read: false,
    },
  ]);

  const unreadCount = notifications.filter((n) => !n.read).length;

  const tripPresets = [
    { id: 'goa-coastal-v24', name: 'Goa Coastal Splendor & Heritage', location: 'Goa, India' },
    { id: 'tokyo-explorer', name: 'Tokyo Explorer & High-Speed Transit', location: 'Tokyo, Japan' },
    { id: 'rajasthan-heritage', name: 'Rajasthan Royal Haveli Heritage', location: 'Jaipur, India' },
  ];

  const handleKeyDownSearch = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && searchQuery.trim()) {
      if (onSearch) {
        onSearch(searchQuery.trim());
      }
    }
  };

  const handleMarkAllRead = () => {
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
  };

  return (
    <header
      className={`fixed top-0 right-0 h-16 bg-surface/85 backdrop-blur-xl z-30 border-b border-surface-container-high/40 transition-all duration-300 ${
        isSidebarCollapsed ? 'left-20' : 'left-0 lg:left-72'
      }`}
    >
      <div className="h-16 w-full px-4 lg:px-8 flex items-center justify-between">
        {/* Left Side: Mobile Menu Button, Brand Icon, Status & Trip Selector */}
        <div className="flex items-center gap-2 sm:gap-4">
          <button
            type="button"
            aria-label="Open navigation menu"
            onClick={onToggleMobileSidebar}
            className="p-2 rounded-xl text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface lg:hidden"
          >
            <Menu className="w-5 h-5" />
          </button>

          {/* FastAPI Connected Pill */}
          <button
            type="button"
            onClick={onOpenApiModal}
            className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-full bg-surface-container-low hover:bg-surface-container-high cursor-pointer transition-colors border border-surface-container-high/60 focus:outline-none"
            title="Click to configure FastAPI connection"
          >
            <span className="relative flex h-2 w-2">
              <span
                className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${
                  apiStatus.isConnected ? 'bg-tertiary' : 'bg-primary'
                }`}
              />
              <span
                className={`relative inline-flex rounded-full h-2 w-2 ${
                  apiStatus.isConnected ? 'bg-tertiary' : 'bg-primary'
                }`}
              />
            </span>
            <span className="text-xs text-on-surface font-medium">
              {apiStatus.isConnected ? 'FastAPI: localhost:8001 Connected' : 'FastAPI: Standby (Port 8001)'}
            </span>
          </button>

          {/* Active Trip Selector Dropdown */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setIsTripDropdownOpen(!isTripDropdownOpen)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-surface-container hover:bg-surface-container-high text-on-surface text-xs font-medium transition-colors border border-surface-container-high/40"
            >
              <PlaneTakeoff className="w-4 h-4 text-primary" />
              <span className="truncate max-w-[140px] sm:max-w-[180px] md:max-w-[240px]">
                {activeTrip ? activeTrip.title : 'No Active Trip'}
              </span>
              <ChevronDown className="w-4 h-4 text-on-surface-variant" />
            </button>

            {isTripDropdownOpen && (
              <>
                <div
                  className="fixed inset-0 z-40"
                  onClick={() => setIsTripDropdownOpen(false)}
                />
                <div className="absolute left-0 mt-2 w-72 rounded-xl bg-surface-container-high/95 backdrop-blur-xl border border-surface-container-highest shadow-2xl p-1.5 z-50 animate-in fade-in zoom-in-95">
                  <div className="px-2.5 py-1.5 text-[11px] font-semibold text-on-surface-variant uppercase tracking-wider">
                    Select Active Trip
                  </div>
                  {tripPresets.length === 0 ? (
                    <div className="px-3 py-3 text-xs text-on-surface-variant text-center">
                      No saved expeditions found
                    </div>
                  ) : (
                    tripPresets.map((preset, idx) => (
                      <button
                        key={preset.id || `preset-${idx}`}
                        type="button"
                        onClick={async () => {
                          if (onSelectTripPreset) await onSelectTripPreset(preset.id);
                          setIsTripDropdownOpen(false);
                        }}
                        className="w-full flex items-center justify-between px-3 py-2 rounded-lg text-left text-xs hover:bg-surface-container text-on-surface transition-colors"
                      >
                        <div>
                          <div className="font-medium text-on-surface">{preset.name}</div>
                          <div className="text-[11px] text-on-surface-variant">{preset.location}</div>
                        </div>
                        {activeTrip?.id === preset.id && (
                          <Check className="w-4 h-4 text-primary" />
                        )}
                      </button>
                    ))
                  )}
                </div>
              </>
            )}
          </div>
        </div>

        {/* Right Side: Search, Notifications, Settings, Profile */}
        <div className="flex items-center gap-2 sm:gap-4">
          {/* Global Search */}
          <div className="hidden lg:flex items-center gap-2 px-3 py-1.5 rounded-xl bg-surface-container-lowest text-on-surface-variant border border-surface-container-high/40 w-64 xl:w-80">
            <Search className="w-4 h-4 text-on-surface-variant flex-shrink-0" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={handleKeyDownSearch}
              placeholder="Search flights, stays, or prompt..."
              className="bg-transparent text-xs text-on-surface placeholder:text-on-surface-variant focus:outline-none w-full"
            />
            <kbd className="px-1.5 py-0.5 rounded bg-surface-container-high text-[10px] font-semibold text-on-surface-variant uppercase tracking-wider">
              ↵ Enter
            </kbd>
          </div>

          {/* Action buttons */}
          <div className="flex items-center gap-1">
            <div className="relative">
              <button
                type="button"
                aria-label="Notifications"
                onClick={() => setShowNotifications(!showNotifications)}
                className="p-2 rounded-xl text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface transition-colors relative"
                title="Notifications"
              >
                <Bell className="w-4 h-4" />
                {unreadCount > 0 && (
                  <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-primary" />
                )}
              </button>

              {showNotifications && (
                <>
                  <div
                    className="fixed inset-0 z-40"
                    onClick={() => setShowNotifications(false)}
                  />
                  <div className="absolute right-0 mt-2 w-80 rounded-xl bg-surface-container-high/95 backdrop-blur-xl border border-surface-container-highest shadow-2xl p-3 z-50">
                    <div className="flex items-center justify-between pb-2 border-b border-surface-container-highest/60">
                      <span className="text-xs font-semibold text-on-surface">
                        Notifications {unreadCount > 0 && `(${unreadCount})`}
                      </span>
                      <button
                        type="button"
                        onClick={handleMarkAllRead}
                        className="text-[11px] text-primary hover:underline font-medium focus:outline-none"
                      >
                        Mark all read
                      </button>
                    </div>
                    <div className="py-2 space-y-2 text-xs">
                      {notifications.map((n) => (
                        <div
                          key={n.id}
                          className={`p-2 rounded-lg transition-colors ${
                            n.read
                              ? 'bg-surface-container-low/40 opacity-70'
                              : 'bg-surface-container-low/90 border border-primary/20'
                          }`}
                        >
                          <div className="flex items-center justify-between font-medium text-on-surface">
                            <span>{n.title}</span>
                            {!n.read && (
                              <span className="w-1.5 h-1.5 rounded-full bg-primary" />
                            )}
                          </div>
                          <div className="text-[11px] text-on-surface-variant">{n.desc}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                </>
              )}
            </div>

            <button
              type="button"
              aria-label="Toggle Theme"
              onClick={toggleTheme}
              className="p-2 rounded-xl text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface transition-colors"
              title="Toggle Light/Dark Mode"
            >
              {theme === 'light' ? <Moon className="w-4 h-4" /> : <Sun className="w-4 h-4" />}
            </button>

            <button
              type="button"
              aria-label="API Settings"
              onClick={onOpenApiModal}
              className="p-2 rounded-xl text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface transition-colors"
              title="FastAPI Settings & Backend URL"
            >
              <Settings className="w-4 h-4" />
            </button>
          </div>

          {/* User Profile Avatar */}
          <div className="relative flex items-center gap-2 pl-1">
            <button
              type="button"
              aria-label="User Profile"
              onClick={() => setShowUserDropdown(!showUserDropdown)}
              title={user ? `${user.name} (${user.email})` : 'Traveler Profile'}
              className="w-8 h-8 rounded-full bg-primary flex items-center justify-center shadow-[0_0_12px_rgba(137,206,255,0.35)] text-on-primary hover:opacity-90 transition-opacity font-bold text-xs cursor-pointer"
            >
              {user?.name ? user.name.charAt(0).toUpperCase() : <User className="w-4 h-4" />}
            </button>

            {showUserDropdown && (
              <>
                <div
                  className="fixed inset-0 z-40"
                  onClick={() => setShowUserDropdown(false)}
                />
                <div className="absolute right-0 top-10 mt-2 w-64 rounded-xl bg-surface-container-high/95 backdrop-blur-xl border border-surface-container-highest shadow-2xl p-3 z-50 animate-in fade-in zoom-in-95">
                  <div className="pb-2.5 border-b border-surface-container-highest/60 mb-2">
                    <div className="font-semibold text-xs text-on-surface truncate">
                      {user?.name || 'Explorer'}
                    </div>
                    <div className="text-[11px] text-on-surface-variant truncate">
                      {user?.email || 'user@travelai.com'}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setShowUserDropdown(false);
                      logout();
                    }}
                    className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs text-error hover:bg-error/10 transition-colors cursor-pointer"
                  >
                    <LogOut className="w-4 h-4" />
                    <span>Sign Out</span>
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </header>
  );
};
