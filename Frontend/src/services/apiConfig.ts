export function getApiBaseUrl(): string {
  const fromStorage = localStorage.getItem('TRAVELAI_FASTAPI_URL')?.trim();
  const fromEnv = (import.meta.env?.VITE_FASTAPI_URL || import.meta.env?.VITE_API_URL)?.trim();
  const baseUrl = fromStorage || fromEnv || 'http://localhost:8000';
  return baseUrl.replace(/\/+$/, '');
}
