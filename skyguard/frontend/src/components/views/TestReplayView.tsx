import React, { useState, useMemo } from 'react';
import { apiService } from '../../services/api';
import type { ScoreResponse, ObservationRow, IngestRequest, NetworkMeta } from '../../types';
import { DiagnosisPanel } from '../common/DiagnosisPanel';
import { VerdictBadge } from '../common/VerdictBadge';
import { SeverityBadge } from '../common/SeverityBadge';
import { LoadingState } from '../common/LoadingState';
import { ErrorState } from '../common/ErrorState';
import { Upload, FileText, Download, Send, CheckCircle2, Filter } from 'lucide-react';
import { FAULT_NAMES } from '../../utils/diagnosis';

interface TestReplayViewProps {
  meta?: NetworkMeta | null;
  onSelectStation?: (stationId: string) => void;
  onUploadScored?: (uploadId: string) => void;
}

export const TestReplayView: React.FC<TestReplayViewProps> = ({ meta, onSelectStation, onUploadScored }) => {
  const [activeMode, setActiveMode] = useState<'batch' | 'ingest'>('batch');

  // Batch scoring states
  const [isScoring, setIsScoring] = useState(false);
  const [scoringError, setScoringError] = useState<string | null>(null);
  const [scoreResult, setScoreResult] = useState<ScoreResponse | null>(null);
  const [selectedStationFilter, setSelectedStationFilter] = useState<string>('ALL');
  const [selectedAnomalyIndex, setSelectedAnomalyIndex] = useState<number>(0);

  // Single ingestion states
  const [ingestForm, setIngestForm] = useState<IngestRequest>({
    station_id: '42182',
    timestamp: new Date().toISOString().slice(0, 16).replace('T', ' '),
    temperature: 32.4,
    pressure: 1004.5,
    humidity: 48.0,
  });
  const [isIngesting, setIsIngesting] = useState(false);
  const [ingestError, setIngestError] = useState<string | null>(null);
  const [ingestResult, setIngestResult] = useState<ObservationRow | null>(null);

  const handleFileUpload = async (file: File) => {
    setIsScoring(true);
    setScoringError(null);
    try {
      const res = await apiService.scoreFile(file, true);
      setScoreResult(res);
      if (res.report?.upload_id) {
        onUploadScored?.(res.report.upload_id);
      }
      setSelectedAnomalyIndex(0);
      setSelectedStationFilter('ALL');
    } catch (err: any) {
      setScoringError(err.message || 'Scoring analysis failed');
    } finally {
      setIsScoring(false);
    }
  };

  const handleLoadDemoSample = async () => {
    setIsScoring(true);
    setScoringError(null);
    try {
      const blob = await apiService.getSampleCsv();
      const file = new File([blob], 'sample_judge.csv', { type: 'text/csv' });
      await handleFileUpload(file);
    } catch (err: any) {
      setScoringError(err.message || 'Failed to load demo sample');
      setIsScoring(false);
    }
  };

  const handleIngestSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsIngesting(true);
    setIngestError(null);
    try {
      const res = await apiService.ingestObservation(ingestForm);
      setIngestResult(res);
    } catch (err: any) {
      setIngestError(err.message || 'Ingestion request failed');
    } finally {
      setIsIngesting(false);
    }
  };

  // Stations available in the uploaded file
  const stationList = useMemo(() => {
    if (!scoreResult?.stations) return [];
    return Object.keys(scoreResult.stations);
  }, [scoreResult]);

  // Filtered anomalies in the uploaded file
  const filteredAnomalies = useMemo(() => {
    if (!scoreResult?.alerts) return [];
    if (selectedStationFilter === 'ALL') return scoreResult.alerts;
    return scoreResult.alerts.filter((a) => a.station_id === selectedStationFilter);
  }, [scoreResult?.alerts, selectedStationFilter]);

  // Currently selected anomaly for the detailed diagnostic inspection panel
  const selectedAnomaly: ObservationRow | null = useMemo(() => {
    if (!filteredAnomalies.length) return null;
    return filteredAnomalies[selectedAnomalyIndex] || filteredAnomalies[0];
  }, [filteredAnomalies, selectedAnomalyIndex]);

  return (
    <div className="space-y-6">
      {/* Mode Switcher */}
      <div className="flex items-center gap-2 border-b border-slate-200 pb-3">
        <button
          onClick={() => setActiveMode('batch')}
          className={`px-3.5 py-1.5 rounded text-xs font-semibold cursor-pointer transition ${
            activeMode === 'batch'
              ? 'bg-sky-700 text-white shadow-2xs'
              : 'bg-white text-slate-700 border border-slate-200 hover:bg-slate-50'
          }`}
        >
          Batch File Scoring & Diagnostic Audit (CSV / XLSX)
        </button>
        <button
          onClick={() => setActiveMode('ingest')}
          className={`px-3.5 py-1.5 rounded text-xs font-semibold cursor-pointer transition ${
            activeMode === 'ingest'
              ? 'bg-sky-700 text-white shadow-2xs'
              : 'bg-white text-slate-700 border border-slate-200 hover:bg-slate-50'
          }`}
        >
          Live Single Observation Ingestion (POST /api/ingest)
        </button>
      </div>

      {activeMode === 'batch' ? (
        <div className="space-y-6">
          {/* File Upload Zone */}
          <div className="bg-white p-6 rounded-lg border border-slate-200 shadow-xs">
            <h2 className="text-xs font-bold text-slate-800 uppercase tracking-wider font-mono mb-2">
              Batch AWS Observation Analysis (Judge Mode)
            </h2>
            <p className="text-xs text-slate-500 mb-4 leading-relaxed">
              Upload AWS telemetry exports in any format (CSV, TSV, pipe, or Excel .xlsx). The SkyGuard
              schema normalizer automatically recognizes headers, converts units (Kelvin/°F to °C, Pa/inHg to hPa),
              and registers unseen stations on the fly with dynamic climatology estimation.
            </p>

            <div className="border-2 border-dashed border-slate-300 hover:border-sky-500 rounded-lg p-8 text-center transition bg-slate-50/50">
              <Upload className="w-8 h-8 text-slate-400 mx-auto mb-2" />
              <div className="text-sm font-semibold text-slate-800">
                Drag and drop your observation file here
              </div>
              <div className="text-xs text-slate-500 mt-1 mb-4">
                Accepts .csv, .tsv, .txt, or .xlsx (up to 25 MB / 400k rows)
              </div>

              <div className="flex items-center justify-center gap-3">
                <label className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded shadow-xs hover:bg-slate-50 cursor-pointer">
                  <FileText className="w-3.5 h-3.5 text-slate-500" />
                  <span>Select Local File</span>
                  <input
                    type="file"
                    accept=".csv,.tsv,.txt,.xlsx"
                    onChange={(e) => {
                      if (e.target.files?.[0]) handleFileUpload(e.target.files[0]);
                    }}
                    className="hidden"
                  />
                </label>

                <button
                  type="button"
                  onClick={handleLoadDemoSample}
                  disabled={isScoring}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-sky-700 rounded shadow-xs hover:bg-sky-800 transition cursor-pointer disabled:opacity-50"
                >
                  Load Messy Demo Sample
                </button>
              </div>
            </div>

            {isScoring && (
              <div className="mt-4">
                <LoadingState
                  message="Processing AWS observations..."
                  submessage="Executing Tier-1 QC, feature generation, LightGBM detector, and TreeExplainer SHAP attribution"
                />
              </div>
            )}

            {scoringError && (
              <div className="mt-4">
                <ErrorState title="Analysis Failed" message={scoringError} />
              </div>
            )}
          </div>

          {/* Scored Results Display */}
          {scoreResult && (
            <div className="space-y-6">
              {/* Summary Metrics */}
              <div className="bg-white p-5 rounded-lg border border-slate-200 shadow-xs">
                <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-100 pb-3 mb-4">
                  <div>
                    <h3 className="text-sm font-bold text-slate-800">
                      Analysis Results: {scoreResult.report.rows.toLocaleString()} Observations Processed
                    </h3>
                    <div className="text-xs text-slate-500 mt-0.5 font-mono">
                      Execution time: {scoreResult.report.seconds}s · Inferred cadence:{' '}
                      {scoreResult.report.cadence_h}h · Anomalies:{' '}
                      <strong className="text-red-600">{scoreResult.report.alerts.toLocaleString()}</strong>
                    </div>
                  </div>

                  <a
                    href={apiService.getDownloadUrl(scoreResult.report.upload_id)}
                    className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold text-white bg-emerald-700 rounded shadow-xs hover:bg-emerald-800 transition cursor-pointer"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Download Scored CSV</span>
                  </a>
                </div>

                {/* 5 Verdict Summary Cards */}
                <div className="grid grid-cols-2 md:grid-cols-5 gap-3 font-mono text-center">
                  <div className="p-3 bg-emerald-50/70 border border-emerald-200 rounded">
                    <div className="text-[11px] text-emerald-800 uppercase font-sans font-semibold">
                      Normal
                    </div>
                    <div className="text-xl font-bold text-emerald-700 mt-0.5">
                      {scoreResult.report.verdict_counts['NORMAL']?.toLocaleString() || 0}
                    </div>
                  </div>
                  <div className="p-3 bg-red-50/70 border border-red-200 rounded">
                    <div className="text-[11px] text-red-800 uppercase font-sans font-semibold">
                      Sensor Faults
                    </div>
                    <div className="text-xl font-bold text-red-700 mt-0.5">
                      {scoreResult.report.verdict_counts['SENSOR_FAULT']?.toLocaleString() || 0}
                    </div>
                  </div>
                  <div className="p-3 bg-amber-50/70 border border-amber-200 rounded">
                    <div className="text-[11px] text-amber-800 uppercase font-sans font-semibold">
                      Weather Events
                    </div>
                    <div className="text-xl font-bold text-amber-700 mt-0.5">
                      {scoreResult.report.verdict_counts['GENUINE_WEATHER_EVENT']?.toLocaleString() || 0}
                    </div>
                  </div>
                  <div className="p-3 bg-blue-50/70 border border-blue-200 rounded">
                    <div className="text-[11px] text-blue-800 uppercase font-sans font-semibold">
                      Data Comms
                    </div>
                    <div className="text-xl font-bold text-blue-700 mt-0.5">
                      {scoreResult.report.verdict_counts['DATA_COMM_ISSUE']?.toLocaleString() || 0}
                    </div>
                  </div>
                  <div className="p-3 bg-yellow-50/70 border border-yellow-200 rounded">
                    <div className="text-[11px] text-yellow-800 uppercase font-sans font-semibold">
                      Uncertain
                    </div>
                    <div className="text-xl font-bold text-yellow-700 mt-0.5">
                      {scoreResult.report.verdict_counts['UNCERTAIN']?.toLocaleString() || 0}
                    </div>
                  </div>
                </div>

                {scoreResult.report.schema?.notes && scoreResult.report.schema.notes.length > 0 && (
                  <div className="mt-3 text-xs bg-slate-50 p-2.5 rounded border border-slate-200 text-slate-600">
                    <strong className="text-slate-800">Auto-Handled Normalizations:</strong>{' '}
                    {scoreResult.report.schema.notes.join(' · ')}
                  </div>
                )}

                {scoreResult.report.unseen_stations && scoreResult.report.unseen_stations.length > 0 && (
                  <div className="mt-2 text-xs bg-sky-50 p-2.5 rounded border border-sky-200 text-sky-800">
                    <strong className="text-sky-950">Cold-Start Stations:</strong>{' '}
                    {scoreResult.report.unseen_stations.join(', ')} (climatology fitted directly from file data)
                  </div>
                )}
              </div>

              {/* DETAILED RESULTS TABLE & DIAGNOSTIC INSPECTOR */}
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                {/* Left (7 cols): Anomalies Table with station selector */}
                <div className="lg:col-span-7 space-y-4">
                  <div className="bg-white rounded-lg border border-slate-200 overflow-hidden shadow-xs">
                    <div className="p-4 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3 text-xs">
                      <div>
                        <h3 className="font-bold text-slate-800 uppercase tracking-wider font-mono">
                          Flagged Anomalous Observations ({filteredAnomalies.length})
                        </h3>
                        <p className="text-[11px] text-slate-500">
                          Click any row to inspect its full AI diagnosis, SHAP drivers, and corrected value
                        </p>
                      </div>

                      {stationList.length > 1 && (
                        <div className="flex items-center gap-1.5">
                          <Filter className="w-3.5 h-3.5 text-slate-400" />
                          <select
                            value={selectedStationFilter}
                            onChange={(e) => {
                              setSelectedStationFilter(e.target.value);
                              setSelectedAnomalyIndex(0);
                            }}
                            className="px-2.5 py-1.5 border border-slate-200 rounded font-medium bg-white text-slate-700 text-xs focus:outline-none"
                          >
                            <option value="ALL">All Stations ({stationList.length})</option>
                            {stationList.map((sid) => (
                              <option key={sid} value={sid}>
                                Station {sid}
                              </option>
                            ))}
                          </select>
                        </div>
                      )}
                    </div>

                    <div className="overflow-x-auto max-h-[520px] overflow-y-auto">
                      <table className="w-full text-left text-xs font-mono">
                        <thead className="bg-slate-50 text-slate-600 text-[11px] border-b border-slate-200 sticky top-0">
                          <tr>
                            <th className="py-2.5 px-3">Timestamp (UTC)</th>
                            <th className="py-2.5 px-3">Station</th>
                            <th className="py-2.5 px-3">Verdict</th>
                            <th className="py-2.5 px-3">Cause</th>
                            <th className="py-2.5 px-3">Sensor</th>
                            <th className="py-2.5 px-3">Severity</th>
                            <th className="py-2.5 px-3 text-right">Conf</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {filteredAnomalies.length === 0 ? (
                            <tr>
                              <td colSpan={7} className="py-12 text-center text-slate-500 font-sans">
                                No anomalous observations found in this file.
                              </td>
                            </tr>
                          ) : (
                            filteredAnomalies.map((al, idx) => {
                              const isSel = idx === selectedAnomalyIndex;
                              return (
                                <tr
                                  key={idx}
                                  onClick={() => setSelectedAnomalyIndex(idx)}
                                  className={`cursor-pointer transition select-none ${
                                    isSel
                                      ? 'bg-sky-100/70 font-semibold'
                                      : 'hover:bg-slate-50'
                                  }`}
                                >
                                  <td className="py-2.5 px-3 whitespace-nowrap text-slate-800">
                                    {al.ts}
                                  </td>
                                  <td className="py-2.5 px-3 font-semibold text-slate-700">
                                    {al.station_id}
                                  </td>
                                  <td className="py-2.5 px-3 whitespace-nowrap">
                                    <VerdictBadge verdict={al.verdict} size="sm" />
                                  </td>
                                  <td className="py-2.5 px-3 capitalize text-slate-700 whitespace-nowrap">
                                    {FAULT_NAMES[al.fault || ''] || al.fault || '—'}
                                  </td>
                                  <td className="py-2.5 px-3 uppercase text-slate-600 whitespace-nowrap">
                                    {al.sensor || 'all'}
                                  </td>
                                  <td className="py-2.5 px-3 whitespace-nowrap">
                                    <SeverityBadge severity={al.severity} size="sm" />
                                  </td>
                                  <td className="py-2.5 px-3 text-right text-slate-800">
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
                </div>

                {/* Right (5 cols): Diagnostic Inspector Panel for the Selected Anomaly */}
                <div className="lg:col-span-5 space-y-4">
                  {selectedAnomaly ? (
                    <>
                      {/* Active Observation Card */}
                      <div className="bg-white p-4 rounded-lg border border-slate-200 shadow-xs">
                        <div className="flex items-center justify-between border-b border-slate-100 pb-2 mb-3">
                          <div>
                            <div className="text-xs font-bold text-slate-900 font-mono">
                              Observation Inspector · Station {selectedAnomaly.station_id}
                            </div>
                            <div className="text-[11px] text-slate-500 font-mono mt-0.5">
                              Timestamp: {selectedAnomaly.ts} UTC
                            </div>
                          </div>
                          {(() => {
                            const isNetworkStation = Boolean(
                              meta?.stations?.some((s) => s.station_id === selectedAnomaly.station_id)
                            );
                            if (onSelectStation && isNetworkStation) {
                              return (
                                <button
                                  onClick={() => onSelectStation(selectedAnomaly.station_id)}
                                  className="text-xs font-semibold text-sky-700 hover:text-sky-900 cursor-pointer"
                                >
                                  Open Station Details &rarr;
                                </button>
                              );
                            }
                            return (
                              <span
                                className="text-[11px] font-medium text-slate-500 bg-slate-100 px-2 py-0.5 rounded border border-slate-200"
                                title="Uploaded batch station: ML verdict and SHAP attribution are analyzed directly in this view"
                              >
                                Batch Upload Station
                              </span>
                            );
                          })()}
                        </div>

                        {/* Readings Row */}
                        <div className="grid grid-cols-3 gap-2 font-mono text-center text-xs">
                          <div className="p-2 bg-slate-50 rounded border border-slate-200">
                            <div className="text-[10px] text-slate-400 font-sans uppercase">Temp</div>
                            <div className="font-bold text-slate-800 mt-0.5">
                              {selectedAnomaly.temp != null
                                ? `${selectedAnomaly.temp.toFixed(1)}°C`
                                : '—'}
                            </div>
                          </div>
                          <div className="p-2 bg-slate-50 rounded border border-slate-200">
                            <div className="text-[10px] text-slate-400 font-sans uppercase">Pres</div>
                            <div className="font-bold text-slate-800 mt-0.5">
                              {selectedAnomaly.pres != null
                                ? `${selectedAnomaly.pres.toFixed(0)} hPa`
                                : '—'}
                            </div>
                          </div>
                          <div className="p-2 bg-slate-50 rounded border border-slate-200">
                            <div className="text-[10px] text-slate-400 font-sans uppercase">RH</div>
                            <div className="font-bold text-slate-800 mt-0.5">
                              {selectedAnomaly.rh != null
                                ? `${selectedAnomaly.rh.toFixed(0)}%`
                                : '—'}
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* Complete DiagnosisPanel (Verdict, Why, SHAP, and Sensor Result) */}
                      <DiagnosisPanel observation={selectedAnomaly} />
                    </>
                  ) : (
                    <div className="p-12 text-center text-slate-400 bg-white rounded-lg border border-slate-200 text-xs">
                      Select an anomaly from the table to inspect its diagnosis.
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      ) : (
        /* Single Observation Ingestion Form */
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-6 bg-white p-6 rounded-lg border border-slate-200 shadow-xs">
            <h2 className="text-xs font-bold text-slate-800 uppercase tracking-wider font-mono mb-2">
              Single AWS Observation Telemetry Ingestion
            </h2>
            <p className="text-xs text-slate-500 mb-4 leading-relaxed font-sans">
              Sends an observation through the production endpoint <code>POST /api/ingest</code>, executing
              the full Tier-1 QC, feature generation, LightGBM detector, SHAP attribution, and spatial/climatology model.
            </p>

            <form onSubmit={handleIngestSubmit} className="space-y-3.5 text-xs">
              <div>
                <label className="block text-slate-700 font-semibold mb-1">Station ID</label>
                <input
                  type="text"
                  required
                  value={ingestForm.station_id}
                  onChange={(e) => setIngestForm({ ...ingestForm, station_id: e.target.value })}
                  className="w-full px-3 py-1.5 border border-slate-300 rounded font-mono focus:outline-none focus:ring-1 focus:ring-sky-500"
                />
              </div>

              <div>
                <label className="block text-slate-700 font-semibold mb-1">Timestamp</label>
                <input
                  type="text"
                  required
                  value={ingestForm.timestamp}
                  onChange={(e) => setIngestForm({ ...ingestForm, timestamp: e.target.value })}
                  className="w-full px-3 py-1.5 border border-slate-300 rounded font-mono focus:outline-none focus:ring-1 focus:ring-sky-500"
                />
              </div>

              <div className="grid grid-cols-3 gap-2.5">
                <div>
                  <label className="block text-slate-700 font-semibold mb-1">Temp (°C)</label>
                  <input
                    type="number"
                    step="0.1"
                    value={ingestForm.temperature ?? ''}
                    onChange={(e) =>
                      setIngestForm({
                        ...ingestForm,
                        temperature: e.target.value === '' ? null : parseFloat(e.target.value),
                      })
                    }
                    className="w-full px-2.5 py-1.5 border border-slate-300 rounded font-mono focus:outline-none focus:ring-1 focus:ring-sky-500"
                  />
                </div>
                <div>
                  <label className="block text-slate-700 font-semibold mb-1">Pres (hPa)</label>
                  <input
                    type="number"
                    step="0.1"
                    value={ingestForm.pressure ?? ''}
                    onChange={(e) =>
                      setIngestForm({
                        ...ingestForm,
                        pressure: e.target.value === '' ? null : parseFloat(e.target.value),
                      })
                    }
                    className="w-full px-2.5 py-1.5 border border-slate-300 rounded font-mono focus:outline-none focus:ring-1 focus:ring-sky-500"
                  />
                </div>
                <div>
                  <label className="block text-slate-700 font-semibold mb-1">RH (%)</label>
                  <input
                    type="number"
                    step="1"
                    value={ingestForm.humidity ?? ''}
                    onChange={(e) =>
                      setIngestForm({
                        ...ingestForm,
                        humidity: e.target.value === '' ? null : parseFloat(e.target.value),
                      })
                    }
                    className="w-full px-2.5 py-1.5 border border-slate-300 rounded font-mono focus:outline-none focus:ring-1 focus:ring-sky-500"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={isIngesting}
                className="w-full mt-2 inline-flex items-center justify-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-sky-700 rounded hover:bg-sky-800 transition cursor-pointer disabled:opacity-50"
              >
                <Send className="w-3.5 h-3.5" />
                <span>{isIngesting ? 'Evaluating...' : 'Submit Observation for QC Evaluation'}</span>
              </button>
            </form>

            {ingestError && (
              <div className="mt-4">
                <ErrorState title="Ingestion Error" message={ingestError} />
              </div>
            )}
          </div>

          {/* Ingestion Response Card with DiagnosisPanel */}
          <div className="lg:col-span-6 space-y-4">
            {ingestResult ? (
              <DiagnosisPanel observation={ingestResult} />
            ) : (
              <div className="bg-white p-12 rounded-lg border border-slate-200 h-full flex flex-col items-center justify-center text-center text-slate-400 text-xs shadow-xs">
                <CheckCircle2 className="w-8 h-8 mb-2 stroke-1 text-slate-300" />
                Submit an observation to see real-time QC classification, root-cause attribution, SHAP
                drivers, and recommended maintenance action.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
