import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { User, AuthContextType } from '../types';
import { authRequest, AuthHttpError } from '../services/authTransport';

const TOKEN_KEY = 'travelai_token';
const USER_KEY = 'travelai_user';
const AuthContext = createContext<AuthContextType | undefined>(undefined);

function clearSessionStorage() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
  Object.keys(localStorage).filter(key => key.startsWith('TRAVELAI_') && key !== 'TRAVELAI_FASTAPI_URL')
    .forEach(key => localStorage.removeItem(key));
}

export const AuthProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [restoreAttempt, setRestoreAttempt] = useState(0);

  useEffect(() => {
    let mounted = true;
    setIsLoading(true); setSessionError(null);
    const storedToken = localStorage.getItem(TOKEN_KEY);
    if (!storedToken) { setIsLoading(false); return; }
    authRequest('me', undefined, storedToken).then(data => {
      if (!mounted) return;
      if (!data?.user?.id) throw new Error('Invalid session response');
      setUser(data.user); setToken(storedToken);
      localStorage.setItem(USER_KEY, JSON.stringify(data.user));
    }).catch(error => {
      if (!mounted) return;
      if (error instanceof AuthHttpError && [401, 403].includes(error.status)) clearSessionStorage();
      else setSessionError('Unable to verify your session. Your saved login and planning details are preserved. Check that the backend and MongoDB are running, then try again.');
    })
      .finally(() => { if (mounted) setIsLoading(false); });
    return () => { mounted = false; };
  }, [restoreAttempt]);

  useEffect(() => {
    const expire = () => { clearSessionStorage(); setSessionError(null); setUser(null); setToken(null); };
    window.addEventListener('travelai-session-expired', expire);
    return () => window.removeEventListener('travelai-session-expired', expire);
  }, []);

  const authenticate = async (path: string, body: object): Promise<{ success: boolean; error?: string }> => {
    try {
      const data = await authRequest(path, body);
      if (!data.token || !data.user?.id) throw new Error('Invalid authentication response');
      clearSessionStorage();
      localStorage.setItem(TOKEN_KEY, data.token);
      localStorage.setItem(USER_KEY, JSON.stringify(data.user));
      setToken(data.token); setUser(data.user);
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof TypeError ? 'Unable to reach TravelAI. Check your connection and try again.' : error instanceof Error && error.name === 'AbortError' ? 'The server took too long to respond. Please try again.' : error instanceof Error ? error.message : 'Unable to reach the server' };
    }
  };
  const login = (email: string, password: string) => authenticate('login', { email, password });
  const register = (name: string, email: string, password: string) => authenticate('register', { name, email, password });
  const logout = () => {
    if (token) void authRequest('logout', {}, token).catch(() => {});
    clearSessionStorage(); setSessionError(null); setToken(null); setUser(null);
  };
  return <AuthContext.Provider value={{ user, token, isAuthenticated: !!token && !!user,
    isLoading, login, register, logout, sessionError,
    retrySession: () => { setIsLoading(true); setRestoreAttempt(value => value + 1); },
    dismissSessionRecovery: () => { clearSessionStorage(); setSessionError(null); }
  }}>{children}</AuthContext.Provider>;
};

export const useAuth = (): AuthContextType => {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within an AuthProvider');
  return context;
};
