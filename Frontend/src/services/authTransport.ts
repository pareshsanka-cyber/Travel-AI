import { getApiBaseUrl } from './apiConfig';

export class AuthHttpError extends Error {
  constructor(message: string, public readonly status: number) { super(message); this.name = 'AuthHttpError'; }
}

export async function authRequest(path: string, body?: object, token?: string) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(`${getApiBaseUrl()}/api/auth/${path}`, {
      method: body ? 'POST' : 'GET',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}), signal: controller.signal,
    });
    let data: any;
    try { data = await response.json(); }
    catch { throw new AuthHttpError('The authentication service returned an unreadable response. Please retry.', response.status); }
    if (!response.ok) throw new AuthHttpError(typeof data?.detail === 'string' ? data.detail : 'Authentication failed', response.status);
    return data;
  } finally { clearTimeout(timer); }
}
