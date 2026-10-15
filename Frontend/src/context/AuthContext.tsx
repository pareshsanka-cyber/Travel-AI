import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { User, AuthContextType } from '../types';
import { getApiBaseUrl } from '../services/apiConfig';

const TOKEN_KEY = 'travelai_token';
const USER_KEY = 'travelai_user';
const AuthContext = createContext<AuthContextType | undefined>(undefined);

function clearSessionStorage() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
  Object.keys(localStorage).filter(key => key.startsWith('TRAVELAI_') && key !== 'TRAVELAI_FASTAPI_URL')
    .forEach(key => localStorage.removeItem(key));
}

async function authRequest(path: string, body?: object, token?: string) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(`${getApiBaseUrl()}/api/auth/${path}`, {
      method: body ? 'POST' : 'GET',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}), signal: controller.signal,
    });
    const data = await response.json();
    if (!response.ok) throw new Error(typeof data.detail === 'string' ? data.detail : 'Authentication failed');
    return data;
  } finally { clearTimeout(timer); }
}

export const AuthProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    const storedToken = localStorage.getItem(TOKEN_KEY);
    if (!storedToken) { setIsLoading(false); return; }
    authRequest('me', undefined, storedToken).then(data => {
      if (!mounted) return;
      setUser(data.user); setToken(storedToken);
      localStorage.setItem(USER_KEY, JSON.stringify(data.user));
    }).catch(() => { if (mounted) clearSessionStorage(); })
      .finally(() => { if (mounted) setIsLoading(false); });
    return () => { mounted = false; };
  }, []);

  useEffect(() => {
    const expire = () => { clearSessionStorage(); setUser(null); setToken(null); };
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
    clearSessionStorage(); setToken(null); setUser(null);
  };
  return <AuthContext.Provider value={{ user, token, isAuthenticated: !!token && !!user,
    isLoading, login, register, logout }}>{children}</AuthContext.Provider>;
};

export const useAuth = (): AuthContextType => {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within an AuthProvider');
  return context;
};
