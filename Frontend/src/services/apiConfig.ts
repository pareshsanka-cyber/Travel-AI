export function getApiBaseUrl(): string {
  return (localStorage.getItem('TRAVELAI_FASTAPI_URL')?.trim() ||
    import.meta.env?.VITE_FASTAPI_URL || import.meta.env?.VITE_API_URL ||
    'http://localhost:8000').replace(/\/+$/, '');
}
