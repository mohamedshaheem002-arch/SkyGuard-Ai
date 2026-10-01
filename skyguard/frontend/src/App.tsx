import { useEffect, useState, useCallback } from 'react';
import { apiService, API_BASE } from './services/api';
import type {
  NavigationTab,
  SystemHealth,
  NetworkMeta,
  OverviewData,
} from './types';

import { Header } from './components/common/Header';
import { Navigation } from './components/common/Navigation';
import { LoadingState } from './components/common/LoadingState';
import { ErrorState } from './components/common/ErrorState';
import { ErrorBoundary } from './components/common/ErrorBoundary';
import { ChatDrawer } from './components/common/ChatDrawer';
import { Sparkles } from 'lucide-react';

import { OverviewView } from './components/views/OverviewView';
import { LiveMapView } from './components/views/LiveMapView';
import { StationsView } from './components/views/StationsView';
import { AlertsView } from './components/views/AlertsView';
import { TestReplayView } from './components/views/TestReplayView';
import { BenchmarksView } from './components/views/BenchmarksView';
import { StationDetailView } from './components/views/StationDetailView';

export function App() {
  const [activeTab, setActiveTab] = useState<NavigationTab>('overview');
  const [selectedStationId, setSelectedStationId] = useState<string | null>(null);
  const [selectedTimestamp, setSelectedTimestamp] = useState<string | null>(null);
  const [isCopilotOpen, setIsCopilotOpen] = useState<boolean>(false);
  const [activeUploadId, setActiveUploadId] = useState<string | null>(null);

  // Real API state
  const [health, setHealth] = useState<SystemHealth | null>(null);
  const [meta, setMeta] = useState<NetworkMeta | null>(null);
  const [overview, setOverview] = useState<OverviewData | null>(null);

  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [apiError, setApiError] = useState<string | null>(null);

  // Fetch initial telemetry and metadata from FastAPI
  const loadData = useCallback(async (isSilentRefresh = false) => {
    if (!isSilentRefresh) setIsLoading(true);
    else setIsRefreshing(true);
    setApiError(null);

    try {
      // Parallel fetch from real endpoints: /api/health, /api/meta, /api/overview
      const [healthRes, metaRes, overviewRes] = await Promise.all([
        apiService.getHealth().catch(() => null),
        apiService.getMeta(),
        apiService.getOverview(),
      ]);

      setHealth(healthRes);
      setMeta(metaRes);
      setOverview(overviewRes);
    } catch (err: any) {
      console.error('Failed to communicate with SkyGuard API:', err);
      setApiError(
        err.message ||
          `Unable to reach SkyGuard backend API at ${API_BASE}. Please verify that the FastAPI server is running.`
      );
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Navigate to station detail view
  const handleSelectStation = (stationId: string, timestamp?: string | null) => {
    setSelectedTimestamp(timestamp || null);
    setSelectedStationId(stationId);
  };

  // Back from station detail
  const handleBackFromStation = () => {
    setSelectedStationId(null);
    setSelectedTimestamp(null);
  };

  // Tab change
  const handleTabChange = (tab: NavigationTab) => {
    setSelectedStationId(null);
    setSelectedTimestamp(null);
    setActiveTab(tab);
  };

  // Demo mode flag from API (/api/meta or /api/health)
  // Demo mode flag from API (/api/meta or /api/health)
  const isDemoMode = meta?.demo_mode ?? overview?.demo_mode ?? health?.demo_mode ?? true;

  // Active alerts count for navigation badge
  const activeAlertsCount = overview?.recent_alerts?.filter((a) => a.active).length || 0;

  // Global keyboard shortcut to toggle Copilot (Ctrl+K or Ctrl+/)
  useEffect(() => {
    const handleGlobalKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === '/')) {
        e.preventDefault();
        setIsCopilotOpen((prev) => !prev);
      }
    };
    window.addEventListener('keydown', handleGlobalKey);
    return () => window.removeEventListener('keydown', handleGlobalKey);
  }, []);

  return (
    <div className="min-h-screen bg-slate-100 flex flex-col text-slate-900 relative">
      {/* Global Header */}
      <Header
        health={health}
        demoMode={isDemoMode}
        onRefresh={() => loadData(true)}
        isRefreshing={isRefreshing}
        onToggleCopilot={() => setIsCopilotOpen((prev) => !prev)}
        isCopilotOpen={isCopilotOpen}
      />

      {/* Main Navigation Bar */}
      <Navigation
        activeTab={selectedStationId ? ('stations' as NavigationTab) : activeTab}
        onTabChange={handleTabChange}
        activeAlertsCount={activeAlertsCount}
      />

      {/* Content Container */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-4 md:p-6 space-y-6">
        {/* Loading State */}
        {isLoading && (
          <div className="py-16">
            <LoadingState
              message="Connecting to SkyGuard AI Meteorological Engine..."
              submessage={`Querying real endpoints at ${API_BASE} for WMO station network telemetry`}
            />
          </div>
        )}

        {/* API Unavailable / Error State */}
        {!isLoading && apiError && (
          <div className="py-12">
            <ErrorState
              title="SkyGuard AI Backend Unavailable"
              message={`${apiError}. Check that python -m uvicorn app.main:app is running on port 8000 and CORS is enabled.`}
              onRetry={() => loadData(false)}
            />
          </div>
        )}

        {/* Main Views rendered with real API data */}
        {!isLoading && !apiError && overview && (
          <ErrorBoundary key={activeTab + (selectedStationId || '')}>
            {/* If a station is selected, show its detail panel */}
            {selectedStationId ? (
              <StationDetailView
                stationId={selectedStationId}
                meta={meta}
                onBack={handleBackFromStation}
                onSelectStation={handleSelectStation}
                initialTimestamp={selectedTimestamp}
              />
            ) : (
              <>
                {activeTab === 'overview' && (
                  <OverviewView
                    overview={overview}
                    meta={meta}
                    onSelectStation={handleSelectStation}
                    onGoToAlerts={() => setActiveTab('alerts')}
                    onGoToMap={() => setActiveTab('map')}
                  />
                )}

                {activeTab === 'map' && (
                  <LiveMapView
                    overview={overview}
                    meta={meta}
                    onSelectStation={handleSelectStation}
                  />
                )}

                {activeTab === 'stations' && (
                  <StationsView
                    overview={overview}
                    meta={meta}
                    onSelectStation={handleSelectStation}
                  />
                )}

                {activeTab === 'alerts' && (
                  <AlertsView
                    overview={overview}
                    meta={meta}
                    onSelectStation={handleSelectStation}
                  />
                )}

                {activeTab === 'test' && (
                  <TestReplayView
                    meta={meta}
                    onSelectStation={handleSelectStation}
                    onUploadScored={(id) => setActiveUploadId(id)}
                  />
                )}

                {activeTab === 'benchmarks' && <BenchmarksView meta={meta} />}
              </>
            )}
          </ErrorBoundary>
        )}
      </main>

      {/* Floating Copilot Launcher Button */}
      {!isCopilotOpen && (
        <button
          onClick={() => setIsCopilotOpen(true)}
          className="fixed bottom-6 right-6 z-30 flex items-center gap-2 px-4 py-3 bg-gradient-to-r from-sky-700 to-indigo-800 hover:from-sky-800 hover:to-indigo-900 text-white rounded-full shadow-lg hover:shadow-xl transition-all duration-200 cursor-pointer group hover:scale-105 border border-sky-400/30 font-sans"
          title="Open SkyGuard AI Copilot (Ctrl+K or Ctrl+/)"
        >
          <Sparkles className="w-4 h-4 text-sky-200 fill-current animate-pulse" />
          <span className="text-xs font-bold tracking-wide">Ask AI Copilot</span>
        </button>
      )}

      {/* SkyGuard Copilot Drawer */}
      <ChatDrawer
        isOpen={isCopilotOpen}
        onClose={() => setIsCopilotOpen(false)}
        activeTab={selectedStationId ? 'stations' : activeTab}
        selectedStationId={selectedStationId}
        selectedTimestamp={selectedTimestamp}
        uploadId={activeUploadId}
        onSelectStation={handleSelectStation}
      />

      {/* Footer Disclaimer */}
      <footer className="bg-white border-t border-slate-200 py-4 px-6 text-center text-xs text-slate-500 font-sans">
        <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-1">
          <span>SkyGuard AI · Meteorological Automated Weather Station QA Prototype</span>
          <span>•</span>
          <span className="text-slate-600 font-medium">
            Research & Benchmark Mode (Held-Out Test Data) · Not connected to live operational IMD data feeds
          </span>
        </div>
      </footer>
    </div>
  );
}

export default App;
