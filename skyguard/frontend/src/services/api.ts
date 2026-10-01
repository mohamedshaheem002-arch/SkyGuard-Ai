import type {
  NetworkMeta,
  OverviewData,
  StationDetailData,
  SystemHealth,
  IngestRequest,
  ScoreResponse,
  ObservationRow,
  ChatStatusResponse,
  ChatContextPayload,
} from '../types';

// Configurable API base URL using VITE_API_BASE_URL environment variable
const envBase = (import.meta.env.VITE_API_BASE_URL || '').trim().replace(/\/+$/, '');
export const API_BASE = envBase
  ? (envBase.endsWith('/api') ? envBase : `${envBase}/api`)
  : '/api';

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = 'ApiError';
  }
}

async function request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const url = `${API_BASE}${endpoint}`;
  try {
    const response = await fetch(url, {
      ...options,
      headers: {
        Accept: 'application/json',
        ...options.headers,
      },
    });

    if (!response.ok) {
      let errorDetail = response.statusText;
      try {
        const errorJson = await response.json();
        if (errorJson && errorJson.detail) {
          errorDetail = errorJson.detail;
        }
      } catch {
        // Fall back to status text
      }
      throw new ApiError(response.status, errorDetail);
    }

    return (await response.json()) as T;
  } catch (err: any) {
    if (err instanceof ApiError) {
      throw err;
    }
    throw new ApiError(0, err.message || 'Network connection failed to SkyGuard API');
  }
}

export const apiService = {
  // 1. GET /api/health
  getHealth: () => request<SystemHealth>('/health'),

  // 2. GET /api/meta
  getMeta: () => request<NetworkMeta>('/meta'),

  // 3. GET /api/overview
  getOverview: () => request<OverviewData>('/overview'),

  // 4. GET /api/station/{sid}
  getStation: (stationId: string, days: number = 14) =>
    request<StationDetailData>(`/station/${encodeURIComponent(stationId)}?days=${days}`),

  // 5. GET /api/sample_csv
  getSampleCsv: async (): Promise<Blob> => {
    const res = await fetch(`${API_BASE}/sample_csv`);
    if (!res.ok) throw new ApiError(res.status, 'Failed to fetch sample CSV');
    return await res.blob();
  },

  // 6. POST /api/score
  scoreFile: async (file: File, explain: boolean = true): Promise<ScoreResponse> => {
    const formData = new FormData();
    formData.append('file', file);
    const url = `${API_BASE}/score?explain=${explain}`;
    const res = await fetch(url, {
      method: 'POST',
      body: formData,
    });
    if (!res.ok) {
      let detail = res.statusText;
      try {
        const err = await res.json();
        if (err.detail) detail = err.detail;
      } catch {}
      throw new ApiError(res.status, detail);
    }
    return (await res.json()) as ScoreResponse;
  },

  // 7. POST /api/ingest
  ingestObservation: (obs: IngestRequest) =>
    request<ObservationRow>('/ingest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(obs),
    }),

  // 8. GET /api/download
  getDownloadUrl: (id?: string) =>
    id ? `${API_BASE}/download?id=${encodeURIComponent(id)}` : `${API_BASE}/download`,

  downloadFile: async (id?: string): Promise<Blob> => {
    const url = id ? `${API_BASE}/download?id=${encodeURIComponent(id)}` : `${API_BASE}/download`;
    const res = await fetch(url);
    if (!res.ok) {
      let detail = res.statusText;
      try {
        const err = await res.json();
        if (err.detail) detail = err.detail;
      } catch {}
      throw new ApiError(res.status, detail || 'Failed to download scored CSV');
    }
    return await res.blob();
  },

  // 9. GET /api/chat/status
  getChatStatus: () => request<ChatStatusResponse>('/chat/status'),

  // 10. POST /api/chat (non-streaming fallback)
  sendChatMessage: (messages: { role: string; content: string }[], context?: ChatContextPayload) =>
    request<{ role: string; content: string; tools_used: any[]; model: string }>('/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages, context }),
    }),

  // 11. POST /api/chat/stream (SSE streaming)
  streamChat: async (
    messages: { role: string; content: string }[],
    context?: ChatContextPayload,
    callbacks?: {
      onChunk?: (chunk: string) => void;
      onToolCall?: (tool: string, args: Record<string, any>) => void;
      onDone?: () => void;
      onError?: (err: Error) => void;
    },
    signal?: AbortSignal
  ) => {
    try {
      const response = await fetch(`${API_BASE}/chat/stream`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
        },
        body: JSON.stringify({ messages, context }),
        signal,
      });

      if (!response.ok) {
        let detail = response.statusText;
        try {
          const err = await response.json();
          if (err.detail) detail = err.detail;
        } catch {}
        throw new ApiError(response.status, detail || 'Chat stream request failed');
      }

      if (!response.body) {
        throw new ApiError(500, 'ReadableStream not supported by browser response.');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let buffer = '';

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data:')) continue;

          const dataStr = trimmed.slice(5).trim();
          if (dataStr === '[DONE]') {
            callbacks?.onDone?.();
            return;
          }

          try {
            const data = JSON.parse(dataStr);
            if (data.error && callbacks?.onError) {
              callbacks.onError(new Error(data.error));
            } else if (data.event === 'tool_call' && callbacks?.onToolCall) {
              callbacks.onToolCall(data.tool, data.args || {});
            } else if (data.chunk !== undefined && callbacks?.onChunk) {
              callbacks.onChunk(data.chunk);
            }
          } catch {
            // Ignore non-json lines
          }
        }
      }

      callbacks?.onDone?.();
    } catch (err: any) {
      if (err.name === 'AbortError') {
        callbacks?.onDone?.();
        return;
      }
      callbacks?.onError?.(err instanceof Error ? err : new Error(String(err)));
    }
  },
};
