import React from 'react';
import type { OverviewData, NetworkMeta } from '../../types';
import { VerdictBadge } from '../common/VerdictBadge';
import { SeverityBadge } from '../common/SeverityBadge';
import { CheckCircle2, AlertOctagon, CloudRain, WifiOff, HelpCircle, ArrowRight } from 'lucide-react';

interface OverviewViewProps {
  overview: OverviewData;
  meta: NetworkMeta | null;
  onSelectStation: (stationId: string, timestamp?: string | null) => void;
  onGoToAlerts: () => void;
  onGoToMap: () => void;
}

export const OverviewView: React.FC<OverviewViewProps> = ({
  overview,
  meta,
  onSelectStation,
  onGoToAlerts,
  onGoToMap,
}) => {
  const stationNameMap = React.useMemo(() => {
    const map = new Map<string, string>();
    meta?.stations.forEach((s) => map.set(s.station_id, s.name));
    return map;
  }, [meta]);

  const counts = overview.verdict_counts || {};
  const total = overview.stations.length;
  const normal = counts['NORMAL'] || 0;
  const faults = counts['SENSOR_FAULT'] || 0;
  const genuine = counts['GENUINE_WEATHER_EVENT'] || 0;
  const comms = counts['DATA_COMM_ISSUE'] || 0;
  const uncertain = counts['UNCERTAIN'] || 0;

  // Stations with active non-normal readings
  const activeIssues = overview.stations.filter((s) => {
    const latest = overview.latest[s.station_id];
    return latest && latest.verdict !== 'NORMAL';
  });

  return (
    <div className="space-y-6">
      {/* Top Telemetry Summary Grid */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <div className="bg-white p-3.5 rounded border border-slate-200">
          <div className="text-[11px] font-mono text-slate-500 uppercase tracking-wider">Stations</div>
          <div className="text-2xl font-bold font-mono text-slate-900 mt-1">{total}</div>
          <div className="text-[11px] text-slate-500 mt-1">Real WMO Network</div>
        </div>

        <div className="bg-white p-3.5 rounded border border-slate-200 border-l-3 border-l-emerald-600">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-mono text-emerald-800 uppercase tracking-wider">Normal</span>
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
          </div>
          <div className="text-2xl font-bold font-mono text-emerald-700 mt-1">{normal}</div>
          <div className="text-[11px] text-emerald-600 mt-1">{(total ? (normal / total) * 100 : 0).toFixed(0)}% reporting nominal</div>
        </div>

        <div className="bg-white p-3.5 rounded border border-slate-200 border-l-3 border-l-red-600">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-mono text-red-800 uppercase tracking-wider">Sensor Faults</span>
            <AlertOctagon className="w-3.5 h-3.5 text-red-600" />
          </div>
          <div className="text-2xl font-bold font-mono text-red-700 mt-1">{faults}</div>
          <div className="text-[11px] text-red-600 mt-1">Requires maintenance</div>
        </div>

        <div className="bg-white p-3.5 rounded border border-slate-200 border-l-3 border-l-amber-600">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-mono text-amber-800 uppercase tracking-wider">Weather Events</span>
            <CloudRain className="w-3.5 h-3.5 text-amber-600" />
          </div>
          <div className="text-2xl font-bold font-mono text-amber-700 mt-1">{genuine}</div>
          <div className="text-[11px] text-amber-600 mt-1">Witness consensus: Real</div>
        </div>

        <div className="bg-white p-3.5 rounded border border-slate-200 border-l-3 border-l-blue-600">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-mono text-blue-800 uppercase tracking-wider">Data Comms</span>
            <WifiOff className="w-3.5 h-3.5 text-blue-600" />
          </div>
          <div className="text-2xl font-bold font-mono text-blue-700 mt-1">{comms}</div>
          <div className="text-[11px] text-blue-600 mt-1">Missing / Stale packets</div>
        </div>

        <div className="bg-white p-3.5 rounded border border-slate-200 border-l-3 border-l-yellow-600">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-mono text-yellow-800 uppercase tracking-wider">Uncertain</span>
            <HelpCircle className="w-3.5 h-3.5 text-yellow-600" />
          </div>
          <div className="text-2xl font-bold font-mono text-yellow-700 mt-1">{uncertain}</div>
          <div className="text-[11px] text-yellow-600 mt-1">Persistence guard / watch</div>
        </div>
      </div>

      {/* Main split: Action Items & Active Episodes */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left 2 Cols: Stations Needing Attention */}
        <div className="lg:col-span-2 bg-white rounded border border-slate-200 overflow-hidden shadow-2xs">
          <div className="px-5 py-3.5 bg-slate-50/70 border-b border-slate-200 flex items-center justify-between">
            <div>
              <h2 className="text-xs font-bold text-slate-800 uppercase tracking-wider">
                Active Station Anomalies ({activeIssues.length})
              </h2>
              <p className="text-[11px] text-slate-500 mt-0.5">
                Current observations diverging from WMO climatology and spatial consensus
              </p>
            </div>
            <button
              onClick={onGoToMap}
              className="inline-flex items-center gap-1 text-xs font-semibold text-sky-700 hover:text-sky-900 cursor-pointer"
            >
              <span>View On Live Map</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 text-slate-600 font-mono text-[11px] border-b border-slate-200">
                <tr>
                  <th className="py-2.5 px-4">Station</th>
                  <th className="py-2.5 px-3">Verdict</th>
                  <th className="py-2.5 px-3">Cause / Sensor</th>
                  <th className="py-2.5 px-3">Readings</th>
                  <th className="py-2.5 px-3 text-right">Confidence</th>
                  <th className="py-2.5 px-4 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-mono">
                {activeIssues.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-8 text-center text-slate-500 font-sans">
                      All network stations are currently operating within nominal parameters.
                    </td>
                  </tr>
                ) : (
                  activeIssues.map((s) => {
                    const row = overview.latest[s.station_id];
                    const name = stationNameMap.get(s.station_id) || s.station_id;
                    if (!row) return null;
                    return (
                      <tr
                        key={s.station_id}
                        onClick={() => onSelectStation(s.station_id, row.ts)}
                        className="hover:bg-slate-50/80 cursor-pointer transition"
                      >
                        <td className="py-2.5 px-4 font-sans font-medium text-slate-900">
                          <div>{name}</div>
                          <div className="text-[11px] text-slate-500 font-mono">{s.station_id}</div>
                        </td>
                        <td className="py-2.5 px-3 whitespace-nowrap">
                          <VerdictBadge verdict={row.verdict} size="sm" />
                        </td>
                        <td className="py-2.5 px-3 whitespace-nowrap">
                          <span className="font-semibold text-slate-800 capitalize">
                            {row.fault || 'Anomalous'}
                          </span>
                          {row.sensor && (
                            <span className="text-slate-500 text-[11px] ml-1">
                              ({row.sensor})
                            </span>
                          )}
                        </td>
                        <td className="py-2.5 px-3 text-slate-700 whitespace-nowrap text-[11px]">
                          T: {row.temp != null ? `${row.temp.toFixed(1)}°` : '—'} | P:{' '}
                          {row.pres != null ? `${row.pres.toFixed(0)}` : '—'} | RH:{' '}
                          {row.rh != null ? `${row.rh.toFixed(0)}%` : '—'}
                        </td>
                        <td className="py-2.5 px-3 text-right text-slate-800 font-semibold">
                          {row.confidence != null ? `${(row.confidence * 100).toFixed(0)}%` : '—'}
                        </td>
                        <td className="py-2.5 px-4 text-right">
                          <span className="text-sky-700 hover:underline text-[11px] font-sans font-medium">
                            Inspect →
                          </span>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Right Col: Network Status & Alert Episodes */}
        <div className="space-y-6">
          {/* Operational Context Card */}
          <div className="bg-white p-4 rounded border border-slate-200">
            <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider mb-3">
              Operational Configuration
            </h3>
            <div className="space-y-2.5 text-xs">
              <div className="flex justify-between py-1 border-b border-slate-100 font-mono">
                <span className="text-slate-500 font-sans">Cadence</span>
                <span className="font-semibold text-slate-800">
                  {overview.report?.cadence_h || 1.0} hr
                </span>
              </div>
              <div className="flex justify-between py-1 border-b border-slate-100 font-mono">
                <span className="text-slate-500 font-sans">Decision Threshold (θ)</span>
                <span className="font-semibold text-slate-800">
                  {meta?.theta != null ? meta.theta.toFixed(3) : '0.855'}
                </span>
              </div>
              <div className="flex justify-between py-1 border-b border-slate-100 font-mono">
                <span className="text-slate-500 font-sans">Engine Features</span>
                <span className="font-semibold text-slate-800">
                  {meta?.n_features || 104} derived
                </span>
              </div>
              <div className="flex justify-between py-1 border-b border-slate-100 font-mono">
                <span className="text-slate-500 font-sans">Spatial Regression</span>
                <span className="font-semibold text-emerald-700">Hubbard SRT Active</span>
              </div>
              <div className="flex justify-between py-1 font-mono">
                <span className="text-slate-500 font-sans">Benchmark Evaluation Window</span>
                <span className="font-semibold text-slate-800 text-[11px]">
                  {meta?.demo_window ? `${meta.demo_window[0]} → ${meta.demo_window[1]}` : '2025 Test'}
                </span>
              </div>
            </div>
          </div>

          {/* Recent Episodes Preview */}
          <div className="bg-white p-4 rounded border border-slate-200">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider">
                Recent Alert Episodes (7d)
              </h3>
              <button
                onClick={onGoToAlerts}
                className="text-xs font-semibold text-sky-700 hover:text-sky-900 cursor-pointer"
              >
                All ({overview.recent_alerts?.length || 0})
              </button>
            </div>

            <div className="space-y-2">
              {overview.recent_alerts?.slice(0, 5).map((alert, idx) => {
                const name = stationNameMap.get(alert.station_id) || alert.station_id;
                return (
                  <div
                    key={idx}
                    onClick={() => onSelectStation(alert.station_id, alert.ts)}
                    className="p-2.5 rounded bg-slate-50/70 hover:bg-slate-100/80 border border-slate-200/80 cursor-pointer transition text-xs"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-slate-900">{name}</span>
                      <VerdictBadge verdict={alert.verdict} size="sm" />
                    </div>
                    <div className="flex items-center justify-between mt-1 text-[11px] text-slate-500 font-mono">
                      <span>{alert.fault} ({alert.sensor})</span>
                      <SeverityBadge severity={alert.severity} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
