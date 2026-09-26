import React, { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import type { OverviewData, NetworkMeta, StationMeta, VerdictType } from '../../types';
import { VerdictBadge } from '../common/VerdictBadge';
import { Filter, Search, Maximize2, Compass } from 'lucide-react';

interface LiveMapViewProps {
  overview: OverviewData;
  meta: NetworkMeta | null;
  onSelectStation: (stationId: string) => void;
}

const VERDICT_COLORS: Record<VerdictType, string> = {
  NORMAL: '#10b981', // Emerald
  SENSOR_FAULT: '#ef4444', // Red
  GENUINE_WEATHER_EVENT: '#f97316', // Orange
  DATA_COMM_ISSUE: '#3b82f6', // Blue
  UNCERTAIN: '#eab308', // Amber
};

export const LiveMapView: React.FC<LiveMapViewProps> = ({
  overview,
  meta,
  onSelectStation,
}) => {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const markersLayerRef = useRef<L.LayerGroup | null>(null);
  const tileLayerRef = useRef<L.TileLayer | null>(null);

  const [filterType, setFilterType] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedStationId, setSelectedStationId] = useState<string | null>(null);
  const [baseMapStyle, setBaseMapStyle] = useState<'osm' | 'canvas'>('osm');

  const stations = meta?.stations || [];
  const latestMap = overview.latest || {};

  // Filter stations based on selection and search
  const filteredStations = stations.filter((s) => {
    const latest = latestMap[s.station_id];
    const verdict = latest?.verdict || 'NORMAL';

    if (filterType === 'anomalies' && verdict === 'NORMAL') return false;
    if (filterType === 'faults' && verdict !== 'SENSOR_FAULT') return false;
    if (filterType === 'weather' && verdict !== 'GENUINE_WEATHER_EVENT') return false;
    if (filterType === 'comms' && verdict !== 'DATA_COMM_ISSUE') return false;
    if (filterType === 'uncertain' && verdict !== 'UNCERTAIN') return false;

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      return (
        s.name.toLowerCase().includes(q) ||
        s.station_id.toLowerCase().includes(q) ||
        (s.region && s.region.toLowerCase().includes(q))
      );
    }
    return true;
  });

  // Initialize Leaflet Map
  useEffect(() => {
    if (!mapContainerRef.current) return;

    if (!mapInstanceRef.current) {
      // Default center over India: ~21.5° N, 78.9° E
      const map = L.map(mapContainerRef.current, {
        center: [21.5, 78.9],
        zoom: 5,
        zoomControl: true,
        attributionControl: false,
      });

      // Base tile layer without API key requirements (free OpenStreetMap)
      const initialTileLayer = L.tileLayer(
        'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
        {
          maxZoom: 19,
          subdomains: 'abc',
          attribution: '&copy; OpenStreetMap contributors',
        }
      ).addTo(map);
      tileLayerRef.current = initialTileLayer;

      // Attribution in subtle bottom right
      L.control.attribution({ position: 'bottomright', prefix: false }).addTo(map);

      const markersGroup = L.layerGroup().addTo(map);
      markersLayerRef.current = markersGroup;
      mapInstanceRef.current = map;
    }

    return () => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
        markersLayerRef.current = null;
        tileLayerRef.current = null;
      }
    };
  }, []);

  // Handle Dynamic Basemap Switching (OSM vs Clean Canvas)
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    if (tileLayerRef.current) {
      map.removeLayer(tileLayerRef.current);
    }

    const newLayer =
      baseMapStyle === 'canvas'
        ? L.tileLayer(
            'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}',
            {
              maxZoom: 16,
              attribution: 'Tiles &copy; Esri &mdash; Esri, DeLorme, NAVTEQ',
            }
          )
        : L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            maxZoom: 19,
            subdomains: 'abc',
            attribution: '&copy; OpenStreetMap contributors',
          });

    newLayer.addTo(map);
    tileLayerRef.current = newLayer;
  }, [baseMapStyle]);

  // Update Markers when stations, overview, or filters change
  useEffect(() => {
    const map = mapInstanceRef.current;
    const markersGroup = markersLayerRef.current;
    if (!map || !markersGroup) return;

    markersGroup.clearLayers();

    const validCoordinates: L.LatLngExpression[] = [];

    filteredStations.forEach((s) => {
      if (typeof s.lat !== 'number' || typeof s.lon !== 'number' || isNaN(s.lat) || isNaN(s.lon)) {
        return;
      }

      validCoordinates.push([s.lat, s.lon]);

      const latest = latestMap[s.station_id];
      const verdict: VerdictType = latest?.verdict || 'NORMAL';
      const color = VERDICT_COLORS[verdict] || '#64748b';
      const isAnomaly = verdict !== 'NORMAL';
      const isSelected = selectedStationId === s.station_id;

      // Custom divIcon marker
      const pulseHtml = isAnomaly
        ? `<div class="absolute -inset-1.5 rounded-full marker-pulse" style="background-color: ${color}; opacity: 0.35;"></div>`
        : '';

      const markerHtml = `
        <div class="relative flex items-center justify-center cursor-pointer group" style="width: 24px; height: 24px;">
          ${pulseHtml}
          <div class="w-4 h-4 rounded-full border-2 border-white shadow-md transition-transform transform group-hover:scale-125 ${
            isSelected ? 'scale-125 ring-2 ring-sky-600' : ''
          }" style="background-color: ${color};"></div>
        </div>
      `;

      const customIcon = L.divIcon({
        html: markerHtml,
        className: 'custom-station-pin',
        iconSize: [24, 24],
        iconAnchor: [12, 12],
        popupAnchor: [0, -12],
      });

      const marker = L.marker([s.lat, s.lon], { icon: customIcon });

      // Clean Popup Content
      const tempStr = latest?.temp != null ? `${latest.temp.toFixed(1)}°C` : '—';
      const presStr = latest?.pres != null ? `${latest.pres.toFixed(0)} hPa` : '—';
      const rhStr = latest?.rh != null ? `${latest.rh.toFixed(0)}%` : '—';

      const popupHtml = `
        <div class="p-3 min-w-[210px] text-xs font-sans">
          <div class="flex items-start justify-between gap-2 border-b border-slate-100 pb-2 mb-2">
            <div>
              <div class="font-bold text-slate-900 text-sm leading-tight">${s.name}</div>
              <div class="text-[11px] font-mono text-slate-500 mt-0.5">ID: ${s.station_id} · ${s.elev}m elev</div>
            </div>
            <span class="inline-block px-1.5 py-0.5 rounded text-[10px] font-bold text-white uppercase" style="background-color: ${color};">
              ${verdict.replace(/_/g, ' ')}
            </span>
          </div>

          <div class="grid grid-cols-3 gap-1 bg-slate-50 p-2 rounded text-center font-mono text-[11px] mb-2.5">
            <div>
              <div class="text-[9px] uppercase text-slate-400 font-sans">Temp</div>
              <div class="font-bold text-slate-800">${tempStr}</div>
            </div>
            <div>
              <div class="text-[9px] uppercase text-slate-400 font-sans">Pres</div>
              <div class="font-bold text-slate-800">${presStr}</div>
            </div>
            <div>
              <div class="text-[9px] uppercase text-slate-400 font-sans">RH</div>
              <div class="font-bold text-slate-800">${rhStr}</div>
            </div>
          </div>

          ${
            latest?.fault
              ? `<div class="text-[11px] text-slate-600 mb-2"><strong>Root Cause:</strong> <span class="capitalize text-red-600 font-medium">${latest.fault}</span> (${latest.sensor || 'general'})</div>`
              : ''
          }

          <button id="btn-select-${s.station_id}" class="w-full py-2 px-3 bg-sky-700 hover:bg-sky-800 text-white font-semibold rounded text-xs transition flex items-center justify-center gap-1.5 cursor-pointer shadow-xs">
            <span>Open Full AI Diagnosis</span> &rarr;
          </button>
        </div>
      `;

      marker.bindPopup(popupHtml, { closeButton: true, offset: [0, -6] });

      marker.on('click', () => {
        setSelectedStationId(s.station_id);
      });

      marker.on('dblclick', () => {
        onSelectStation(s.station_id);
      });

      marker.on('popupopen', () => {
        const btn = document.getElementById(`btn-select-${s.station_id}`);
        if (btn) {
          btn.onclick = () => {
            onSelectStation(s.station_id);
          };
        }
      });

      markersGroup.addLayer(marker);
    });

    // Auto fit bounds to visible stations on initial load
    if (validCoordinates.length > 0 && !selectedStationId) {
      try {
        const bounds = L.latLngBounds(validCoordinates);
        map.fitBounds(bounds, { padding: [30, 30], maxZoom: 8 });
      } catch {
        // bounds fit fallback
      }
    }
  }, [filteredStations, latestMap, selectedStationId, onSelectStation]);

  // Handle station click from sidebar
  const handleSelectFromList = (station: StationMeta) => {
    setSelectedStationId(station.station_id);
    const map = mapInstanceRef.current;
    if (map && typeof station.lat === 'number' && typeof station.lon === 'number') {
      map.setView([station.lat, station.lon], 8, { animate: true });
    }
  };

  const handleFitAll = () => {
    const map = mapInstanceRef.current;
    if (!map || stations.length === 0) return;
    const coords = stations
      .filter((s) => typeof s.lat === 'number' && typeof s.lon === 'number')
      .map((s) => [s.lat, s.lon] as [number, number]);
    if (coords.length > 0) {
      map.fitBounds(L.latLngBounds(coords), { padding: [30, 30] });
    }
  };

  return (
    <div className="space-y-4">
      {/* Map Control Bar */}
      <div className="bg-white p-3 rounded-lg border border-slate-200 flex flex-wrap items-center justify-between gap-3 text-xs shadow-xs">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1.5 font-semibold text-slate-700">
            <Filter className="w-4 h-4 text-slate-400" />
            <span>Filter Status:</span>
          </div>
          <select
            value={filterType}
            onChange={(e) => setFilterType(e.target.value)}
            className="px-2.5 py-1.5 border border-slate-200 rounded font-medium bg-slate-50 text-slate-700 focus:outline-none focus:ring-1 focus:ring-sky-500"
          >
            <option value="all">All Network Stations ({stations.length})</option>
            <option value="anomalies">Anomalies Only</option>
            <option value="faults">Sensor Faults (Red)</option>
            <option value="weather">Genuine Weather Events (Orange)</option>
            <option value="comms">Data Communication Issues (Blue)</option>
            <option value="uncertain">Uncertain / Watch (Amber)</option>
          </select>

          <button
            onClick={handleFitAll}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-slate-200 rounded font-medium bg-slate-50 text-slate-700 hover:bg-slate-100 transition cursor-pointer"
            title="Reset map view to fit all stations"
          >
            <Maximize2 className="w-3.5 h-3.5 text-slate-500" />
            <span>Fit All Stations</span>
          </button>

          {/* Basemap Style Toggle */}
          <div className="inline-flex rounded-md border border-slate-200 bg-slate-50 p-0.5 text-xs font-medium">
            <button
              onClick={() => setBaseMapStyle('osm')}
              className={`px-2.5 py-1 rounded transition cursor-pointer ${
                baseMapStyle === 'osm'
                  ? 'bg-white text-sky-800 shadow-2xs font-bold'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              OSM Street
            </button>
            <button
              onClick={() => setBaseMapStyle('canvas')}
              className={`px-2.5 py-1 rounded transition cursor-pointer ${
                baseMapStyle === 'canvas'
                  ? 'bg-white text-sky-800 shadow-2xs font-bold'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Light Gray
            </button>
          </div>
        </div>

        <div className="relative w-72">
          <Search className="w-3.5 h-3.5 absolute left-3 top-2.5 text-slate-400" />
          <input
            type="text"
            placeholder="Search station name or ID..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-8 pr-3 py-1.5 text-xs border border-slate-200 rounded bg-slate-50 text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-sky-500"
          />
        </div>
      </div>

      {/* Map Layout Architecture */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4 h-[640px]">
        {/* Geographic Leaflet Map Container */}
        <div className="lg:col-span-3 bg-white rounded-lg border border-slate-200 relative overflow-hidden flex flex-col shadow-xs">
          {/* Leaflet container */}
          <div ref={mapContainerRef} className="w-full h-full relative" />

          {/* Compass / Region badge */}
          <div className="absolute top-3 right-3 z-[1000] bg-white/90 backdrop-blur-xs px-3 py-1.5 rounded border border-slate-200 shadow-xs flex items-center gap-1.5 text-[11px] font-mono font-medium text-slate-700 pointer-events-none">
            <Compass className="w-4 h-4 text-sky-700" />
            <span>INDIAN WMO AWS NETWORK</span>
          </div>

          {/* Legend footer */}
          <div className="absolute bottom-3 left-3 z-[1000] bg-white/95 backdrop-blur-xs px-3.5 py-2 rounded-md border border-slate-200 shadow-xs flex flex-wrap items-center gap-4 text-[11px] font-medium text-slate-600 font-mono">
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 ring-2 ring-emerald-100"></span>
              <span>Normal</span>
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-red-500 ring-2 ring-red-100"></span>
              <span>Sensor Fault</span>
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-orange-500 ring-2 ring-orange-100"></span>
              <span>Weather Event</span>
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-blue-500 ring-2 ring-blue-100"></span>
              <span>Comms Issue</span>
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-amber-500 ring-2 ring-amber-100"></span>
              <span>Uncertain</span>
            </span>
          </div>
        </div>

        {/* Station Listing & Quick Select Sidebar */}
        <div className="bg-white rounded-lg border border-slate-200 flex flex-col h-full overflow-hidden shadow-xs">
          <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between text-xs">
            <span className="font-bold text-slate-800 uppercase tracking-wider font-mono">
              Stations ({filteredStations.length})
            </span>
            <span className="text-[11px] text-slate-500">Click to locate</span>
          </div>

          <div className="flex-1 overflow-y-auto divide-y divide-slate-100">
            {filteredStations.length === 0 ? (
              <div className="p-6 text-center text-xs text-slate-500 font-sans">
                No stations match the selected filter.
              </div>
            ) : (
              filteredStations.map((s) => {
                const latest = latestMap[s.station_id];
                const verdict = latest?.verdict || 'NORMAL';
                const isSelected = selectedStationId === s.station_id;

                return (
                  <div
                    key={s.station_id}
                    onClick={() => handleSelectFromList(s)}
                    className={`p-3 cursor-pointer transition text-xs ${
                      isSelected
                        ? 'bg-sky-50/80 border-l-3 border-l-sky-700'
                        : 'hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="font-semibold text-slate-900">{s.name}</div>
                        <div className="text-[11px] text-slate-500 font-mono mt-0.5">
                          ID: {s.station_id} · {s.elev}m
                        </div>
                      </div>
                      <VerdictBadge verdict={verdict} size="sm" />
                    </div>

                    {latest && (
                      <div className="mt-2 text-[11px] font-mono text-slate-600 flex justify-between bg-slate-50 px-2 py-1 rounded">
                        <span>{latest.temp != null ? `${latest.temp.toFixed(1)}°C` : '—'}</span>
                        <span>{latest.pres != null ? `${latest.pres.toFixed(0)} hPa` : '—'}</span>
                        <span>{latest.rh != null ? `${latest.rh.toFixed(0)}%` : '—'}</span>
                      </div>
                    )}

                    <div className="mt-2 pt-2 border-t border-slate-100 flex items-center justify-between">
                      <span className="text-[10px] text-slate-400 font-mono">
                        {s.lat.toFixed(2)}°N, {s.lon.toFixed(2)}°E
                      </span>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onSelectStation(s.station_id);
                        }}
                        className="text-[11px] font-semibold text-sky-700 hover:text-sky-900 cursor-pointer"
                      >
                        Inspect Details &rarr;
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
