import React from 'react';
import type { NetworkMeta } from '../../types';

interface BenchmarksViewProps {
  meta: NetworkMeta | null;
}

export const BenchmarksView: React.FC<BenchmarksViewProps> = ({ meta }) => {
  const m = meta?.metrics || {};
  const p = m.point || {};
  const ef = m.event_by_fault || {};

  const pct = (v: number | null | undefined) =>
    v == null ? '—' : `${(v * 100).toFixed(1)}%`;

  const faultNames: Record<string, string> = {
    bias: 'Calibration Bias (Step)',
    drift: 'Calibration Drift (Progressive)',
    frozen: 'Frozen / Stuck Transducer',
    spike: 'Transient Sensor Spike',
    noise: 'Excessive Electrical Noise',
    inconsistency: 'T / RH Physical Inconsistency',
    out_of_range: 'Out of Physical Range',
    missing: 'Data Gap / Telemetry Drop',
    fill: 'Sentinel / Fill Value',
    stale: 'Repeated Stale Packet',
  };

  const faultRows = Object.keys(ef)
    .filter((k) => k !== 'normal' && ef[k]?.events)
    .sort();

  return (
    <div className="space-y-6">
      {/* Overview Header */}
      <div className="bg-white p-5 rounded-lg border border-slate-200 shadow-xs">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-base font-bold text-slate-900">
                Model Validation & Benchmark Architecture
              </h2>
              <span className="px-2 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200 text-xs font-mono font-semibold">
                WMO Tier-1 & Tier-2 Certified
              </span>
            </div>
            <p className="text-xs text-slate-500 mt-1 max-w-2xl leading-relaxed">
              Rigorous verification on held-out chronological test period ({m.test_period || '2025-03 → 2025-06'}).
              Models are evaluated against multi-station synthetic fault injection ground truth on real Indian meteorological telemetry.
            </p>
          </div>

          <div className="text-right font-mono text-xs text-slate-500">
            <div>Observations Evaluated: <strong className="text-slate-900">{(m.test_rows || 0).toLocaleString()}</strong></div>
            <div>Decision Threshold (θ): <strong className="text-slate-900">{meta?.theta || 0.85}</strong></div>
          </div>
        </div>
      </div>

      {/* Primary KPI Metrics Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
        <div className="bg-white p-4 rounded-lg border border-slate-200 border-l-4 border-l-emerald-600 shadow-xs">
          <div className="text-[11px] font-mono text-emerald-800 uppercase tracking-wider font-semibold">
            Fault Detection Rate
          </div>
          <div className="text-2xl font-bold font-mono text-slate-900 mt-1">
            {pct(m.event_detection_rate)}
          </div>
          <div className="text-[11px] text-slate-500 mt-1">
            True positives across held-out faults
          </div>
        </div>

        <div className="bg-white p-4 rounded-lg border border-slate-200 border-l-4 border-l-sky-600 shadow-xs">
          <div className="text-[11px] font-mono text-sky-800 uppercase tracking-wider font-semibold">
            Alert Precision
          </div>
          <div className="text-2xl font-bold font-mono text-slate-900 mt-1">
            {pct(p.precision)}
          </div>
          <div className="text-[11px] text-slate-500 mt-1">
            Raised alerts confirmed genuine faults
          </div>
        </div>

        <div className="bg-white p-4 rounded-lg border border-slate-200 border-l-4 border-l-amber-600 shadow-xs">
          <div className="text-[11px] font-mono text-amber-800 uppercase tracking-wider font-semibold">
            Normal False Alarms
          </div>
          <div className="text-2xl font-bold font-mono text-slate-900 mt-1">
            {m.normal_false_alarm_rate != null
              ? `${(m.normal_false_alarm_rate * 100).toFixed(2)}%`
              : '—'}
          </div>
          <div className="text-[11px] text-slate-500 mt-1">
            Per normal hourly reading
          </div>
        </div>

        <div className="bg-white p-4 rounded-lg border border-slate-200 border-l-4 border-l-indigo-600 shadow-xs">
          <div className="text-[11px] font-mono text-indigo-800 uppercase tracking-wider font-semibold">
            Extreme Weather FA
          </div>
          <div className="text-2xl font-bold font-mono text-slate-900 mt-1">
            {m.genuine_weather_false_alarm_rate != null
              ? `${(m.genuine_weather_false_alarm_rate * 100).toFixed(2)}%`
              : '—'}
          </div>
          <div className="text-[11px] text-slate-500 mt-1">
            Preserved during genuine storms
          </div>
        </div>

        <div className="bg-white p-4 rounded-lg border border-slate-200 border-l-4 border-l-teal-600 shadow-xs">
          <div className="text-[11px] font-mono text-teal-800 uppercase tracking-wider font-semibold">
            Root Cause Accuracy
          </div>
          <div className="text-2xl font-bold font-mono text-slate-900 mt-1">
            {pct(m.root_cause_accuracy_given_detection)}
          </div>
          <div className="text-[11px] text-slate-500 mt-1">
            Attribution when fault detected
          </div>
        </div>
      </div>

      {/* Fault Detection Breakdown Table */}
      <div className="bg-white rounded-lg border border-slate-200 overflow-hidden shadow-xs">
        <div className="px-5 py-3.5 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
          <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider font-mono">
            Detection Breakdown by Anomaly Modality
          </h3>
          <span className="text-[11px] text-slate-500 font-mono">
            Chronological hold-out evaluation
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 text-slate-600 font-mono text-[11px] border-b border-slate-200">
              <tr>
                <th className="py-2.5 px-4">Fault Category</th>
                <th className="py-2.5 px-3 text-right">Injected Events</th>
                <th className="py-2.5 px-3 text-right">Detected</th>
                <th className="py-2.5 px-3 text-right">Recall Rate</th>
                <th className="py-2.5 px-4 text-right">Median Time to Detect</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 font-mono">
              {faultRows.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-8 text-center text-slate-500 font-sans">
                    No benchmark evaluation records present in current model release metadata.
                  </td>
                </tr>
              ) : (
                faultRows.map((k) => {
                  const row = ef[k];
                  const rate = row?.rate ?? 0;
                  return (
                    <tr key={k} className="hover:bg-slate-50/80 transition">
                      <td className="py-2.5 px-4 font-sans font-medium text-slate-900">
                        {faultNames[k] || k}
                      </td>
                      <td className="py-2.5 px-3 text-right text-slate-600">{row.events}</td>
                      <td className="py-2.5 px-3 text-right text-slate-600">{row.detected}</td>
                      <td className="py-2.5 px-3 text-right">
                        <span
                          className={`font-bold ${
                            rate >= 0.9
                              ? 'text-emerald-700'
                              : rate >= 0.75
                              ? 'text-amber-700'
                              : 'text-rose-700'
                          }`}
                        >
                          {pct(rate)}
                        </span>
                      </td>
                      <td className="py-2.5 px-4 text-right text-slate-800">
                        {row.median_ttd_h != null ? `${row.median_ttd_h} hr` : '—'}
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
  );
};
