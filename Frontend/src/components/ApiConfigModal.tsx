import React, { useRef, useState } from 'react';
import { useModalFocus } from '../hooks/useModalFocus';
import {
  X,
  Server,
  RefreshCw,
  CheckCircle2,
  AlertCircle,
  Code2
} from 'lucide-react';
import { ApiStatusState } from '../types';

interface ApiConfigModalProps {
  isOpen: boolean;
  onClose: () => void;
  apiStatus: ApiStatusState;
  onUpdateApiUrl: (url: string) => Promise<void>;
  isChecking: boolean;
}

export const ApiConfigModal: React.FC<ApiConfigModalProps> = ({
  isOpen,
  onClose,
  apiStatus,
  onUpdateApiUrl,
  isChecking,
}) => {
  const [inputUrl, setInputUrl] = useState(apiStatus.endpointUrl);
  const [isTesting, setIsTesting] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const panel = useRef<HTMLDivElement>(null);
  useModalFocus(panel, isOpen, onClose);

  if (!isOpen) return null;

  // 1. Save Button Handler: Saves URL, re-checks API status via onUpdateApiUrl, shows feedback
  const handleSave = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const trimmed = inputUrl.trim();
    if (!trimmed) {
      setFeedback({ type: 'error', message: 'FastAPI URL cannot be empty.' });
      return;
    }
    setFeedback(null);
    try {
      await onUpdateApiUrl(trimmed);
      setFeedback({
        type: 'success',
        message: `Configuration saved: Base URL updated to ${trimmed} and synchronized.`,
      });
      setTimeout(() => {
        setFeedback((prev) => (prev?.type === 'success' ? null : prev));
      }, 4000);
    } catch (err: any) {
      setFeedback({
        type: 'error',
        message: `Failed to save URL: ${err.message || 'Unknown error.'}`,
      });
    }
  };

  // 2. Test Button Handler: Performs live GET / health check against configured FastAPI host
  const handleTest = async () => {
    setIsTesting(true);
    setFeedback(null);
    const targetUrl = inputUrl.trim().replace(/\/+$/, '');
    try {
      const res = await fetch(`${targetUrl}/`, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(6000),
      });
      if (res.ok) {
        const data = await res.json().catch(() => ({}));
        setFeedback({
          type: 'success',
          message: `Connection Verified: GET / returned HTTP ${res.status} (${data.message || 'FastAPI Online'}).`,
        });
      } else {
        setFeedback({
          type: 'error',
          message: `Health Check Failed: Server returned HTTP ${res.status}: ${res.statusText}.`,
        });
      }
    } catch (err: any) {
      setFeedback({
        type: 'error',
        message: `Network Error: Could not reach ${targetUrl}/. Ensure your FastAPI server is running.`,
      });
    } finally {
      setIsTesting(false);
    }
  };

  // Reset to default http://localhost:8001
  const handleResetToDefault = async () => {
    const defaultUrl = 'http://localhost:8001';
    setInputUrl(defaultUrl);
    setFeedback(null);
    try {
      await onUpdateApiUrl(defaultUrl);
      setFeedback({
        type: 'success',
        message: 'Reset URL to default http://localhost:8001 and verified connection.',
      });
      setTimeout(() => {
        setFeedback((prev) => (prev?.type === 'success' ? null : prev));
      }, 4000);
    } catch (err: any) {
      setFeedback({
        type: 'error',
        message: `Failed to reset: ${err.message || 'Unknown error.'}`,
      });
    }
  };

  return (
    <div
      className="motion-backdrop fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-md"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div ref={panel} role="dialog" aria-modal="true" aria-labelledby="api-settings-title" tabIndex={-1} className="motion-dialog w-full max-w-xl rounded-2xl bg-surface-container border border-surface-container-highest shadow-2xl overflow-hidden">
        {/* Modal Header */}
        <div className="px-6 py-4 border-b border-surface-container-high flex items-center justify-between bg-surface-container-low">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-primary/10 text-primary">
              <Server className="w-5 h-5" />
            </div>
            <div>
              <h3 id="api-settings-title" className="text-base font-semibold text-on-surface">
                FastAPI Backend Connection
              </h3>
              <p className="text-xs text-on-surface-variant">
                Configure your REST API host & verify live communication
              </p>
            </div>
          </div>
          <button
            type="button"
            aria-label="Close modal"
            onClick={onClose}
            className="p-1.5 rounded-lg text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6 space-y-5 max-h-[75vh] overflow-y-auto">
          {/* Connection Status Banner */}
          <div
            className={`p-4 rounded-xl border flex items-start gap-3 ${
              apiStatus.isConnected
                ? 'bg-tertiary-container/15 border-tertiary/30 text-on-surface'
                : 'bg-primary-container/10 border-primary/20 text-on-surface'
            }`}
          >
            {apiStatus.isConnected ? (
              <CheckCircle2 className="w-5 h-5 text-tertiary flex-shrink-0 mt-0.5" />
            ) : (
              <AlertCircle className="w-5 h-5 text-primary flex-shrink-0 mt-0.5" />
            )}
            <div className="space-y-1">
              <div className="text-xs sm:text-sm font-semibold flex items-center gap-2">
                <span>
                  {apiStatus.isConnected ? 'FastAPI Connected' : 'Mock Fallback / Standby Mode'}
                </span>
                <span
                  className={`text-[10px] px-2 py-0.5 rounded-full font-mono ${
                    apiStatus.isConnected
                      ? 'bg-tertiary text-on-tertiary font-bold'
                      : 'bg-primary/20 text-primary font-medium'
                  }`}
                >
                  {apiStatus.statusMessage}
                </span>
              </div>
              <p className="text-xs text-on-surface-variant leading-relaxed">
                {apiStatus.isConnected
                  ? 'Your FastAPI REST server is responding. Real payloads from your backend will seamlessly hydrate the UI.'
                  : 'Frontend is running in standby client mode. Once you run your FastAPI app (uvicorn app.main:travel_ai --reload --port 8001), it will connect immediately.'}
              </p>
            </div>
          </div>

          {/* Form with Distinct Test and Save Buttons */}
          <form onSubmit={handleSave} className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-on-surface flex items-center justify-between">
                <span>FastAPI Base URL:</span>
                <span className="text-[11px] text-on-surface-variant font-mono">
                  Env: VITE_FASTAPI_URL
                </span>
              </label>
              <div className="flex flex-col sm:flex-row gap-2">
                <input
                  type="text"
                  value={inputUrl}
                  onChange={(e) => setInputUrl(e.target.value)}
                  placeholder="http://localhost:8001"
                  className="flex-1 px-3 py-2 rounded-xl bg-surface-container-lowest border border-surface-container-highest text-xs sm:text-sm text-on-surface font-mono focus:outline-none focus:border-primary transition-colors"
                />
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={handleTest}
                    disabled={isTesting || isChecking}
                    className="px-3 py-2 rounded-xl bg-surface-container-high hover:bg-surface-bright text-on-surface text-xs sm:text-sm font-medium border border-surface-container-highest transition-colors flex items-center gap-1.5 disabled:opacity-50"
                  >
                    {isTesting ? (
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <span>Test Connection</span>
                    )}
                  </button>
                  <button
                    type="submit"
                    disabled={isChecking || isTesting}
                    className="px-4 py-2 rounded-xl bg-primary text-on-primary text-xs sm:text-sm font-medium hover:bg-primary-fixed transition-colors flex items-center gap-1.5 disabled:opacity-50"
                  >
                    {isChecking ? (
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <span>Save URL</span>
                    )}
                  </button>
                </div>
              </div>
            </div>

            {/* User Feedback Message (Success / Error) */}
            {feedback && (
              <div
                className={`p-3 rounded-xl text-xs flex items-center gap-2 border animate-in fade-in ${
                  feedback.type === 'success'
                    ? 'bg-tertiary-container/20 border-tertiary/40 text-on-surface'
                    : 'bg-error-container/20 border-error/40 text-on-error-container'
                }`}
              >
                {feedback.type === 'success' ? (
                  <CheckCircle2 className="w-4 h-4 text-tertiary flex-shrink-0" />
                ) : (
                  <AlertCircle className="w-4 h-4 text-error flex-shrink-0" />
                )}
                <span>{feedback.message}</span>
              </div>
            )}

            <div className="flex items-center justify-between text-xs">
              <button
                type="button"
                onClick={handleResetToDefault}
                className="text-primary hover:underline font-medium"
              >
                Reset to http://localhost:8001
              </button>
            </div>
          </form>

          {/* Expected FastAPI Endpoints Spec Box */}
          <div className="rounded-xl bg-surface-container-lowest p-4 border border-surface-container-highest/60 space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-on-surface flex items-center gap-1.5">
                <Code2 className="w-4 h-4 text-primary" />
                <span>Approved 7 FastAPI REST Endpoints:</span>
              </span>
              <span className="text-[11px] text-outline font-mono">OpenAPI 3.0</span>
            </div>

            <div className="space-y-1.5 font-mono text-[11px] text-on-surface-variant">
              <div className="flex items-center justify-between p-1.5 rounded bg-surface-container-low">
                <span className="text-tertiary">GET /</span>
                <span className="text-outline">Health check ping</span>
              </div>
              <div className="flex items-center justify-between p-1.5 rounded bg-surface-container-low">
                <span className="text-primary">POST /api/trips/plan</span>
                <span className="text-outline">Create trip & agent pipeline</span>
              </div>
              <div className="flex items-center justify-between p-1.5 rounded bg-surface-container-low">
                <span className="text-tertiary">GET /api/trips/history</span>
                <span className="text-outline">List full trip history</span>
              </div>
              <div className="flex items-center justify-between p-1.5 rounded bg-surface-container-low">
                <span className="text-primary">POST /api/chat/message</span>
                <span className="text-outline">Threaded chat ({'{'}message, conversation_id{'}'})</span>
              </div>
              <div className="flex items-center justify-between p-1.5 rounded bg-surface-container-low">
                <span className="text-tertiary">GET /api/chat/conversations</span>
                <span className="text-outline">List conversations</span>
              </div>
              <div className="flex items-center justify-between p-1.5 rounded bg-surface-container-low">
                <span className="text-tertiary">GET /api/chat/conversations/{'{id}'}</span>
                <span className="text-outline">Load conversation messages</span>
              </div>
              <div className="flex items-center justify-between p-1.5 rounded bg-surface-container-low">
                <span className="text-primary">DELETE /api/chat/conversations/{'{id}'}</span>
                <span className="text-outline">Delete conversation</span>
              </div>
            </div>
          </div>
        </div>

        {/* Modal Footer (Close Button) */}
        <div className="px-6 py-3.5 bg-surface-container-low border-t border-surface-container-high flex items-center justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl bg-surface-container-high hover:bg-surface-bright text-on-surface text-xs sm:text-sm font-medium transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
