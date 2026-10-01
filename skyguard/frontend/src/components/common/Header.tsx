import React, { useEffect, useState } from 'react';
import { Radio, RefreshCw, Activity, ShieldCheck, ShieldAlert, WifiOff, Sparkles } from 'lucide-react';
import type { SystemHealth } from '../../types';

interface HeaderProps {
  health: SystemHealth | null;
  demoMode: boolean;
  onRefresh: () => void;
  isRefreshing?: boolean;
  onToggleCopilot?: () => void;
  isCopilotOpen?: boolean;
}

export const Header: React.FC<HeaderProps> = ({
  health,
  demoMode,
  onRefresh,
  isRefreshing = false,
  onToggleCopilot,
  isCopilotOpen = false,
}) => {
  const [utcTime, setUtcTime] = useState<string>('');

  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      setUtcTime(
        now.toISOString().replace('T', ' ').slice(0, 19) + ' UTC'
      );
    };
    updateTime();
    const interval = setInterval(updateTime, 1000);
    return () => clearInterval(interval);
  }, []);

  const isHealthy = health?.status === 'healthy';
  const isOffline = health === null;

  return (
    <header className="bg-white border-b border-slate-200 px-6 py-3 flex flex-wrap items-center justify-between gap-4 sticky top-0 z-30 shadow-xs">
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded bg-sky-700 text-white flex items-center justify-center font-bold tracking-wider text-base shadow-xs">
            SG
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-base font-bold text-slate-900 tracking-tight leading-none">
                SkyGuard <span className="text-sky-700">AI</span>
              </h1>
              <span className="text-xs text-slate-400 font-normal">|</span>
              <span className="text-xs font-medium text-slate-600 tracking-wide uppercase">
                AWS Anomaly Intelligence
              </span>
            </div>
            <div className="text-[11px] text-slate-500 font-mono mt-1">
              Automated Weather Station QA & Quality Assurance · Benchmark System (Historical/Replay Data)
            </div>
          </div>
        </div>

        {/* DEMO / REPLAY MODE BADGE */}
        {demoMode && (
          <div className="ml-2 px-2.5 py-1 bg-amber-50 text-amber-800 border border-amber-300 rounded text-xs font-mono font-semibold flex items-center gap-1.5 shadow-2xs">
            <Radio className="w-3.5 h-3.5 text-amber-600 animate-pulse" />
            <span>DEMO / REPLAY MODE</span>
          </div>
        )}
      </div>

      <div className="flex items-center gap-3 text-xs">
        {/* Real-time UTC clock */}
        <div className="font-mono text-slate-600 bg-slate-50 px-3 py-1.5 rounded border border-slate-200 flex items-center gap-2">
          <Activity className="w-3.5 h-3.5 text-slate-400" />
          <span>{utcTime}</span>
        </div>

        {/* System Health / API indicator */}
        <div
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded border font-mono font-medium ${
            isOffline
              ? 'bg-red-50 text-red-800 border-red-200'
              : isHealthy
              ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
              : 'bg-amber-50 text-amber-800 border-amber-200'
          }`}
          title={
            isOffline
              ? 'API server unreachable at configured VITE_API_BASE_URL'
              : isHealthy
              ? 'All ML engines & WMO baselines operational'
              : 'System degraded'
          }
        >
          {isOffline ? (
            <WifiOff className="w-3.5 h-3.5 text-red-600" />
          ) : isHealthy ? (
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
          ) : (
            <ShieldAlert className="w-3.5 h-3.5 text-amber-600" />
          )}
          <span>
            {isOffline ? 'API DISCONNECTED' : isHealthy ? 'ENGINE ONLINE' : 'ENGINE DEGRADED'}
          </span>
        </div>

        {/* Refresh button */}
        <button
          onClick={onRefresh}
          disabled={isRefreshing}
          className="p-1.5 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded border border-slate-200 transition disabled:opacity-50 cursor-pointer"
          title="Refresh telemetry from API"
        >
          <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin' : ''}`} />
        </button>

        {/* AI Copilot Trigger Button */}
        {onToggleCopilot && (
          <button
            onClick={onToggleCopilot}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded font-semibold text-xs transition cursor-pointer shadow-xs ${
              isCopilotOpen
                ? 'bg-sky-800 text-white ring-2 ring-sky-400'
                : 'bg-gradient-to-r from-sky-700 to-indigo-800 hover:from-sky-800 hover:to-indigo-900 text-white shadow-sky-900/10'
            }`}
            title="Open SkyGuard AI Copilot (Groq Cloud)"
          >
            <Sparkles className="w-3.5 h-3.5 text-sky-200 fill-current" />
            <span>AI Copilot</span>
          </button>
        )}
      </div>
    </header>
  );
};
