import React, { useState } from 'react';
import type { OverviewData, NetworkMeta } from '../../types';
import { VerdictBadge } from '../common/VerdictBadge';
import { SeverityBadge } from '../common/SeverityBadge';
import { Filter, Clock } from 'lucide-react';

interface AlertsViewProps {
  overview: OverviewData;
  meta: NetworkMeta | null;
  onSelectStation: (stationId: string, timestamp?: string | null) => void;
}

export const AlertsView: React.FC<AlertsViewProps> = ({
  overview,
  meta,
  onSelectStation,
}) => {
  const [activeOnly, setActiveOnly] = useState(false);
  const [severityFilter, setSeverityFilter] = useState('ALL');
  const [sensorFilter, setSensorFilter] = useState('ALL');

  const stationNameMap = React.useMemo(() => {
    const map = new Map<string, string>();
    meta?.stations.forEach((s) => map.set(s.station_id, s.name));
    return map;
  }, [meta]);

  const episodes = overview.recent_alerts || [];

  const filtered = episodes.filter((ep) => {
    if (activeOnly && !ep.active) return false;
    if (severityFilter !== 'ALL' && ep.severity !== severityFilter) return false;
    if (sensorFilter !== 'ALL' && ep.sensor !== sensorFilter) return false;
    return true;
  });

  const activeCount = episodes.filter((e) => e.active).length;

  return (
    <div className="bg-white rounded border border-slate-200 overflow-hidden shadow-2xs">
      {/* Alert Filters Toolbar */}
      <div className="p-4 bg-slate-50/70 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3 text-xs">
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 cursor-pointer font-medium text-slate-700">
            <input
              type="checkbox"
              checked={activeOnly}
              onChange={(e) => setActiveOnly(e.target.checked)}
              className="rounded border-slate-300 text-sky-700 focus:ring-sky-500"
            />
            <span>Active Alerts Only ({activeCount})</span>
          </label>

          <div className="h-4 w-px bg-slate-300 mx-1"></div>

          <div className="flex items-center gap-1.5">
            <Filter className="w-3.5 h-3.5 text-slate-400" />
            <select
              value={severityFilter}
              onChange={(e) => setSeverityFilter(e.target.value)}
              className="px-2.5 py-1.5 border border-slate-200 rounded bg-white font-medium text-slate-700 focus:outline-none"
            >
              <option value="ALL">All Severities</option>
              <option value="CRITICAL">Critical Only</option>
              <option value="HIGH">High</option>
              <option value="MEDIUM">Medium</option>
              <option value="LOW">Low</option>
            </select>
          </div>

          <select
            value={sensorFilter}
            onChange={(e) => setSensorFilter(e.target.value)}
            className="px-2.5 py-1.5 border border-slate-200 rounded bg-white font-medium text-slate-700 focus:outline-none"
          >
            <option value="ALL">All Sensors</option>
            <option value="temp">Temperature</option>
            <option value="pres">Pressure</option>
            <option value="rh">Relative Humidity</option>
          </select>
        </div>

        <div className="text-[11px] font-mono text-slate-500">
          <strong>{filtered.length}</strong> alert episodes recorded in last 7 days
        </div>
      </div>

      {/* Alerts Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead className="bg-slate-50 text-slate-600 font-mono text-[11px] border-b border-slate-200">
            <tr>
              <th className="py-3 px-4">State</th>
              <th className="py-3 px-3">Time Period (UTC)</th>
              <th className="py-3 px-3">Station</th>
              <th className="py-3 px-3">Verdict</th>
              <th className="py-3 px-3">Root Cause</th>
              <th className="py-3 px-3">Sensor</th>
              <th className="py-3 px-3">Severity</th>
              <th className="py-3 px-3 text-right">Conf</th>
              <th className="py-3 px-4">Recommended Action</th>
              <th className="py-3 px-4 text-right">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 font-mono">
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={10} className="py-12 text-center text-slate-500 font-sans">
                  No alert episodes matching the selected filters.
                </td>
              </tr>
            ) : (
              filtered.map((ep, idx) => {
                const name = stationNameMap.get(ep.station_id) || ep.station_id;
                const timeSpan =
                  ep.hours > 1 && ep.start
                    ? `${ep.start.slice(5, 16)} → ${ep.ts.slice(5, 16)} (${ep.hours}h)`
                    : ep.ts.slice(5, 16);

                return (
                  <tr
                    key={idx}
                    onClick={() => onSelectStation(ep.station_id, ep.ts)}
                    className="hover:bg-slate-50 cursor-pointer transition"
                  >
                    <td className="py-3 px-4 whitespace-nowrap">
                      {ep.active ? (
                        <span className="inline-flex items-center gap-1 font-bold text-red-700 bg-red-50 border border-red-200 px-2 py-0.5 rounded text-[11px]">
                          <span className="w-1.5 h-1.5 rounded-full bg-red-600 animate-ping"></span>
                          ACTIVE
                        </span>
                      ) : (
                        <span className="text-slate-400 text-[11px] flex items-center gap-1">
                          <Clock className="w-3 h-3 text-slate-300" />
                          Cleared
                        </span>
                      )}
                    </td>
                    <td className="py-3 px-3 text-slate-600 text-[11px] whitespace-nowrap">
                      {timeSpan}
                    </td>
                    <td className="py-3 px-3 font-sans font-medium text-slate-900 whitespace-nowrap">
                      <div>{name}</div>
                      <div className="text-[11px] text-slate-400 font-mono">{ep.station_id}</div>
                    </td>
                    <td className="py-3 px-3 whitespace-nowrap">
                      <VerdictBadge verdict={ep.verdict} size="sm" />
                    </td>
                    <td className="py-3 px-3 capitalize font-semibold text-slate-800">
                      {ep.fault || '—'}
                    </td>
                    <td className="py-3 px-3 text-slate-600 uppercase">
                      {ep.sensor || 'all'}
                    </td>
                    <td className="py-3 px-3 whitespace-nowrap">
                      <SeverityBadge severity={ep.severity} />
                    </td>
                    <td className="py-3 px-3 text-right font-semibold text-slate-800">
                      {ep.confidence != null ? `${(ep.confidence * 100).toFixed(0)}%` : '—'}
                    </td>
                    <td className="py-3 px-4 font-sans text-slate-600 max-w-xs truncate" title={ep.action}>
                      {ep.action || 'No action required.'}
                    </td>
                    <td className="py-3 px-4 text-right whitespace-nowrap">
                      <span className="text-sky-700 hover:text-sky-900 font-sans font-medium">
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
  );
};
