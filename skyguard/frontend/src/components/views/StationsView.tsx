import React, { useState } from 'react';
import type { OverviewData, NetworkMeta } from '../../types';
import { VerdictBadge } from '../common/VerdictBadge';
import { Search, Filter, ArrowUpDown } from 'lucide-react';

interface StationsViewProps {
  overview: OverviewData;
  meta: NetworkMeta | null;
  onSelectStation: (stationId: string) => void;
}

export const StationsView: React.FC<StationsViewProps> = ({
  overview,
  meta,
  onSelectStation,
}) => {
  const [search, setSearch] = useState('');
  const [verdictFilter, setVerdictFilter] = useState('ALL');
  const [sortBy, setSortBy] = useState<'name' | 'id' | 'health' | 'status'>('status');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');

  const stations = meta?.stations || [];
  const latestMap = overview.latest || {};
  const healthMap = React.useMemo(() => {
    const map = new Map<string, number>();
    overview.stations.forEach((s) => {
      const hVal = typeof s.health === 'object' && s.health !== null ? (s.health as any).health : s.health;
      map.set(s.station_id, typeof hVal === 'number' && !isNaN(hVal) ? hVal : 100);
    });
    return map;
  }, [overview.stations]);

  const filtered = stations
    .filter((s) => {
      const q = search.toLowerCase();
      const matchText =
        s.name.toLowerCase().includes(q) ||
        s.station_id.toLowerCase().includes(q) ||
        (s.region && s.region.toLowerCase().includes(q));
      if (!matchText) return false;

      const verdict = latestMap[s.station_id]?.verdict || 'NORMAL';
      if (verdictFilter !== 'ALL' && verdict !== verdictFilter) return false;
      return true;
    })
    .sort((a, b) => {
      let cmp = 0;
      if (sortBy === 'name') {
        cmp = a.name.localeCompare(b.name);
      } else if (sortBy === 'id') {
        cmp = a.station_id.localeCompare(b.station_id);
      } else if (sortBy === 'health') {
        const ha = healthMap.get(a.station_id) ?? 100;
        const hb = healthMap.get(b.station_id) ?? 100;
        cmp = ha - hb;
      } else if (sortBy === 'status') {
        const order: Record<string, number> = {
          SENSOR_FAULT: 0,
          DATA_COMM_ISSUE: 1,
          GENUINE_WEATHER_EVENT: 2,
          UNCERTAIN: 3,
          NORMAL: 4,
        };
        const va = order[latestMap[a.station_id]?.verdict || 'NORMAL'] ?? 9;
        const vb = order[latestMap[b.station_id]?.verdict || 'NORMAL'] ?? 9;
        cmp = va - vb;
      }
      return sortOrder === 'asc' ? cmp : -cmp;
    });

  const toggleSort = (field: 'name' | 'id' | 'health' | 'status') => {
    if (sortBy === field) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(field);
      setSortOrder('asc');
    }
  };

  const getHealthColor = (h: number) => {
    if (h >= 80) return 'bg-emerald-500';
    if (h >= 60) return 'bg-yellow-500';
    if (h >= 40) return 'bg-orange-500';
    return 'bg-red-500';
  };

  return (
    <div className="bg-white rounded border border-slate-200 overflow-hidden shadow-2xs">
      {/* Table Filter Header */}
      <div className="p-4 bg-slate-50/70 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3 text-xs">
        <div className="flex items-center gap-3">
          <div className="relative w-64">
            <Search className="w-3.5 h-3.5 absolute left-3 top-2.5 text-slate-400" />
            <input
              type="text"
              placeholder="Filter by name, ID, or region..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-8 pr-3 py-1.5 bg-white border border-slate-200 rounded text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-sky-500"
            />
          </div>

          <div className="flex items-center gap-1.5">
            <Filter className="w-3.5 h-3.5 text-slate-400" />
            <select
              value={verdictFilter}
              onChange={(e) => setVerdictFilter(e.target.value)}
              className="px-2.5 py-1.5 border border-slate-200 rounded bg-white font-medium text-slate-700 focus:outline-none"
            >
              <option value="ALL">All Statuses</option>
              <option value="NORMAL">Normal Only</option>
              <option value="SENSOR_FAULT">Sensor Faults</option>
              <option value="GENUINE_WEATHER_EVENT">Weather Events</option>
              <option value="DATA_COMM_ISSUE">Data Comms Issues</option>
              <option value="UNCERTAIN">Uncertain</option>
            </select>
          </div>
        </div>

        <div className="text-[11px] font-mono text-slate-500">
          Showing <strong>{filtered.length}</strong> of {stations.length} stations
        </div>
      </div>

      {/* Stations Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead className="bg-slate-50 text-slate-600 font-mono text-[11px] border-b border-slate-200">
            <tr>
              <th
                onClick={() => toggleSort('name')}
                className="py-3 px-4 cursor-pointer hover:text-slate-900 select-none"
              >
                <div className="flex items-center gap-1">
                  <span>Station Name</span>
                  <ArrowUpDown className="w-3 h-3 text-slate-400" />
                </div>
              </th>
              <th
                onClick={() => toggleSort('id')}
                className="py-3 px-3 cursor-pointer hover:text-slate-900 select-none"
              >
                <div className="flex items-center gap-1">
                  <span>WMO ID</span>
                  <ArrowUpDown className="w-3 h-3 text-slate-400" />
                </div>
              </th>
              <th className="py-3 px-3">Coords / Elev</th>
              <th className="py-3 px-3 text-right">Temp (°C)</th>
              <th className="py-3 px-3 text-right">Pres (hPa)</th>
              <th className="py-3 px-3 text-right">RH (%)</th>
              <th
                onClick={() => toggleSort('status')}
                className="py-3 px-3 cursor-pointer hover:text-slate-900 select-none"
              >
                <div className="flex items-center gap-1">
                  <span>Status</span>
                  <ArrowUpDown className="w-3 h-3 text-slate-400" />
                </div>
              </th>
              <th
                onClick={() => toggleSort('health')}
                className="py-3 px-4 cursor-pointer hover:text-slate-900 select-none"
              >
                <div className="flex items-center gap-1">
                  <span>7d Health</span>
                  <ArrowUpDown className="w-3 h-3 text-slate-400" />
                </div>
              </th>
              <th className="py-3 px-4 text-right">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 font-mono">
            {filtered.map((s) => {
              const latest = latestMap[s.station_id];
              const verdict = latest?.verdict || 'NORMAL';
              const health = healthMap.get(s.station_id) ?? 100;

              return (
                <tr
                  key={s.station_id}
                  onClick={() => onSelectStation(s.station_id)}
                  className="hover:bg-slate-50 cursor-pointer transition"
                >
                  <td className="py-3 px-4 font-sans font-medium text-slate-900">
                    <div>{s.name}</div>
                    {s.region && (
                      <div className="text-[11px] text-slate-400 font-sans">{s.region}</div>
                    )}
                  </td>
                  <td className="py-3 px-3 text-slate-600 font-semibold">{s.station_id}</td>
                  <td className="py-3 px-3 text-[11px] text-slate-500 whitespace-nowrap">
                    {s.lat.toFixed(2)}°N, {s.lon.toFixed(2)}°E · {s.elev}m
                  </td>
                  <td className="py-3 px-3 text-right font-semibold text-slate-800">
                    {latest?.temp != null ? latest.temp.toFixed(1) : '—'}
                  </td>
                  <td className="py-3 px-3 text-right font-semibold text-slate-800">
                    {latest?.pres != null ? latest.pres.toFixed(0) : '—'}
                  </td>
                  <td className="py-3 px-3 text-right font-semibold text-slate-800">
                    {latest?.rh != null ? `${latest.rh.toFixed(0)}%` : '—'}
                  </td>
                  <td className="py-3 px-3 whitespace-nowrap">
                    <VerdictBadge verdict={verdict} size="sm" />
                  </td>
                  <td className="py-3 px-4">
                    <div className="flex items-center gap-2">
                      <div className="w-16 h-2 bg-slate-100 rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full ${getHealthColor(health)}`}
                          style={{ width: `${Math.max(5, health)}%` }}
                        />
                      </div>
                      <span className="text-[11px] text-slate-700 font-semibold">
                        {health.toFixed(0)}%
                      </span>
                    </div>
                  </td>
                  <td className="py-3 px-4 text-right">
                    <span className="text-sky-700 hover:text-sky-900 font-sans font-medium">
                      Inspect →
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};
