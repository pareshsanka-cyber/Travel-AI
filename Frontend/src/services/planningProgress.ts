import { apiFetch, ApiError, getApiBaseUrl } from './api';
import type { ChatMessageResponsePayload } from './api';
import type { ChatMessage } from '../types';

export type StageStatus = 'running' | 'done' | 'warning' | 'failed';
export interface PlanningRecovery {
  code?: string; retryable?: boolean; message?: string; retry_at?: string | null; failed_stage?: string | null;
}
export interface PlanningProgress {
  request_id: string;
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'interrupted' | 'restoring' | 'connection_lost';
  kind: 'request' | 'planning';
  conversation_id?: string | null;
  stages: Record<string, { status: StageStatus; note?: string | null }>;
  result?: ChatMessageResponsePayload | null;
  error?: string | null;
  trip_id?: string | null;
  retry_attempt_id?: string | null;
  recovery?: PlanningRecovery | null;
}
export interface PendingPlanningRequest {
  id: string; owner: string; endpoint: string; conversationId: string | null;
  text: string; prompt: string; context: Record<string, any>;
  observedServer?: boolean; retryAttemptId?: string;
}
const owner = () => { try { return JSON.parse(localStorage.getItem('travelai_user') || '{}').id as string || ''; } catch { return ''; } };
const storageKey = () => `TRAVELAI_PENDING_PLANNING:${owner()}`;
export function readPendingPlanning(): PendingPlanningRequest | null {
  try {
    const saved = JSON.parse(sessionStorage.getItem(storageKey()) || 'null');
    return saved?.owner === owner() && typeof saved?.id === 'string' && typeof saved?.prompt === 'string' ? saved : null;
  } catch { return null; }
}
export function savePendingPlanning(request: PendingPlanningRequest) { sessionStorage.setItem(storageKey(), JSON.stringify(request)); }
export function clearPendingPlanning(id: string) { if (readPendingPlanning()?.id === id) sessionStorage.removeItem(storageKey()); }
export function newPlanningRequest(text: string, prompt: string, context: Record<string, any>, conversationId: string | null): PendingPlanningRequest {
  return { id: crypto.randomUUID(), owner: owner(), endpoint: getApiBaseUrl(), conversationId, text, prompt, context };
}
export class ProgressUnavailable extends Error {
  constructor(public readonly progress: PlanningProgress) { super(progress.error || 'Unable to check planning progress.'); }
}
function snapshot(value: PlanningProgress, id: string) {
  if (value?.request_id !== id || !['queued', 'running', 'succeeded', 'failed', 'interrupted'].includes(value?.status) || !value.stages || typeof value.stages !== 'object') throw new Error('The server returned incomplete progress information.');
  return value;
}
function pause(signal: AbortSignal, delay = 1000) {
  return new Promise<void>((resolve, reject) => {
    const abort = () => { clearTimeout(timer); signal.removeEventListener('abort', abort); reject(new DOMException('Request monitoring stopped', 'AbortError')); };
    const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, delay);
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
  });
}

/** Resume by reading first. A missing request is resubmitted with the SAME idempotency key. */
export async function trackPlanning(request: PendingPlanningRequest, onProgress: (progress: PlanningProgress) => void, signal: AbortSignal, resume = false): Promise<{ replyMessage: ChatMessage; rawResponse: ChatMessageResponsePayload }> {
  let current: PlanningProgress = { request_id: request.id, status: 'restoring', kind: 'request', stages: {} };
  let create = !resume && !request.retryAttemptId, failures = 0;
  const assertSession = () => {
    if (signal.aborted || owner() !== request.owner) throw new DOMException('Session changed', 'AbortError');
    if (getApiBaseUrl() !== request.endpoint) throw new ProgressUnavailable({ ...current, status: 'connection_lost', error: 'API Settings changed. Restore the original connection to check this request.' });
  };
  for (;;) {
    assertSession();
    try {
      current = snapshot(await apiFetch<PlanningProgress>(create ? '/api/chat/requests' : `/api/chat/requests/${encodeURIComponent(request.id)}`, {
        method: create ? 'POST' : 'GET', ...(create ? { body: JSON.stringify({ request_id: request.id, message: request.prompt, conversation_id: request.conversationId }) } : {}),
        signal, timeoutMs: 8000,
      }), request.id);
      create = false;
      if (request.retryAttemptId && current.status === 'failed' && current.retry_attempt_id !== request.retryAttemptId && current.recovery?.retryable && !current.trip_id) {
        current = snapshot(await apiFetch<PlanningProgress>(`/api/chat/requests/${encodeURIComponent(request.id)}/retry`, {
          method: 'POST', body: JSON.stringify({ attempt_id: request.retryAttemptId }), signal, timeoutMs: 8000,
        }), request.id);
      }
      failures = 0;
      assertSession(); onProgress(current);
      if (['failed', 'interrupted'].includes(current.status)) throw new ProgressUnavailable({ ...current,
        error: current.error || current.result?.message?.content || 'The request stopped before a response was saved. Review saved trips before trying again.' });
      if (current.result) {
        if (current.status !== 'succeeded' || !current.result.conversation_id || !current.result.message?.content) throw new ProgressUnavailable({ ...current, status: 'connection_lost', error: 'The server response is incomplete. Check this request again before sending another one.' });
        return { rawResponse: current.result, replyMessage: { id: `assistant-request-${request.id}`, sender: 'assistant', text: current.result.message.content,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) } };
      }
      if (current.status === 'succeeded') throw new ProgressUnavailable({ ...current, status: 'connection_lost',
        error: 'The server finished this request, but its response is unavailable. Check status or review My trips before planning again.' });
    } catch (error) {
      if (signal.aborted || error instanceof ProgressUnavailable || (error instanceof DOMException && error.name === 'AbortError')) throw error;
      if (error instanceof ApiError && error.status === 404 && !create && !request.observedServer && !request.retryAttemptId) { create = true; continue; }
      if (error instanceof ApiError && error.status === 404 && request.observedServer) {
        throw new ProgressUnavailable({ ...current, status: 'interrupted', recovery: { retryable: false }, error: 'This request record is no longer available. Review My trips before sending a revised request. Your original details are preserved.' });
      }
      if (error instanceof ApiError && [400, 403, 409, 413, 422].includes(error.status)) {
        throw new ProgressUnavailable({ ...current, status: 'connection_lost', error: error.message });
      }
      create = false; // An uncertain POST is checked, never blindly submitted with a new key.
      if (++failures >= 3) throw new ProgressUnavailable({ ...current, status: 'connection_lost', error: 'Progress could not be checked. Your request may still be running; check its status before sending again.' });
    }
    await pause(signal, failures ? Math.min(4000, 1000 * 2 ** failures) : 1000);
  }
}
