import { motionTokens } from '../motion/tokens';
import React, { useState, useMemo } from 'react';
import { motion } from 'motion/react';
import { Compass, User as UserIcon, Mail, Lock, Eye, EyeOff, ArrowRight, Loader2 } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

export interface RegisterPageProps {
  onRegisterSuccess: () => void;
  onGoToLogin: () => void;
  backgroundImage?: string;
}

export const RegisterPage: React.FC<RegisterPageProps> = ({
  onRegisterSuccess,
  onGoToLogin,
  backgroundImage = 'https://images.unsplash.com/photo-1464822759023-fed622ff2c3b?auto=format&fit=crop&w=2400&q=85',
}) => {
  const { register } = useAuth();
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Password strength calculation: 3 segments (0 = none, 1 = weak, 2 = medium, 3 = strong)
  const strengthScore = useMemo(() => {
    if (!password) return 0;
    let score = 0;
    if (password.length >= 6) score += 1;
    if (password.length >= 8 && (/[0-9]/.test(password) || /[A-Z]/.test(password))) score += 1;
    if (password.length >= 10 && /[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]/.test(password) && /[0-9]/.test(password)) score += 1;
    return Math.min(3, Math.max(password.length >= 1 ? 1 : 0, score));
  }, [password]);

  const strengthColor = useMemo(() => {
    if (strengthScore === 1) return { label: 'Weak', barClass: 'bg-rose-500', textClass: 'text-rose-400' };
    if (strengthScore === 2) return { label: 'Medium', barClass: 'bg-amber-400', textClass: 'text-amber-300' };
    if (strengthScore >= 3) return { label: 'Strong', barClass: 'bg-emerald-400', textClass: 'text-emerald-300' };
    return { label: '', barClass: 'bg-slate-700', textClass: 'text-slate-500' };
  }, [strengthScore]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    if (!fullName.trim()) {
      setErrorMessage('Please enter your full name.');
      return;
    }
    if (!email.trim()) {
      setErrorMessage('Please enter your email.');
      return;
    }
    if (password.length < 8) {
      setErrorMessage('Password must be at least 8 characters long.');
      return;
    }
    if (password !== confirmPassword) {
      setErrorMessage('Passwords do not match.');
      return;
    }

    setIsLoading(true);

    try {
      const result = await register(fullName.trim(), email.trim(), password);
      if (result.success) {
        onRegisterSuccess();
      } else {
        setErrorMessage(result.error || 'Registration failed. Please try again.');
      }
    } catch {
      setErrorMessage('An unexpected error occurred. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div
      id="register-page-container"
      className="relative min-h-screen w-full flex items-center justify-between overflow-hidden bg-slate-950 font-sans"
    >
      {/* Background Image */}
      <div
        id="register-background"
        className="absolute inset-0 bg-cover bg-center bg-no-repeat transition-opacity duration-1000"
        style={{
          backgroundImage: `url("${backgroundImage}")`,
        }}
      />
      {/* Exact Dark Overlay (rgba(0,0,0,0.55)) */}
      <div
        id="register-dark-overlay"
        className="absolute inset-0 bg-black/55 backdrop-brightness-90 bg-gradient-to-t from-black/80 via-transparent to-black/40"
      />

      {/* Main Container */}
      <div className="relative z-10 w-full h-full min-h-screen max-w-7xl mx-auto px-6 sm:px-12 py-8 flex flex-col lg:flex-row justify-between lg:items-center">
        {/* LEFT SIDE (Bottom-left area) */}
        <motion.div
          id="register-left-brand-section"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: motionTokens.overlay, ease: motionTokens.ease }}
          className="lg:self-end mb-8 lg:mb-16 max-w-xl pt-6 lg:pt-0"
        >
          {/* Small badge pill */}
          <div
            id="register-waypoint-badge"
            className="inline-flex items-center gap-2.5 px-3 py-1.5 rounded-full bg-[#182234]/85 backdrop-blur-md border border-white/10 shadow-lg shadow-black/40 mb-6"
          >
            <div className="w-5 h-5 rounded-full bg-[#38bdf8] flex items-center justify-center text-slate-950">
              <Compass className="w-3.5 h-3.5" />
            </div>
            <span className="text-[11px] font-semibold tracking-wider text-slate-200 uppercase">
              TRAVELAI WAYPOINT
            </span>
            <span className="w-1.5 h-1.5 rounded-full bg-[#89ceff]" />
          </div>

          <h1
            id="register-hero-heading"
            className="text-6xl sm:text-7xl lg:text-[76px] font-extrabold text-white tracking-tight leading-[1.05]"
          >
            TravelAI
          </h1>

          <div
            id="register-hero-divider"
            className="w-16 h-[2px] bg-white/80 my-5 rounded-full"
          />

          <p
            id="register-hero-subtext"
            className="text-slate-300 text-lg sm:text-xl font-normal tracking-wide max-w-md drop-shadow-sm"
          >
            Personalized trips, Real experiences
          </p>
        </motion.div>

        {/* RIGHT SIDE — Glassmorphism Register Card */}
        <motion.div
          id="register-glass-card-wrapper"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          transition={{ duration: motionTokens.overlay, ease: motionTokens.ease }}
          className="w-full flex justify-center lg:justify-end my-auto"
        >
          <div
            id="register-card"
            style={{
              backgroundColor: 'rgba(30, 34, 44, 0.88)',
              backdropFilter: 'blur(24px)',
              WebkitBackdropFilter: 'blur(24px)',
              borderColor: 'rgba(255, 255, 255, 0.08)',
            }}
            className="w-full max-w-[380px] p-[36px] rounded-2xl border shadow-2xl shadow-black/60 relative overflow-hidden"
          >
            {/* Card Header: "Create Account" with "Join TravelAI" subtitle */}
            <div id="register-card-header" className="mb-5">
              <span className="text-xs text-slate-400 font-normal block mb-1">
                Join TravelAI
              </span>
              <div className="flex items-baseline gap-1">
                <span className="text-[26px] font-bold text-white tracking-tight">
                  Create Account
                </span>
              </div>
              <p className="text-[10px] uppercase tracking-[0.2em] font-medium text-[#89ceff] mt-0.5">
                START YOUR EXPEDITION
              </p>
            </div>

            {/* Form */}
            <form id="register-form" onSubmit={handleSubmit} className="space-y-3.5">
              {/* Full Name */}
              <div id="register-name-group" className="space-y-1">
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
                    <UserIcon className="w-4 h-4" />
                  </div>
                  <input
                    id="register-name-input"
                    type="text"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    placeholder="Full name"
                    required
                    style={{ backgroundColor: 'rgba(255, 255, 255, 0.06)' }}
                    className="w-full pl-10 pr-4 py-2.5 text-sm text-slate-100 placeholder-slate-400 rounded-xl border border-white/10 focus:outline-none focus:ring-1 focus:ring-[#89ceff]/50 focus:border-[#89ceff]/50 transition-all"
                  />
                </div>
              </div>

              {/* Email */}
              <div id="register-email-group" className="space-y-1">
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
                    <Mail className="w-4 h-4" />
                  </div>
                  <input
                    id="register-email-input"
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

              {/* Password */}
              <div id="register-password-group" className="space-y-1.5">
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
                    <Lock className="w-4 h-4" />
                  </div>
                  <input
                    id="register-password-input"
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Create a password"
                    required
                    style={{ backgroundColor: 'rgba(255, 255, 255, 0.06)' }}
                    className="w-full pl-10 pr-10 py-2.5 text-sm text-slate-100 placeholder-slate-400 rounded-xl border border-white/10 focus:outline-none focus:ring-1 focus:ring-[#89ceff]/50 focus:border-[#89ceff]/50 transition-all"
                  />
                  <button
                    type="button"
                    id="register-password-toggle-btn"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute inset-y-0 right-0 pr-3.5 flex items-center text-slate-400 hover:text-slate-200 focus:outline-none transition-colors"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>

                {/* Password Strength Bar: 3 segments (red / yellow / green) */}
                {password.length > 0 && (
                  <div id="password-strength-container" className="pt-1">
                    <div className="flex items-center justify-between text-[11px] mb-1">
                      <span className="text-slate-400">Strength:</span>
                      <span className={`font-semibold ${strengthColor.textClass}`}>
                        {strengthColor.label}
                      </span>
                    </div>
                    <div className="grid grid-cols-3 gap-1.5 h-1.5">
                      <div
                        className={`rounded-full transition-all duration-300 ${
                          strengthScore >= 1 ? strengthColor.barClass : 'bg-slate-700/60'
                        }`}
                      />
                      <div
                        className={`rounded-full transition-all duration-300 ${
                          strengthScore >= 2 ? strengthColor.barClass : 'bg-slate-700/60'
                        }`}
                      />
                      <div
                        className={`rounded-full transition-all duration-300 ${
                          strengthScore >= 3 ? strengthColor.barClass : 'bg-slate-700/60'
                        }`}
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* Confirm Password */}
              <div id="register-confirm-password-group" className="space-y-1">
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
                    <Lock className="w-4 h-4" />
                  </div>
                  <input
                    id="register-confirm-password-input"
                    type={showConfirmPassword ? 'text' : 'password'}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Confirm password"
                    required
                    style={{ backgroundColor: 'rgba(255, 255, 255, 0.06)' }}
                    className="w-full pl-10 pr-10 py-2.5 text-sm text-slate-100 placeholder-slate-400 rounded-xl border border-white/10 focus:outline-none focus:ring-1 focus:ring-[#89ceff]/50 focus:border-[#89ceff]/50 transition-all"
                  />
                  <button
                    type="button"
                    id="register-confirm-toggle-btn"
                    onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                    className="absolute inset-y-0 right-0 pr-3.5 flex items-center text-slate-400 hover:text-slate-200 focus:outline-none transition-colors"
                  >
                    {showConfirmPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              {/* Create Account Button */}
              <button
                type="submit"
                id="register-submit-btn"
                disabled={isLoading}
                className="w-full mt-3 py-3 px-4 bg-white hover:bg-slate-100 text-slate-950 font-bold rounded-xl flex items-center justify-center gap-2 text-sm shadow-md transition-all duration-200 disabled:opacity-75 cursor-pointer"
              >
                {isLoading ? (
                  <motion.div
                    animate={{ rotate: 360 }}
                    transition={{ repeat: Infinity, duration: 1, ease: 'linear' }}
                    className="flex items-center gap-2"
                  >
                    <Loader2 className="w-4 h-4 text-slate-950" />
                    <span>Creating account...</span>
                  </motion.div>
                ) : (
                  <>
                    <span>Create Account</span>
                    <ArrowRight className="w-4 h-4 stroke-[2.5]" />
                  </>
                )}
              </button>

              {/* Error Message */}
              {errorMessage && (
                <motion.div
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  id="register-error-message"
                  className="text-red-400 text-xs text-center mt-2 px-1 py-1 rounded bg-red-950/40 border border-red-800/40"
                >
                  {errorMessage}
                </motion.div>
              )}
            </form>

            {/* Already have an account? Sign in */}
            <div id="register-login-redirect" className="text-center text-xs text-slate-400 mt-6 pt-3 border-t border-white/10">
              <span>Already have an account? </span>
              <button
                type="button"
                id="register-goto-login-btn"
                onClick={onGoToLogin}
                className="text-[#89ceff] hover:underline font-semibold transition-colors"
              >
                Sign in
              </button>
            </div>
          </div>
        </motion.div>
      </div>
    </div>
  );
};

export default RegisterPage;
