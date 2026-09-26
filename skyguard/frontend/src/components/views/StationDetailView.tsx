import React, { useEffect, useState, useMemo } from 'react';
import { apiService } from '../../services/api';
import type { StationDetailData, NetworkMeta, VerdictType, ObservationRow } from '../../types';
import { DiagnosisPanel } from '../common/DiagnosisPanel';
import { VerdictBadge } from '../common/VerdictBadge';
import { SeverityBadge } from '../common/SeverityBadge';
import { LoadingState } from '../common/LoadingState';
import { ErrorState } from '../common/ErrorState';
import {
  ArrowLeft,
  Thermometer,
  Gauge,
  Droplets,
  Activity,
  RefreshCw,
  Compass,
} from 'lucide-react';
import { SENSOR_NAMES, SENSOR_UNITS, FAULT_NAMES } from '../../utils/diagnosis';

interface StationDetailViewProps {
  stationId: string;
  meta: NetworkMeta | null;
  onBack: () => void;
  onSelectStation: (stationId: string) => void;
  initialTimestamp?: string | null;
}

export const StationDetailView: React.FC<StationDetailViewProps> = ({
  stationId,
  meta,
  onBack,
  onSelectStation,
  initialTimestamp,
}) => {
  const [data, setData] = useState<StationDetailData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [days, setDays] = useState<number>(14);
  const [activeTab, setActiveTab] = useState<'temp' | 'pres' | 'rh'>('temp');
  const [selectedTs, setSelectedTs] = useState<string | null>(initialTimestamp || null);

  const stationMeta = useMemo(() => {
    return meta?.stations.find((s) => s.station_id === stationId);
  }, [meta, stationId]);

  const fetchStationData = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiService.getStation(stationId, days);
      setData(res);
      // Default selected timestamp to latest if not specified
      if (!selectedTs && res.series?.ts && res.series.ts.length > 0) {
        setSelectedTs(res.series.ts[res.series.ts.length - 1]);
      }
    } catch (err: any) {
      setError(err.message || `Failed to load telemetry for station ${stationId}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStationData();
  }, [stationId, days]);

  // Selected Observation (or latest)
  const selectedObs: ObservationRow | null = useMemo(() => {
    if (!data?.series?.ts) return null;
    const s = data.series;
    let idx = selectedTs ? s.ts.indexOf(selectedTs) : s.ts.length - 1;
    if (idx === -1) idx = s.ts.length - 1;

    // Check if there is a matching row in alerts for full metadata
    const alertRow = data.alerts?.find((a) => a.ts === s.ts[idx]);
    const v = (alertRow?.verdict || s.verdict[idx] || 'NORMAL') as VerdictType;
    const pFault = alertRow?.p_fault ?? s.p_fault?.[idx] ?? null;

    return {
      ts: s.ts[idx],
      station_id: stationId,
      temp: s.temp[idx],
      pres: s.pres[idx],
      rh: s.rh[idx],
      temp_expected: s.temp_expected?.[idx] ?? alertRow?.temp_expected ?? null,
      pres_expected: s.pres_expected?.[idx] ?? alertRow?.pres_expected ?? null,
      rh_expected: s.rh_expected?.[idx] ?? alertRow?.rh_expected ?? null,
      verdict: v,
      fault: alertRow?.fault || s.fault[idx] || null,
      sensor: alertRow?.sensor || s.sensor[idx] || null,
      severity: alertRow?.severity || s.severity[idx] || 'LOW',
      corrected: alertRow?.corrected ?? s.corrected?.[idx] ?? null,
      bias_estimate: alertRow?.bias_estimate ?? null,
      p_fault: pFault,
      confidence:
        alertRow?.confidence ??
        (v === 'NORMAL'
          ? pFault != null
            ? 1 - pFault
            : 0.95
          : pFault ?? 0.85),
      explanation:
        alertRow?.explanation ||
        (v === 'NORMAL' ? 'All checks within normal bounds.' : ''),
      action:
        alertRow?.action ||
        (v === 'NORMAL' ? 'No action.' : 'Inspect sensor element.'),
      shap_top: alertRow?.shap_top ?? null,
      temp_cz: alertRow?.temp_cz ?? null,
      pres_cz: alertRow?.pres_cz ?? null,
      rh_cz: alertRow?.rh_cz ?? null,
      temp_sp_z: alertRow?.temp_sp_z ?? null,
      pres_sp_z: alertRow?.pres_sp_z ?? null,
      rh_sp_z: alertRow?.rh_sp_z ?? null,
      temp_witness: alertRow?.temp_witness ?? null,
      pres_witness: alertRow?.pres_witness ?? null,
      rh_witness: alertRow?.rh_witness ?? null,
    };
  }, [data, selectedTs, stationId]);

  // When a sensor fault is selected, auto-switch activeTab to that sensor
  useEffect(() => {
    if (selectedObs?.sensor && ['temp', 'pres', 'rh'].includes(selectedObs.sensor)) {
      setActiveTab(selectedObs.sensor as 'temp' | 'pres' | 'rh');
    }
  }, [selectedObs?.ts, selectedObs?.sensor]);

  // Find most recent anomaly if current is normal
  const mostRecentAnomaly = useMemo(() => {
    if (!data?.alerts || data.alerts.length === 0) return null;
    const sorted = [...data.alerts].sort((a, b) => (a.ts < b.ts ? 1 : -1));
    const nonUncertain = sorted.find((a) => a.verdict !== 'UNCERTAIN');
    return nonUncertain || sorted[0];
  }, [data?.alerts]);

  // Compute 7-day fault statistics for health explanations
  const faultStats = useMemo(() => {
    if (!data?.series?.ts?.length) return {};
    const s = data.series;
    const lastTs = s.ts[s.ts.length - 1];
    const end = Date.parse(lastTs.replace(' ', 'T') + ':00Z');
    const start = end - 7 * 864e5;

    const stats: Record<string, { n: number; total: number; top: string | null }> = {
      temp: { n: 0, total: 0, top: null },
      pres: { n: 0, total: 0, top: null },
      rh: { n: 0, total: 0, top: null },
    };

    const kinds: Record<string, Record<string, number>> = {
      temp: {},
      pres: {},
      rh: {},
    };

    s.ts.forEach((t, i) => {
      const ms = Date.parse(t.replace(' ', 'T') + ':00Z');
      if (ms < start) return;
      (['temp', 'pres', 'rh'] as const).forEach((sen) => {
        stats[sen].total++;
        if (s.verdict[i] === 'SENSOR_FAULT' && s.sensor[i] === sen) {
          stats[sen].n++;
          const f = s.fault[i] || 'fault';
          kinds[sen][f] = (kinds[sen][f] || 0) + 1;
        }
      });
    });

    (['temp', 'pres', 'rh'] as const).forEach((sen) => {
      const entries = Object.entries(kinds[sen]).sort((a, b) => b[1] - a[1]);
      stats[sen].top = entries.length ? entries[0][0] : null;
    });

    return stats;
  }, [data?.series]);

  if (loading) {
    return (
      <div className="py-12">
        <LoadingState
          message={`Loading telemetry & diagnostics for Station ${stationMeta?.name || stationId}...`}
          submessage="Retrieving time-series, sensor health records, and AI verdict explanations"
        />
      </div>
    );
  }

  if (error || !data) {
    const isUnknownStation = Boolean(error?.toLowerCase().includes('unknown station id'));
    return (
      <div className="py-12 max-w-xl mx-auto">
        <ErrorState
          title={`Station ${stationId} Telemetry Unavailable`}
          message={
            isUnknownStation
              ? `Station "${stationId}" is not part of the active 43-station benchmark network archive. It was likely evaluated from an ad-hoc or uploaded test CSV batch. Full ML verdicts, sensor diagnostics, and SHAP attributions for test files are inspected directly within the Test / Replay view.`
              : error || 'Could not retrieve observation series from the SkyGuard API.'
          }
          onRetry={!isUnknownStation ? fetchStationData : undefined}
        />
        <div className="mt-4 text-center">
          <button
            onClick={onBack}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-300 rounded shadow-xs hover:bg-slate-50 cursor-pointer"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Return to Station List</span>
          </button>
        </div>
      </div>
    );
  }

  const s = data.series;
  const times = s.ts;
  const latestVerdict = (times.length > 0 ? s.verdict[times.length - 1] : 'NORMAL') as VerdictType;
  const isLatest = selectedObs?.ts === times[times.length - 1];

  // Chart data calculation
  const values = s[activeTab] || [];
  const expectedVals = s[`${activeTab}_expected`] || [];
  const count = times.length;

  const points: {
    x: number;
    y: number;
    val: number | null;
    exp: number | null;
    ts: string;
    verdict: VerdictType;
    corrected: number | null;
    isValid: boolean;
  }[] = [];

  let minVal = Infinity;
  let maxVal = -Infinity;

  for (let i = 0; i < count; i++) {
    const v = values[i];
    const exp = expectedVals[i] ?? null;
    if (v != null && v > -50 && v < 9000) {
      if (v < minVal) minVal = v;
      if (v > maxVal) maxVal = v;
    }
    if (exp != null && exp > -50 && exp < 9000) {
      if (exp < minVal) minVal = exp;
      if (exp > maxVal) maxVal = exp;
    }
  }

  if (minVal === Infinity) {
    minVal = 0;
    maxVal = 100;
  }
  const pad = (maxVal - minVal) * 0.1 || 2;
  const yMin = minVal - pad;
  const yMax = maxVal + pad;
  const yRange = yMax - yMin || 1;

  for (let i = 0; i < count; i++) {
    const v = values[i];
    const exp = expectedVals[i] ?? null;
    const isValid = v != null && v > -50 && v < 9000;
    const xPct = count > 1 ? (i / (count - 1)) * 100 : 50;
    // Strictly clamp yPct to [0, 100]; if missing/sentinel (e.g. -999°C), pin marker safely to bottom baseline (96%)
    const yPct = isValid
      ? Math.max(0, Math.min(100, 100 - ((v - yMin) / yRange) * 100))
      : 96;

    points.push({
      x: xPct,
      y: yPct,
      val: v,
      exp: exp,
      ts: times[i],
      verdict: s.verdict[i],
      corrected: s.sensor[i] === activeTab ? s.corrected[i] : null,
      isValid,
    });
  }

  // Construct observed path, cleanly breaking on missing/corrupt data segments
  let pathD = '';
  let inSegment = false;
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    if (p.isValid && p.val != null) {
      if (!inSegment) {
        pathD += ` M ${p.x.toFixed(1)} ${p.y.toFixed(1)}`;
        inSegment = true;
      } else {
        pathD += ` L ${p.x.toFixed(1)} ${p.y.toFixed(1)}`;
      }
    } else {
      inSegment = false;
    }
  }

  // Construct expected spatial baseline path, cleanly breaking on missing data
  let expPathD = '';
  let inExpSegment = false;
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const isValidExp = p.exp != null && p.exp > -50 && p.exp < 9000;
    if (isValidExp) {
      const expY = Math.max(0, Math.min(100, 100 - (((p.exp ?? 0) - yMin) / yRange) * 100));
      if (!inExpSegment) {
        expPathD += ` M ${p.x.toFixed(1)} ${expY.toFixed(1)}`;
        inExpSegment = true;
      } else {
        expPathD += ` L ${p.x.toFixed(1)} ${expY.toFixed(1)}`;
      }
    } else {
      inExpSegment = false;
    }
  }

  const anomalyPoints = points.filter(
    (p) => p.verdict !== 'NORMAL' && p.verdict !== 'UNCERTAIN'
  );

  const selectedPoint = points.find((p) => p.ts === selectedObs?.ts);

  const sortedAlerts = [...(data.alerts || [])].sort((a, b) =>
    a.ts < b.ts ? 1 : -1
  );

  return (
    <div className="space-y-6">
      {/* Top Header & Breadcrumb Bar */}
      <div className="bg-white p-4 rounded-lg border border-slate-200 flex flex-wrap items-center justify-between gap-4 shadow-xs">
        <div className="flex items-center gap-3">
          <button
            onClick={onBack}
            className="p-2 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-md border border-slate-200 transition cursor-pointer"
            title="Return to previous screen"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-lg font-bold text-slate-900 leading-none">
                {stationMeta?.name || `Station ${stationId}`}
              </h1>
              <span className="px-2 py-0.5 rounded bg-sky-50 text-sky-800 border border-sky-200 font-mono text-xs font-semibold">
                WMO ID: {stationId}
              </span>
              {stationMeta?.region && (
                <span className="text-xs text-slate-500 font-medium">
                  {stationMeta.region}
                </span>
              )}
            </div>
            <div className="text-xs text-slate-500 font-mono mt-1">
              Coordinates: {stationMeta?.lat.toFixed(3)}°N, {stationMeta?.lon.toFixed(3)}°E ·
              Elev: {stationMeta?.elev}m
            </div>
          </div>
        </div>

        {/* Time Window Selector & Jump to Latest */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1.5 text-xs text-slate-600 font-mono">
            <span>Observation:</span>
            <strong className="text-slate-900">{selectedObs?.ts} UTC</strong>
            {!isLatest && (
              <button
                onClick={() => {
                  if (times.length > 0) setSelectedTs(times[times.length - 1]);
                }}
                className="text-sky-700 hover:underline font-semibold cursor-pointer ml-1"
              >
                ↺ jump to latest
              </button>
            )}
          </div>

          <div className="h-4 w-px bg-slate-200 hidden sm:block"></div>

          <div className="flex items-center gap-1.5">
            <span className="text-xs font-medium text-slate-600 font-sans">Window:</span>
            <div className="inline-flex rounded-md border border-slate-200 bg-slate-50 p-0.5 text-xs font-mono">
              {[7, 14, 30].map((d) => (
                <button
                  key={d}
                  onClick={() => setDays(d)}
                  className={`px-2.5 py-1 rounded font-medium transition cursor-pointer ${
                    days === d
                      ? 'bg-white text-sky-800 shadow-2xs font-bold'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {d}d
                </button>
              ))}
            </div>

            <button
              onClick={fetchStationData}
              className="p-1.5 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-md border border-slate-200 transition cursor-pointer ml-1"
              title="Reload telemetry"
            >
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>

      {/* Contextual Status Strip: Distinguish Current Reading from Historical Anomaly Window */}
      <div className="bg-white p-3 rounded-lg border border-slate-200 flex flex-wrap items-center justify-between gap-3 shadow-2xs">
        <div className="flex flex-wrap items-center gap-2.5 text-xs">
          <div className="flex items-center gap-1.5 px-3 py-1 rounded bg-slate-50 border border-slate-200">
            <span className="text-slate-500 font-sans">Current reading:</span>
            <span
              className={`font-mono font-bold ${
                latestVerdict === 'NORMAL'
                  ? 'text-emerald-700'
                  : latestVerdict === 'UNCERTAIN'
                  ? 'text-amber-700'
                  : 'text-rose-700'
              }`}
            >
              {latestVerdict}
            </span>
          </div>

          <div className="flex items-center gap-1.5 px-3 py-1 rounded bg-slate-50 border border-slate-200">
            <span className="text-slate-500 font-sans">Historical window:</span>
            <span className="font-mono font-bold text-slate-800">
              {sortedAlerts.length} anomaly {sortedAlerts.length === 1 ? 'observation' : 'observations'} ({days}d)
            </span>
          </div>
        </div>

        <div className="text-xs">
          {isLatest ? (
            <span className="inline-flex items-center gap-1.5 text-emerald-800 bg-emerald-50 px-2.5 py-1 rounded border border-emerald-200 font-medium">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
              <span>Showing latest observation ({times[times.length - 1]} UTC)</span>
            </span>
          ) : (
            <div className="inline-flex items-center gap-2 text-amber-900 bg-amber-50 px-2.5 py-1 rounded border border-amber-200 font-medium">
              <span>Inspecting historical record: {selectedObs?.ts} UTC</span>
              <button
                onClick={() => {
                  if (times.length > 0) setSelectedTs(times[times.length - 1]);
                }}
                className="font-bold underline text-sky-800 hover:text-sky-950 cursor-pointer"
              >
                Return to latest
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Main Sensor Readings: Observed vs Expected */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {(['temp', 'pres', 'rh'] as const).map((sen) => {
          const obsVal = selectedObs?.[sen];
          const expVal = selectedObs?.[`${sen}_expected` as keyof ObservationRow] as number | null;
          const isSelectedSen = selectedObs?.sensor === sen;
          const Icon = sen === 'temp' ? Thermometer : sen === 'pres' ? Gauge : Droplets;
          const iconColor =
            sen === 'temp'
              ? 'text-rose-500'
              : sen === 'pres'
              ? 'text-blue-500'
              : 'text-teal-500';

          return (
            <div
              key={sen}
              onClick={() => setActiveTab(sen)}
              className={`p-4 rounded-lg border transition cursor-pointer ${
                activeTab === sen
                  ? 'bg-sky-50/50 border-sky-400 ring-1 ring-sky-300'
                  : 'bg-white border-slate-200 hover:bg-slate-50/80'
              } ${isSelectedSen ? 'border-l-4 border-l-rose-500' : ''}`}
            >
              <div className="flex items-center justify-between text-slate-500 text-xs mb-1">
                <span className="font-semibold text-slate-700">{SENSOR_NAMES[sen]}</span>
                <Icon className={`w-4 h-4 ${iconColor}`} />
              </div>

              <div className="flex items-baseline justify-between mt-1">
                <div className="text-2xl font-extrabold font-mono text-slate-900">
                  {obsVal != null
                    ? `${Number(obsVal).toFixed(sen === 'rh' ? 0 : 1)}`
                    : '—'}{' '}
                  <span className="text-xs font-normal text-slate-500 font-mono">
                    {SENSOR_UNITS[sen]}
                  </span>
                </div>

                <div className="text-right text-xs font-mono text-slate-500">
                  <div className="text-[10px] uppercase text-slate-400 font-sans">
                    Expected (Spatial)
                  </div>
                  <div className="font-semibold text-slate-700">
                    {expVal != null
                      ? `${expVal.toFixed(sen === 'rh' ? 0 : 1)} ${SENSOR_UNITS[sen]}`
                      : '—'}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Main Split: Left Column (Chart + History) vs Right Column (Full AI Diagnosis) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column (7 cols): Trend Chart + Anomalies Table + Neighbours */}
        <div className="lg:col-span-7 space-y-6">
          {/* Trend Chart Card */}
          <div className="bg-white p-5 rounded-lg border border-slate-200 shadow-xs">
            <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
              <div>
                <h2 className="text-xs font-bold text-slate-800 uppercase tracking-wider font-mono">
                  Telemetry Trend & Spatial Regression Consensus
                </h2>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  Observed signal vs. spatial baseline ({count} hourly observations)
                </p>
              </div>

              {/* Sensor Switcher Tabs */}
              <div className="inline-flex rounded-md border border-slate-200 bg-slate-50 p-0.5 font-mono text-xs">
                {(['temp', 'pres', 'rh'] as const).map((sensor) => (
                  <button
                    key={sensor}
                    onClick={() => setActiveTab(sensor)}
                    className={`px-3 py-1 rounded font-semibold transition cursor-pointer capitalize ${
                      activeTab === sensor
                        ? 'bg-white text-sky-800 shadow-2xs font-bold'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    {SENSOR_NAMES[sensor]}
                  </button>
                ))}
              </div>
            </div>

            {/* SVG Historical Chart Viewport */}
            <div className="h-64 relative bg-slate-50/70 border border-slate-200 rounded-lg p-2 select-none overflow-hidden">
              <svg
                className="w-full h-full overflow-hidden"
                viewBox="0 0 100 100"
                preserveAspectRatio="none"
              >
                <defs>
                  <clipPath id="station-chart-clip">
                    <rect x="0" y="0" width="100" height="100" />
                  </clipPath>
                </defs>

                <g clipPath="url(#station-chart-clip)">
                  {/* Horizontal reference grid lines */}
                  <line
                    x1="0"
                    y1="20"
                    x2="100"
                    y2="20"
                    stroke="#e2e8f0"
                    strokeWidth="0.5"
                    strokeDasharray="1,1"
                  />
                  <line
                    x1="0"
                    y1="50"
                    x2="100"
                    y2="50"
                    stroke="#e2e8f0"
                    strokeWidth="0.5"
                    strokeDasharray="1,1"
                  />
                  <line
                    x1="0"
                    y1="80"
                    x2="100"
                    y2="80"
                    stroke="#e2e8f0"
                    strokeWidth="0.5"
                    strokeDasharray="1,1"
                  />

                  {/* Selected observation vertical guideline */}
                  {selectedPoint && (
                    <line
                      x1={selectedPoint.x}
                      y1="0"
                      x2={selectedPoint.x}
                      y2="100"
                      stroke="#94a3b8"
                      strokeWidth="0.75"
                      strokeDasharray="2,2"
                      opacity="0.8"
                    />
                  )}

                  {/* Expected baseline path (dashed sky blue) */}
                  {expPathD && (
                    <path
                      d={expPathD}
                      fill="none"
                      stroke="#38bdf8"
                      strokeWidth="1.2"
                      strokeDasharray="2,2"
                      opacity="0.8"
                    />
                  )}

                  {/* Observed actual path (solid sky blue) */}
                  {pathD && (
                    <path
                      d={pathD}
                      fill="none"
                      stroke="#0284c7"
                      strokeWidth="1.6"
                    />
                  )}

                  {/* Selected observation ring indicator */}
                  {selectedPoint && selectedPoint.isValid && (
                    <circle
                      cx={selectedPoint.x}
                      cy={selectedPoint.y}
                      r="4.5"
                      fill="none"
                      stroke="#0f172a"
                      strokeWidth="1.5"
                    />
                  )}

                  {/* Corrected/imputed estimate marker for selected observation */}
                  {selectedPoint && selectedPoint.corrected != null && (
                    <circle
                      cx={selectedPoint.x}
                      cy={Math.max(
                        0,
                        Math.min(100, 100 - ((selectedPoint.corrected - yMin) / yRange) * 100)
                      )}
                      r="3.5"
                      fill="#10b981"
                      stroke="#ffffff"
                      strokeWidth="1"
                    />
                  )}

                  {/* Anomaly markers on chart */}
                  {anomalyPoints.map((p, i) => {
                    const color =
                      p.verdict === 'SENSOR_FAULT'
                        ? '#ef4444'
                        : p.verdict === 'GENUINE_WEATHER_EVENT'
                        ? '#f97316'
                        : '#3b82f6';
                    return (
                      <circle
                        key={i}
                        cx={p.x}
                        cy={p.y}
                        r="2.5"
                        fill={color}
                        stroke="#ffffff"
                        strokeWidth="0.75"
                        className="cursor-pointer hover:r-4 transition"
                        onClick={() => setSelectedTs(p.ts)}
                      >
                        <title>{`${p.ts} - ${p.verdict}: ${p.isValid && p.val != null ? `${p.val} ${SENSOR_UNITS[activeTab]}` : 'Missing/Dropout'}`}</title>
                      </circle>
                    );
                  })}
                </g>
              </svg>

              {/* Range labels */}
              <div className="absolute top-2 left-3 text-[10px] font-mono text-slate-500">
                Max: {maxVal.toFixed(1)} {SENSOR_UNITS[activeTab]}
              </div>
              <div className="absolute bottom-2 left-3 text-[10px] font-mono text-slate-500">
                Min: {minVal.toFixed(1)} {SENSOR_UNITS[activeTab]}
              </div>
            </div>

            {/* Chart Legend */}
            <div className="mt-3 flex flex-wrap items-center justify-between text-xs text-slate-600 font-mono gap-y-2">
              <div className="flex flex-wrap items-center gap-4">
                <span className="flex items-center gap-1.5">
                  <span className="w-3 h-0.5 bg-sky-600"></span>
                  <span>Observed</span>
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="w-3 h-0.5 bg-sky-400 border-b border-dashed border-sky-400"></span>
                  <span>Expected (Spatial)</span>
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-red-500"></span>
                  <span>Flagged Anomaly</span>
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-emerald-500"></span>
                  <span>Corrected Est.</span>
                </span>
              </div>
              <div className="text-[11px] text-slate-500">
                Click anomaly points to inspect diagnosis
              </div>
            </div>
          </div>

          {/* Anomalies Table in Current Window */}
          <div className="bg-white rounded-lg border border-slate-200 overflow-hidden shadow-xs">
            <div className="p-4 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
              <div>
                <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider font-mono">
                  Historical Anomalies in {days}-Day Window ({sortedAlerts.length})
                </h3>
                <p className="text-[11px] text-slate-500">
                  Past flagged events · Current station telemetry is{' '}
                  <span className="font-semibold text-slate-800">{latestVerdict}</span>
                </p>
              </div>
            </div>

            <div className="overflow-x-auto max-h-72 overflow-y-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 text-slate-600 font-mono text-[11px] border-b border-slate-200 sticky top-0">
                  <tr>
                    <th className="py-2.5 px-3">Timestamp (UTC)</th>
                    <th className="py-2.5 px-3">Verdict</th>
                    <th className="py-2.5 px-3">Cause</th>
                    <th className="py-2.5 px-3">Sensor</th>
                    <th className="py-2.5 px-3">Severity</th>
                    <th className="py-2.5 px-3 text-right">Conf</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 font-mono">
                  {sortedAlerts.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-8 text-center text-slate-500 font-sans">
                        No anomalies recorded for this station within the current {days}-day window.
                      </td>
                    </tr>
                  ) : (
                    sortedAlerts.map((al, idx) => {
                      const isSel = selectedObs?.ts === al.ts;
                      return (
                        <tr
                          key={idx}
                          onClick={() => setSelectedTs(al.ts)}
                          className={`cursor-pointer transition select-none ${
                            isSel
                              ? 'bg-sky-100/70 font-semibold'
                              : 'hover:bg-slate-50'
                          }`}
                        >
                          <td className="py-2 px-3 whitespace-nowrap text-slate-800">
                            {al.ts}
                          </td>
                          <td className="py-2 px-3 whitespace-nowrap">
                            <VerdictBadge verdict={al.verdict} size="sm" />
                          </td>
                          <td className="py-2 px-3 capitalize text-slate-700 whitespace-nowrap">
                            {FAULT_NAMES[al.fault || ''] || al.fault || '—'}
                          </td>
                          <td className="py-2 px-3 uppercase text-slate-600 whitespace-nowrap">
                            {al.sensor || 'all'}
                          </td>
                          <td className="py-2 px-3 whitespace-nowrap">
                            <SeverityBadge severity={al.severity} size="sm" />
                          </td>
                          <td className="py-2 px-3 text-right text-slate-800">
                            {al.confidence != null
                              ? `${Math.round(al.confidence * 100)}%`
                              : '—'}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Spatial Consensus Neighbours Card */}
          <div className="bg-white p-5 rounded-lg border border-slate-200 shadow-xs">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider font-mono">
                Consensus Neighbours ({data.neighbours?.length || 0})
              </h3>
              <Compass className="w-4 h-4 text-sky-700" />
            </div>
            <p className="text-[11px] text-slate-500 mb-3">
              Spatial cross-validation stations used for SRT Hubbard regression:
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-48 overflow-y-auto">
              {data.neighbours && data.neighbours.length > 0 ? (
                data.neighbours.map((nSid) => {
                  const nMeta = meta?.stations.find((s) => s.station_id === nSid);
                  return (
                    <div
                      key={nSid}
                      onClick={() => onSelectStation(nSid)}
                      className="p-2.5 rounded border border-slate-200 bg-slate-50 hover:bg-sky-50/60 cursor-pointer transition flex items-center justify-between text-xs"
                    >
                      <div>
                        <div className="font-semibold text-slate-900 truncate max-w-[140px]">
                          {nMeta?.name || `Station ${nSid}`}
                        </div>
                        <div className="text-[10px] text-slate-500 font-mono">ID: {nSid}</div>
                      </div>
                      <span className="text-[11px] text-sky-700 font-semibold hover:underline">
                        Switch &rarr;
                      </span>
                    </div>
                  );
                })
              ) : (
                <div className="text-xs text-slate-500 italic py-2 col-span-2">
                  No nearest neighbours assigned in spatial topology matrix.
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Right Column (5 cols): Complete AI Diagnosis Panel + Sensor Health Box */}
        <div className="lg:col-span-5 space-y-6">
          {/* Main Diagnosis Panel (Verdict + Why + SHAP + Sensor Result) */}
          {selectedObs && (
            <DiagnosisPanel
              observation={selectedObs}
              neighbourCount={data.neighbours?.length}
              theta={meta?.theta}
              mostRecentAnomaly={mostRecentAnomaly}
              onSelectTimestamp={setSelectedTs}
            />
          )}

          {/* Sensor Health Metrics (7-Day Rolling History) */}
          <div className="bg-white p-5 rounded-lg border border-slate-200 shadow-xs space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider font-mono">
                  Sensor Health & Drift (7-Day)
                </h3>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  Maintenance priority tracking across AWS transducers
                </p>
              </div>
              <Activity className="w-4 h-4 text-slate-400" />
            </div>

            <div className="space-y-3.5">
              {(['temp', 'pres', 'rh'] as const).map((sen) => {
                const h = data.health?.[sen];
                const score = h?.health ?? 95;
                const status = h?.status || 'HEALTHY';
                const st = faultStats[sen];
                const isSelectedFaultSen =
                  selectedObs?.verdict === 'SENSOR_FAULT' && selectedObs.sensor === sen;

                const statusColor =
                  status === 'HEALTHY'
                    ? 'text-emerald-700 bg-emerald-50 border-emerald-200'
                    : status === 'WATCH'
                    ? 'text-amber-700 bg-amber-50 border-amber-200'
                    : 'text-red-700 bg-red-50 border-red-200';

                const barColor =
                  score >= 80
                    ? 'bg-emerald-500'
                    : score >= 60
                    ? 'bg-amber-500'
                    : 'bg-red-500';

                const biasStr =
                  h?.bias_24h != null
                    ? `${h.bias_24h > 0 ? '+' : ''}${h.bias_24h.toFixed(sen === 'rh' ? 0 : 1)} ${SENSOR_UNITS[sen]}`
                    : null;

                const why =
                  st && st.n > 0
                    ? `${st.n} of ${st.total} readings faulty (7d)${st.top ? ` · ${st.top}` : ''}`
                    : biasStr
                    ? `No faults in 7d · bias ${biasStr}`
                    : 'All readings nominal (7d)';

                return (
                  <div
                    key={sen}
                    className={`p-3 rounded-md border text-xs ${
                      isSelectedFaultSen
                        ? 'bg-red-50/50 border-red-200 ring-1 ring-red-200'
                        : 'bg-slate-50 border-slate-200'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-1.5 font-bold text-slate-800">
                        <span>{SENSOR_NAMES[sen]}</span>
                        {isSelectedFaultSen && (
                          <span className="text-[10px] text-red-600 font-mono font-semibold">
                            ← Active Fault
                          </span>
                        )}
                      </div>
                      <span className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold border ${statusColor}`}>
                        {status}
                      </span>
                    </div>

                    <div className="flex items-center gap-2 my-1.5">
                      <div className="flex-1 bg-slate-200 rounded-full h-2 overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all ${barColor}`}
                          style={{ width: `${Math.max(5, score)}%` }}
                        />
                      </div>
                      <span className="font-mono font-bold text-slate-800 text-[11px]">
                        {score} / 100
                      </span>
                    </div>

                    <div className="text-[11px] text-slate-500 font-sans mt-1">
                      {why}
                    </div>

                    <div className="grid grid-cols-2 gap-2 mt-2 pt-2 border-t border-slate-200/60 text-[10px] font-mono text-slate-500">
                      <div>
                        24h Offset:{' '}
                        <strong className="text-slate-700">
                          {biasStr || '0.00'}
                        </strong>
                      </div>
                      <div>
                        Drift Slope:{' '}
                        <strong className="text-slate-700">
                          {h?.drift_slope_z_per_day != null
                            ? `${h.drift_slope_z_per_day.toFixed(3)}/d`
                            : '0.000'}
                        </strong>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Overall Station QA Score */}
            <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between text-xs font-mono">
              <span className="text-slate-600 font-sans font-medium">
                Overall Station QA Status:
              </span>
              <span className="font-bold text-slate-900">
                {data.health?.station?.health ?? 95} / 100 (
                {data.health?.station?.status || 'HEALTHY'})
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
