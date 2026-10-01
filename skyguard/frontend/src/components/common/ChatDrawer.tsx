import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  Sparkles,
  Send,
  Square,
  Trash2,
  X,
  Bot,
  User,
  AlertCircle,
  Activity,
  Zap,
  RefreshCw,
  HelpCircle,
  Radio,
  FileText,
} from 'lucide-react';
import { apiService } from '../../services/api';
import type { ChatMessageItem, ChatContextPayload, ChatStatusResponse, NavigationTab } from '../../types';
import { MarkdownRenderer } from './MarkdownRenderer';

interface ChatDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  activeTab: NavigationTab;
  selectedStationId?: string | null;
  selectedTimestamp?: string | null;
  uploadId?: string | null;
  onSelectStation?: (stationId: string) => void;
}

const TOOL_DESCRIPTIONS: Record<string, string> = {
  get_network_summary: 'Querying network telemetry overview...',
  get_station_health: 'Analyzing station sensor health...',
  get_station_timeseries: 'Retrieving physical timeseries observations...',
  get_active_alerts: 'Scanning active alert episodes...',
  inspect_upload: 'Auditing uploaded dataset...',
  explain_shap_features: 'Evaluating SHAP feature attributions...',
};

export const ChatDrawer: React.FC<ChatDrawerProps> = ({
  isOpen,
  onClose,
  activeTab,
  selectedStationId,
  selectedTimestamp,
  uploadId,
}) => {
  const [messages, setMessages] = useState<ChatMessageItem[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [currentToolActivity, setCurrentToolActivity] = useState<string | null>(null);
  const [chatStatus, setChatStatus] = useState<ChatStatusResponse | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const abortControllerRef = useRef<AbortController | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Check Groq status on mount
  useEffect(() => {
    let isMounted = true;
    apiService
      .getChatStatus()
      .then((status) => {
        if (isMounted) setChatStatus(status);
      })
      .catch((err) => {
        console.warn('Could not fetch Groq chat status:', err);
      });
    return () => {
      isMounted = false;
    };
  }, []);

  // Auto-focus input when opened
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => {
        inputRef.current?.focus();
      }, 150);
    }
  }, [isOpen]);

  // Scroll to bottom when messages update
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isStreaming, currentToolActivity]);

  // Handle escape key to close
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  // Active context payload to send with each request
  const currentContext = useMemo<ChatContextPayload>(() => {
    return {
      active_tab: activeTab,
      selected_station_id: selectedStationId || undefined,
      selected_timestamp: selectedTimestamp || undefined,
      upload_id: uploadId || undefined,
    };
  }, [activeTab, selectedStationId, selectedTimestamp, uploadId]);

  // Context-aware suggested prompt chips
  const suggestedPrompts = useMemo(() => {
    if (selectedStationId) {
      return [
        `Why is station ${selectedStationId} flagged?`,
        `Explain station ${selectedStationId}'s sensor health and drift.`,
        `What caused this anomaly at station ${selectedStationId}?`,
        `What maintenance action is recommended for station ${selectedStationId}?`,
      ];
    }
    if (activeTab === 'test') {
      return [
        'Inspect the uploaded file and summarize all anomalies.',
        'Which stations in the upload have sensor faults?',
        'Are there any communication dropouts or fill values in this batch?',
        'What are the most severe anomalies in the uploaded file?',
      ];
    }
    if (activeTab === 'alerts') {
      return [
        'Summarize the most critical active alerts.',
        'Which alerts are genuine weather vs sensor faults?',
        'Explain what caused the highest severity alert.',
        'How many stations have communication issues?',
      ];
    }
    return [
      "What's happening across the network?",
      'Which stations need urgent maintenance today?',
      'Explain the Mungeshpur 52.9°C positive bias incident.',
      'How does SkyGuard distinguish thunderstorms from sensor spikes?',
    ];
  }, [selectedStationId, activeTab]);

  const handleSendMessage = async (textToSend?: string) => {
    const text = (textToSend || inputValue).trim();
    if (!text || isStreaming) return;

    setErrorMessage(null);
    setInputValue('');

    const userMessageId = `user_${Date.now()}`;
    const userMsg: ChatMessageItem = {
      id: userMessageId,
      role: 'user',
      content: text,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };

    const assistantMessageId = `assistant_${Date.now()}`;
    const assistantMsg: ChatMessageItem = {
      id: assistantMessageId,
      role: 'assistant',
      content: '',
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      isStreaming: true,
      toolsUsed: [],
    };

    const updatedHistory = [...messages, userMsg];
    setMessages([...updatedHistory, assistantMsg]);
    setIsStreaming(true);
    setCurrentToolActivity(null);

    // Prepare API messages
    const apiMessages = updatedHistory.map((m) => ({
      role: m.role,
      content: m.content,
    }));

    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    let accumulatedContent = '';
    const toolsAccumulator: { tool: string; args?: Record<string, any> }[] = [];

    await apiService.streamChat(
      apiMessages,
      currentContext,
      {
        onChunk: (chunk: string) => {
          accumulatedContent += chunk;
          setCurrentToolActivity(null);
          setMessages((prev) =>
            prev.map((msg) =>
              msg.id === assistantMessageId
                ? {
                    ...msg,
                    content: accumulatedContent,
                    toolsUsed: [...toolsAccumulator],
                  }
                : msg
            )
          );
        },
        onToolCall: (tool: string, args: Record<string, any>) => {
          const desc = TOOL_DESCRIPTIONS[tool] || `Executing ${tool}...`;
          setCurrentToolActivity(desc);
          toolsAccumulator.push({ tool, args });
          setMessages((prev) =>
            prev.map((msg) =>
              msg.id === assistantMessageId
                ? {
                    ...msg,
                    toolsUsed: [...toolsAccumulator],
                  }
                : msg
            )
          );
        },
        onDone: () => {
          setIsStreaming(false);
          setCurrentToolActivity(null);
          setMessages((prev) =>
            prev.map((msg) =>
              msg.id === assistantMessageId
                ? {
                    ...msg,
                    content: accumulatedContent || 'No response generated.',
                    isStreaming: false,
                    toolsUsed: [...toolsAccumulator],
                  }
                : msg
            )
          );
        },
        onError: (err: Error) => {
          setIsStreaming(false);
          setCurrentToolActivity(null);
          setErrorMessage(err.message || 'Error communicating with Groq AI service.');
          setMessages((prev) =>
            prev.map((msg) =>
              msg.id === assistantMessageId
                ? {
                    ...msg,
                    content:
                      accumulatedContent ||
                      `⚠️ **Request Error**: ${err.message || 'Unable to complete Groq AI request.'}`,
                    isStreaming: false,
                  }
                : msg
            )
          );
        },
      },
      abortController.signal
    );
  };

  const handleStopGeneration = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setIsStreaming(false);
    setCurrentToolActivity(null);
  };

  const handleClearChat = () => {
    handleStopGeneration();
    setMessages([]);
    setErrorMessage(null);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  if (!isOpen) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-slate-900/30 backdrop-blur-2xs z-40 transition-opacity"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Drawer Container */}
      <aside
        className="fixed top-0 right-0 bottom-0 w-full sm:w-[480px] lg:w-[520px] max-w-full bg-white shadow-2xl z-50 flex flex-col border-l border-slate-200 animate-in slide-in-from-right duration-200"
        role="dialog"
        aria-label="SkyGuard AI Copilot"
      >
        {/* Drawer Header */}
        <div className="bg-slate-900 text-white px-5 py-3.5 flex items-center justify-between border-b border-slate-800 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded bg-sky-500 text-slate-950 flex items-center justify-center font-bold shadow-xs">
              <Sparkles className="w-4 h-4 text-slate-950 fill-current" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-bold tracking-tight">SkyGuard Copilot</span>
                <span className="text-[10px] font-mono font-medium px-1.5 py-0.2 rounded bg-sky-950 text-sky-300 border border-sky-800/80">
                  Groq LPU · {chatStatus?.model || 'llama-3.3-70b'}
                </span>
              </div>
              <div className="text-[11px] text-slate-400 flex items-center gap-1.5 mt-0.5">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                <span>Physics-Grounded Autonomous Meteorological Agent</span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            {messages.length > 0 && (
              <button
                onClick={handleClearChat}
                className="p-1.5 text-slate-400 hover:text-red-300 hover:bg-slate-800 rounded transition cursor-pointer"
                title="Clear conversation"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            )}
            <button
              onClick={onClose}
              className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded transition cursor-pointer"
              title="Close Copilot (Esc)"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Dynamic Context Bar */}
        <div className="bg-slate-50 border-b border-slate-200 px-5 py-2 flex flex-wrap items-center justify-between gap-2 text-[11px] font-mono text-slate-600 shrink-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-slate-500 uppercase">Context:</span>
            <span className="bg-white px-2 py-0.5 rounded border border-slate-200 font-bold text-sky-800">
              Tab: {activeTab.toUpperCase()}
            </span>
            {selectedStationId && (
              <span className="bg-white px-2 py-0.5 rounded border border-slate-200 text-slate-800 font-bold flex items-center gap-1">
                <Radio className="w-3 h-3 text-sky-600" />
                Station: {selectedStationId}
              </span>
            )}
            {selectedTimestamp && (
              <span className="bg-white px-2 py-0.5 rounded border border-slate-200 text-slate-700">
                TS: {selectedTimestamp}
              </span>
            )}
            {uploadId && (
              <span className="bg-white px-2 py-0.5 rounded border border-slate-200 text-amber-800 font-bold flex items-center gap-1">
                <FileText className="w-3 h-3 text-amber-600" />
                Upload: {uploadId.slice(0, 8)}...
              </span>
            )}
          </div>
          <span className="text-[10px] text-slate-400">Live Grounding</span>
        </div>

        {/* Message Thread Container */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4 bg-slate-50/40">
          {/* Empty State / Welcome */}
          {messages.length === 0 && (
            <div className="space-y-4 py-2">
              <div className="bg-white p-4 rounded-lg border border-slate-200 shadow-2xs space-y-2">
                <div className="flex items-center gap-2 text-slate-900 font-bold text-xs">
                  <Bot className="w-4 h-4 text-sky-700" />
                  <span>Welcome to SkyGuard Copilot</span>
                </div>
                <p className="text-xs text-slate-600 leading-relaxed">
                  I can analyze real-time AWS observations, explain LightGBM and deterministic Tier-1 verdicts,
                  evaluate SHAP feature attributions, and recommend sensor maintenance actions.
                </p>
                <div className="text-[11px] text-slate-500 bg-slate-50 p-2.5 rounded border border-slate-200 space-y-1">
                  <div className="font-semibold text-slate-700">Equipped with 6 Real-Time Tools:</div>
                  <ul className="list-disc pl-4 space-y-0.5 font-mono text-[10px] text-slate-600">
                    <li>get_network_summary · get_station_health</li>
                    <li>get_station_timeseries · get_active_alerts</li>
                    <li>inspect_upload · explain_shap_features</li>
                  </ul>
                </div>
              </div>

              {/* Suggested Prompts Grid */}
              <div className="space-y-2">
                <div className="text-[11px] font-bold text-slate-700 flex items-center gap-1.5 uppercase tracking-wide">
                  <HelpCircle className="w-3.5 h-3.5 text-sky-600" />
                  <span>Suggested Inquiries for this Screen</span>
                </div>
                <div className="grid grid-cols-1 gap-2">
                  {suggestedPrompts.map((prompt, idx) => (
                    <button
                      key={idx}
                      onClick={() => handleSendMessage(prompt)}
                      className="text-left text-xs bg-white hover:bg-sky-50/80 text-slate-800 hover:text-sky-900 p-2.5 rounded border border-slate-200 hover:border-sky-300 transition shadow-2xs flex items-center justify-between group cursor-pointer"
                    >
                      <span>{prompt}</span>
                      <Zap className="w-3.5 h-3.5 text-slate-300 group-hover:text-sky-600 transition shrink-0 ml-2" />
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Messages Stream */}
          {messages.map((msg) => {
            const isUser = msg.role === 'user';
            return (
              <div key={msg.id} className={`flex gap-2.5 ${isUser ? 'justify-end' : 'justify-start'}`}>
                {!isUser && (
                  <div className="w-6 h-6 rounded bg-slate-900 text-sky-400 flex items-center justify-center shrink-0 mt-0.5 shadow-2xs">
                    <Sparkles className="w-3.5 h-3.5" />
                  </div>
                )}

                <div className={`max-w-[85%] space-y-1.5 ${isUser ? 'items-end' : 'items-start'}`}>
                  {/* Tool Badges if assistant used tools */}
                  {!isUser && msg.toolsUsed && msg.toolsUsed.length > 0 && (
                    <div className="flex flex-wrap gap-1 mb-1">
                      {msg.toolsUsed.map((t, tIdx) => (
                        <span
                          key={tIdx}
                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono bg-sky-50 text-sky-800 border border-sky-200"
                        >
                          <Activity className="w-2.5 h-2.5 text-sky-600" />
                          <span>{t.tool}</span>
                        </span>
                      ))}
                    </div>
                  )}

                  {/* Message Bubble */}
                  <div
                    className={`p-3.5 rounded-lg text-xs ${
                      isUser
                        ? 'bg-sky-700 text-white rounded-tr-none shadow-xs'
                        : 'bg-white text-slate-900 rounded-tl-none border border-slate-200 shadow-2xs'
                    }`}
                  >
                    {isUser ? (
                      <p className="whitespace-pre-wrap leading-relaxed font-sans">{msg.content}</p>
                    ) : (
                      <MarkdownRenderer content={msg.content} />
                    )}
                  </div>

                  {/* Timestamp */}
                  <div
                    className={`text-[10px] font-mono text-slate-400 px-1 ${
                      isUser ? 'text-right' : 'text-left'
                    }`}
                  >
                    {msg.timestamp}
                  </div>
                </div>

                {isUser && (
                  <div className="w-6 h-6 rounded bg-sky-700 text-white flex items-center justify-center shrink-0 mt-0.5 shadow-2xs">
                    <User className="w-3.5 h-3.5" />
                  </div>
                )}
              </div>
            );
          })}

          {/* Active Tool Execution Indicator */}
          {isStreaming && currentToolActivity && (
            <div className="flex items-center gap-2 px-3 py-2 bg-sky-50 border border-sky-200 rounded text-xs font-mono text-sky-800 animate-pulse">
              <RefreshCw className="w-3.5 h-3.5 animate-spin text-sky-600" />
              <span>{currentToolActivity}</span>
            </div>
          )}

          {/* General Streaming Indicator */}
          {isStreaming && !currentToolActivity && (
            <div className="flex items-center gap-1.5 text-xs text-slate-400 font-mono px-2">
              <span className="w-1.5 h-1.5 rounded-full bg-sky-600 animate-ping" />
              <span>SkyGuard Copilot is formulating answer...</span>
            </div>
          )}

          {/* Global Error Banner */}
          {errorMessage && (
            <div className="p-3 bg-red-50 border border-red-200 rounded text-xs text-red-800 flex items-start gap-2">
              <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
              <div className="space-y-1">
                <span className="font-semibold">Chat Assistant Notice:</span>
                <p>{errorMessage}</p>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Input Footer */}
        <div className="p-4 bg-white border-t border-slate-200 shrink-0 space-y-2">
          {/* Quick Context Chips when chatting */}
          {messages.length > 0 && (
            <div className="flex items-center gap-1.5 overflow-x-auto pb-1 text-[11px]">
              <span className="text-slate-400 text-[10px] font-mono shrink-0">Ask:</span>
              {suggestedPrompts.slice(0, 2).map((p, idx) => (
                <button
                  key={idx}
                  onClick={() => handleSendMessage(p)}
                  disabled={isStreaming}
                  className="px-2 py-0.5 bg-slate-100 hover:bg-sky-50 text-slate-700 hover:text-sky-900 rounded border border-slate-200 hover:border-sky-300 text-[11px] whitespace-nowrap transition disabled:opacity-50 cursor-pointer"
                >
                  {p}
                </button>
              ))}
            </div>
          )}

          <div className="relative flex items-end gap-2 bg-slate-50 border border-slate-300 focus-within:border-sky-600 focus-within:ring-1 focus-within:ring-sky-600 rounded-lg p-2 transition">
            <textarea
              ref={inputRef}
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={
                selectedStationId
                  ? `Ask about station ${selectedStationId}, its sensors, or anomalies...`
                  : 'Ask about network health, active alerts, or meteorological checks...'
              }
              rows={2}
              disabled={isStreaming}
              className="w-full bg-transparent resize-none text-xs text-slate-900 placeholder:text-slate-400 focus:outline-hidden leading-relaxed"
            />

            <div className="flex items-center gap-1.5 shrink-0">
              {isStreaming ? (
                <button
                  onClick={handleStopGeneration}
                  className="p-2 bg-red-600 hover:bg-red-700 text-white rounded font-medium text-xs flex items-center gap-1 transition shadow-2xs cursor-pointer"
                  title="Stop generating"
                >
                  <Square className="w-3.5 h-3.5 fill-current" />
                  <span className="text-[10px]">Stop</span>
                </button>
              ) : (
                <button
                  onClick={() => handleSendMessage()}
                  disabled={!inputValue.trim()}
                  className="p-2 bg-sky-700 hover:bg-sky-800 disabled:bg-slate-200 text-white disabled:text-slate-400 rounded font-medium text-xs transition shadow-2xs disabled:cursor-not-allowed cursor-pointer"
                  title="Send message (Enter)"
                >
                  <Send className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>

          <div className="flex items-center justify-between text-[10px] text-slate-400 font-mono">
            <span>Press Enter to send, Shift+Enter for new line</span>
            <span>Grounding: WMO TD-1236 & SRT</span>
          </div>
        </div>
      </aside>
    </>
  );
};
