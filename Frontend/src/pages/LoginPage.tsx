import React, { useState } from 'react';
import { motion } from 'motion/react';
import { Compass, Mail, Lock, Eye, EyeOff, ArrowRight, Loader2 } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

export interface LoginPageProps {
  onLoginSuccess: () => void;
  onGoToRegister: () => void;
  backgroundImage?: string;
}

export const LoginPage: React.FC<LoginPageProps> = ({
  onLoginSuccess,
  onGoToRegister,
  backgroundImage = 'https://images.unsplash.com/photo-1464822759023-fed622ff2c3b?auto=format&fit=crop&w=2400&q=85',
}) => {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [forgotModalOpen, setForgotModalOpen] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    if (!email.trim() || !password) {
      setErrorMessage('Please enter both email and password.');
      return;
    }

    setIsLoading(true);

    try {
      const result = await login(email, password);
      if (result.success) {
        onLoginSuccess();
      } else {
        setErrorMessage(result.error || 'Invalid credentials. Please try again.');
      }
    } catch {
      setErrorMessage('Network error occurred. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div
      id="login-page-container"
      className="relative min-h-screen w-full flex items-center justify-between overflow-hidden bg-slate-950 font-sans"
    >
      {/* Background Image & Fallback Gradients */}
      <div
        id="login-background"
        className="absolute inset-0 bg-cover bg-center bg-no-repeat transition-opacity duration-1000"
        style={{
          backgroundImage: `url("${backgroundImage}")`,
        }}
      />
      {/* Exact Dark Overlay (rgba(0,0,0,0.55)) plus subtle vignette */}
      <div
        id="login-dark-overlay"
        className="absolute inset-0 bg-black/55 backdrop-brightness-90 bg-gradient-to-t from-black/80 via-transparent to-black/40"
      />

      {/* Main Container */}
      <div className="relative z-10 w-full h-full min-h-screen max-w-7xl mx-auto px-6 sm:px-12 py-10 flex flex-col lg:flex-row justify-between lg:items-center">
        
        {/* LEFT SIDE (Bottom-left aligned area) */}
        <motion.div
          id="login-left-brand-section"
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, ease: 'easeOut' }}
          className="lg:self-end mb-12 lg:mb-16 max-w-xl pt-10 lg:pt-0"
        >
          {/* Small badge pill */}
          <div
            id="waypoint-badge"
            className="inline-flex items-center gap-2.5 px-3 py-1.5 rounded-full bg-[#182234]/85 backdrop-blur-md border border-white/10 shadow-lg shadow-black/40 mb-6"
          >
            <div className="w-5 h-5 rounded-full bg-[#38bdf8] flex items-center justify-center text-slate-950">
              <Compass className="w-3.5 h-3.5" />
            </div>
            <span className="text-[11px] font-semibold tracking-wider text-slate-200 uppercase">
              TRAVELAI WAYPOINT
            </span>
            <span className="w-1.5 h-1.5 rounded-full bg-[#89ceff] animate-pulse" />
          </div>

          {/* Large bold heading */}
          <h1
            id="brand-hero-heading"
            className="text-6xl sm:text-7xl lg:text-[76px] font-extrabold text-white tracking-tight leading-[1.05]"
          >
            TravelAI
          </h1>

          {/* Short horizontal white divider line */}
          <div
            id="brand-hero-divider"
            className="w-16 h-[2px] bg-white/80 my-5 rounded-full"
          />

          {/* Subtext */}
          <p
            id="brand-hero-subtext"
            className="text-slate-300 text-lg sm:text-xl font-normal tracking-wide max-w-md drop-shadow-sm"
          >
            Personalized trips, Real experiences
          </p>
        </motion.div>

        {/* RIGHT SIDE — Glassmorphism Login Card (floating, right-center) */}
        <motion.div
          id="login-glass-card-wrapper"
          initial={{ opacity: 0, scale: 0.96, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 0.15, ease: 'easeOut' }}
          className="w-full flex justify-center lg:justify-end my-auto"
        >
          <div
            id="login-card"
            style={{
              backgroundColor: 'rgba(30, 34, 44, 0.88)',
              backdropFilter: 'blur(24px)',
              WebkitBackdropFilter: 'blur(24px)',
              borderColor: 'rgba(255, 255, 255, 0.08)',
            }}
            className="w-full max-w-[380px] p-[40px] rounded-2xl border shadow-2xl shadow-black/60 relative overflow-hidden"
          >
            {/* Top Brand Header */}
            <div id="login-card-header" className="mb-6">
              <span className="text-xs text-slate-400 font-normal block mb-1">
                Welcome to
              </span>
              <div className="flex items-baseline gap-0.5">
                <span className="text-[28px] font-bold text-white tracking-tight">
                  Travel
                </span>
                <span className="text-[28px] font-bold text-[#89ceff] tracking-tight">
                  AI
                </span>
              </div>
              <p className="text-[10px] uppercase tracking-[0.2em] font-medium text-slate-400 mt-1">
                YOUR AI TRAVEL COMPANION
              </p>
            </div>

            {/* Login Form */}
            <form id="login-form" onSubmit={handleSubmit} className="space-y-4">
              {/* Email Input */}
              <div id="login-email-group" className="space-y-1.5">
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
                    <Mail className="w-4 h-4" />
                  </div>
                  <input
                    id="login-email-input"
                    aria-label="Email"
                    autoComplete="username"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="Enter your email"
                    required
                    style={{ backgroundColor: 'rgba(255, 255, 255, 0.06)' }}
                    className="w-full pl-10 pr-4 py-2.5 text-sm text-slate-100 placeholder-slate-400 rounded-xl border border-white/10 focus:outline-none focus:ring-1 focus:ring-[#89ceff]/50 focus:border-[#89ceff]/50 transition-all"
                  />
                </div>
              </div>

              {/* Password Input */}
              <div id="login-password-group" className="space-y-1.5">
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
                    <Lock className="w-4 h-4" />
                  </div>
                  <input
                    id="login-password-input"
                    aria-label="Password"
                    autoComplete="current-password"
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Enter your password"
                    required
                    style={{ backgroundColor: 'rgba(255, 255, 255, 0.06)' }}
                    className="w-full pl-10 pr-10 py-2.5 text-sm text-slate-100 placeholder-slate-400 rounded-xl border border-white/10 focus:outline-none focus:ring-1 focus:ring-[#89ceff]/50 focus:border-[#89ceff]/50 transition-all"
                  />
                  <button
                    type="button"
                    id="login-password-toggle-btn"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute inset-y-0 right-0 pr-3.5 flex items-center text-slate-400 hover:text-slate-200 focus:outline-none transition-colors"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>

                {/* Forgot Password Link */}
                <div className="flex justify-end pt-0.5">
                  <button
                    type="button"
                    id="forgot-password-link"
                    onClick={() => setForgotModalOpen(true)}
                    className="text-[11px] text-slate-400 hover:text-slate-200 transition-colors"
                  >
                    Forgot password?
                  </button>
                </div>
              </div>

              {/* Sign In Button */}
              <button
                type="submit"
                id="login-submit-btn"
                disabled={isLoading}
                className="w-full mt-2 py-3 px-4 bg-white hover:bg-slate-100 text-slate-950 font-bold rounded-xl flex items-center justify-center gap-2 text-sm shadow-md hover:scale-[1.02] hover:shadow-[0_0_25px_rgba(255,255,255,0.35)] active:scale-[0.99] transition-all duration-200 disabled:opacity-75 cursor-pointer"
              >
                {isLoading ? (
                  <motion.div
                    animate={{ rotate: 360 }}
                    transition={{ repeat: Infinity, duration: 1, ease: 'linear' }}
                    className="flex items-center gap-2"
                  >
                    <Loader2 className="w-4 h-4 text-slate-950" />
                    <span>Signing in...</span>
                  </motion.div>
                ) : (
                  <>
                    <span>Sign In</span>
                    <ArrowRight className="w-4 h-4 stroke-[2.5]" />
                  </>
                )}
              </button>

              {/* Error Message */}
              {errorMessage && (
                <motion.div
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  id="login-error-message"
                  role="alert"
                  className="text-red-400 text-xs text-center mt-2 px-1 py-1 rounded bg-red-950/40 border border-red-800/40"
                >
                  {errorMessage}
                </motion.div>
              )}
            </form>

            {/* Don't have an account? Create one */}
            <div id="login-register-redirect" className="text-center text-xs text-slate-400">
              <span>Don't have an account? </span>
              <button
                type="button"
                id="login-goto-register-btn"
                onClick={onGoToRegister}
                className="text-[#89ceff] hover:underline font-semibold transition-colors"
              >
                Create one
              </button>
            </div>
          </div>
        </motion.div>
      </div>

      {forgotModalOpen && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onKeyDown={event => { if (event.key === 'Escape') setForgotModalOpen(false); }}>
        <div role="dialog" aria-modal="true" aria-labelledby="recovery-title" className="w-full max-w-sm p-6 rounded-2xl border border-white/10 bg-slate-900">
          <h3 id="recovery-title" className="font-bold text-white mb-2">Password recovery</h3>
          <p className="text-sm text-slate-300 mb-4">Email password recovery is not configured for this installation. Contact the project administrator to recover access.</p>
          <button autoFocus type="button" onClick={() => setForgotModalOpen(false)} className="px-4 py-2 rounded-lg bg-sky-200 text-slate-900">Close</button>
        </div>
      </div>}
    </div>
  );
};

export default LoginPage;
