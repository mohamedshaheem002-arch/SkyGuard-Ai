import React from 'react';
import type { ObservationRow } from '../../types';
import {
  SENSOR_NAMES,
  SENSOR_UNITS,
  VERDICT_LABELS,
  VERDICT_COLORS,
  SEVERITY_COLORS,
  formatFeatureName,
  extractEvidence,
  getPlainEnglishExplanation,
  formatCauseLabel,
} from '../../utils/diagnosis';
import { CheckCircle2, AlertTriangle, ArrowRight } from 'lucide-react';

interface DiagnosisPanelProps {
  observation: ObservationRow;
  neighbourCount?: number;
  theta?: number;
  mostRecentAnomaly?: { ts: string; verdict: string } | null;
  onSelectTimestamp?: (ts: string) => void;
}

export const DiagnosisPanel: React.FC<DiagnosisPanelProps> = ({
  observation,
  neighbourCount,
  theta = 0.85,
  mostRecentAnomaly,
  onSelectTimestamp,
}) => {
  const ev = extractEvidence(observation, neighbourCount);
  const plainText = getPlainEnglishExplanation(observation, ev, theta);
  const verdictColor = VERDICT_COLORS[observation.verdict] || '#64748b';
  const cause = formatCauseLabel(observation);
  const confPct =
    observation.confidence != null
      ? `${Math.round(observation.confidence * 100)}%`
      : '—';

  const cusumStr =
    ev.cus != null
      ? ev.cus > 5
        ? `HIGH (${ev.cus.toFixed(1)})`
        : `normal (${ev.cus.toFixed(1)})`
      : ['bias', 'drift'].includes(observation.fault || '') &&
        observation.verdict === 'SENSOR_FAULT'
      ? 'HIGH'
      : 'not triggered';

  const agreeStr =
    ev.k != null && ev.n != null
      ? `${ev.k}/${ev.n}`
      : ev.w != null
      ? `${Math.round(ev.w * 100)}%`
      : '—';

  const spzStr =
    ev.sp_z != null
      ? `${ev.sp_z > 0 ? '+' : ''}${ev.sp_z.toFixed(1)}σ`
      : 'no neighbours';

  const czStr =
    ev.cz != null
      ? `${ev.cz > 0 ? '+' : ''}${ev.cz.toFixed(1)}σ`
      : '—';

  return (
    <div className="space-y-4">
      {/* 1. FINAL VERDICT BANNER */}
      <div
        className="p-4 rounded-lg border flex flex-wrap items-center justify-between gap-4 shadow-2xs"
        style={{
          borderColor: `${verdictColor}40`,
          backgroundColor: `${verdictColor}0e`,
        }}
      >
        <div>
          <div className="text-[11px] font-mono uppercase tracking-wider text-slate-500 font-semibold">
            Final Verdict · This Reading
          </div>
          <div
            className="text-2xl font-extrabold tracking-tight mt-0.5"
            style={{ color: verdictColor }}
          >
            {VERDICT_LABELS[observation.verdict] || observation.verdict}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-4 text-xs font-mono">
          {observation.verdict !== 'NORMAL' && (
            <>
              <div>
                <div className="text-[10px] uppercase text-slate-400 font-sans">
                  Cause
                </div>
                <div className="font-bold text-slate-800">
                  {cause}
                  {observation.sensor && ['temp', 'pres', 'rh'].includes(observation.sensor) && (
                    <span className="text-slate-500 font-normal ml-1">
                      · {SENSOR_NAMES[observation.sensor]}
                    </span>
                  )}
                </div>
              </div>

              <div>
                <div className="text-[10px] uppercase text-slate-400 font-sans">
                  Severity
                </div>
                <div
                  className="font-bold"
                  style={{ color: SEVERITY_COLORS[observation.severity] || '#64748b' }}
                >
                  {observation.severity}
                </div>
              </div>
            </>
          )}

          <div>
            <div className="text-[10px] uppercase text-slate-400 font-sans">
              Confidence
            </div>
            <div className="font-bold text-slate-900">{confPct}</div>
          </div>
        </div>
      </div>

      {/* 2. WHY THIS RESULT? PANEL */}
      <div className="bg-white p-5 rounded-lg border border-slate-200 shadow-xs space-y-4">
        <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider font-mono">
          Why This Result?
        </h3>

        {/* 4 Summary Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs font-mono">
          <div className="p-2.5 rounded bg-slate-50 border border-slate-200/80">
            <div className="text-[10px] uppercase text-slate-400 font-sans">Verdict</div>
            <div className="font-bold mt-0.5 truncate" style={{ color: verdictColor }}>
              {observation.verdict.replace(/_/g, ' ')}
            </div>
          </div>
          <div className="p-2.5 rounded bg-slate-50 border border-slate-200/80">
            <div className="text-[10px] uppercase text-slate-400 font-sans">Root Cause</div>
            <div className="font-bold mt-0.5 text-slate-800 truncate">{cause}</div>
          </div>
          <div className="p-2.5 rounded bg-slate-50 border border-slate-200/80">
            <div className="text-[10px] uppercase text-slate-400 font-sans">Severity</div>
            <div
              className="font-bold mt-0.5"
              style={{ color: observation.verdict === 'NORMAL' ? '#94a3b8' : SEVERITY_COLORS[observation.severity] }}
            >
              {observation.verdict === 'NORMAL' ? '—' : observation.severity}
            </div>
          </div>
          <div className="p-2.5 rounded bg-slate-50 border border-slate-200/80">
            <div className="text-[10px] uppercase text-slate-400 font-sans">Confidence</div>
            <div className="font-bold mt-0.5 text-slate-900">{confPct}</div>
          </div>
        </div>

        {/* Evidence Metric Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-2 text-xs border-y border-slate-100 py-3 font-mono">
          <div className="flex justify-between items-center py-0.5">
            <span className="text-slate-500 font-sans">
              Spatial deviation · {SENSOR_NAMES[ev.sen]} vs neighbours:
            </span>
            <span className="font-bold text-slate-800">{spzStr}</span>
          </div>
          <div className="flex justify-between items-center py-0.5">
            <span className="text-slate-500 font-sans">Neighbour agreement:</span>
            <span className="font-bold text-slate-800">{agreeStr}</span>
          </div>
          <div className="flex justify-between items-center py-0.5">
            <span className="text-slate-500 font-sans">Climatology deviation:</span>
            <span className="font-bold text-slate-800">{czStr}</span>
          </div>
          <div className="flex justify-between items-center py-0.5">
            <span className="text-slate-500 font-sans">CUSUM (sustained offset):</span>
            <span className="font-bold text-slate-800">{cusumStr}</span>
          </div>
        </div>

        {/* Plain-English Context Paragraph */}
        <div className="p-3.5 rounded bg-slate-50 border-l-4 border-sky-600 text-xs text-slate-700 leading-relaxed font-sans">
          {plainText}
        </div>

        {/* Recent Anomaly Callout (if viewing Normal observation) */}
        {observation.verdict === 'NORMAL' && mostRecentAnomaly && onSelectTimestamp && (
          <div className="flex items-center justify-between p-3 rounded bg-amber-50/60 border border-amber-200 text-xs text-amber-900 font-sans">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
              <span>
                Most recent anomaly at this station: <strong>{mostRecentAnomaly.ts}</strong> (
                {mostRecentAnomaly.verdict.replace(/_/g, ' ')})
              </span>
            </div>
            <button
              onClick={() => onSelectTimestamp(mostRecentAnomaly.ts)}
              className="inline-flex items-center gap-1 font-semibold text-sky-700 hover:text-sky-900 cursor-pointer"
            >
              <span>Inspect anomaly</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* Technical Explanation Details */}
        {observation.explanation && (
          <details className="text-xs text-slate-500">
            <summary className="cursor-pointer hover:text-slate-700 font-medium select-none">
              Technical Decision Trace & Diagnostic Detail
            </summary>
            <div className="mt-2 p-2.5 rounded bg-slate-50 border border-slate-200 font-mono text-[11px] text-slate-700 whitespace-pre-wrap leading-relaxed">
              {observation.explanation}
            </div>
          </details>
        )}
      </div>

      {/* 3. SHAP TOP FEATURE DRIVERS PANEL */}
      <div className="bg-white p-5 rounded-lg border border-slate-200 shadow-xs space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider font-mono">
            SHAP Attribution: Why The Model Flagged This
          </h3>
          <span className="text-[11px] font-mono text-slate-400">TreeExplainer Features</span>
        </div>

        {observation.verdict === 'NORMAL' ? (
          <div className="p-4 text-center rounded bg-slate-50 text-slate-500 text-xs font-sans flex items-center justify-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600" />
            <span>
              All checks within normal bounds — no anomaly detected. Model fault probability:{' '}
              <strong className="font-mono text-slate-700">
                {Math.round((observation.p_fault || 0) * 100)}%
              </strong>{' '}
              (decision threshold θ = {Math.round(theta * 100)}%).
            </span>
          </div>
        ) : observation.shap_top && observation.shap_top.length > 0 ? (
          <div className="space-y-2.5 pt-1">
            {(() => {
              const maxVal = Math.max(...observation.shap_top.map(([, v]) => v), 0.001);
              return observation.shap_top.slice(0, 5).map(([feat, val], idx) => {
                const ratio = val / maxVal;
                const pctWidth = Math.max(8, Math.round(ratio * 100));
                const featName = formatFeatureName(feat);
                let label =
                  ratio >= 0.75
                    ? 'Strong Driver'
                    : ratio >= 0.4
                    ? 'High Impact'
                    : ratio >= 0.15
                    ? 'Moderate'
                    : 'Low';

                const m = feat.match(/^(temp|pres|rh)_(cz|sp_z)$/);
                if (m) {
                  const numVal = observation[feat as keyof ObservationRow] as number;
                  if (numVal != null) {
                    label = `${numVal > 0 ? '+' : ''}${numVal.toFixed(1)}σ`;
                  }
                }

                return (
                  <div key={idx} className="space-y-1">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-medium text-slate-800 font-sans">{featName}</span>
                      <span className="font-mono text-[11px] font-bold text-slate-600">
                        {label} <span className="text-slate-400 font-normal">({val.toFixed(2)})</span>
                      </span>
                    </div>
                    <div className="w-full bg-slate-100 rounded-full h-2 overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all"
                        style={{
                          width: `${pctWidth}%`,
                          backgroundColor: verdictColor,
                        }}
                      />
                    </div>
                  </div>
                );
              });
            })()}
          </div>
        ) : (
          /* When decision was made deterministically or override */
          <div className="space-y-3 pt-1">
            <div className="text-xs text-slate-600 bg-slate-50 p-2.5 rounded border border-slate-200/80 leading-relaxed font-sans">
              {observation.verdict === 'GENUINE_WEATHER_EVENT' ? (
                <span>
                  <strong>Decided by spatial witness consensus test:</strong> {agreeStr}{' '}
                  neighbouring stations show the same anomaly, so the reading is confirmed as real
                  regional weather (individual sensor fault hypothesis overruled).
                </span>
              ) : observation.verdict === 'UNCERTAIN' ? (
                <span>
                  Model fault probability ({confPct}) is below the {Math.round(theta * 100)}% alert
                  threshold — no active alert raised, re-evaluating with next readings.
                </span>
              ) : (
                <span>
                  Decided by deterministic WMO quality-control rule (Tier-1 deterministic flag) —
                  short-circuited before tree model feature weighting was required.
                </span>
              )}
            </div>

            {/* Heuristic component bars */}
            <div className="space-y-2 text-xs font-mono">
              <div className="space-y-1">
                <div className="flex justify-between text-slate-700">
                  <span>Spatial Deviation</span>
                  <span className="font-bold">{spzStr}</span>
                </div>
                <div className="w-full bg-slate-100 rounded-full h-1.5 overflow-hidden">
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${Math.min(100, (Math.abs(ev.sp_z || 0) / 6) * 100)}%`,
                      backgroundColor: verdictColor,
                    }}
                  />
                </div>
              </div>

              <div className="space-y-1">
                <div className="flex justify-between text-slate-700">
                  <span>Climatology Deviation</span>
                  <span className="font-bold">{czStr}</span>
                </div>
                <div className="w-full bg-slate-100 rounded-full h-1.5 overflow-hidden">
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${Math.min(100, (Math.abs(ev.cz || 0) / 6) * 100)}%`,
                      backgroundColor: verdictColor,
                    }}
                  />
                </div>
              </div>

              <div className="space-y-1">
                <div className="flex justify-between text-slate-700">
                  <span>Neighbour Agreement</span>
                  <span className="font-bold">{agreeStr}</span>
                </div>
                <div className="w-full bg-slate-100 rounded-full h-1.5 overflow-hidden">
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${(ev.w || 0) * 100}%`,
                      backgroundColor: verdictColor,
                    }}
                  />
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* 4. SENSOR RESULT (Prominently displayed only for SENSOR_FAULT) */}
      {observation.verdict === 'SENSOR_FAULT' &&
        observation.sensor &&
        ['temp', 'pres', 'rh'].includes(observation.sensor) && (
          <div className="bg-rose-50/70 border border-rose-200 rounded-lg p-5 shadow-xs space-y-3 font-sans">
            <div className="flex items-center justify-between border-b border-rose-200 pb-2">
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-rose-600 animate-pulse"></span>
                <h3 className="text-xs font-bold text-rose-900 uppercase tracking-wider font-mono">
                  Sensor Result · {SENSOR_NAMES[observation.sensor]} Element
                </h3>
              </div>
              <span className="px-2 py-0.5 rounded bg-rose-600 text-white font-mono text-[10px] font-bold uppercase">
                FAULT DETECTED
              </span>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs font-mono">
              <div className="bg-white p-2.5 rounded border border-rose-100">
                <div className="text-[10px] uppercase text-slate-400 font-sans">Root Cause</div>
                <div className="font-bold text-rose-800 capitalize mt-0.5">{cause}</div>
              </div>

              <div className="bg-white p-2.5 rounded border border-rose-100">
                <div className="text-[10px] uppercase text-slate-400 font-sans">Observed Value</div>
                <div className="font-bold text-slate-900 mt-0.5">
                  {observation[observation.sensor as 'temp' | 'pres' | 'rh'] != null
                    ? `${Number(observation[observation.sensor as 'temp' | 'pres' | 'rh']).toFixed(
                        observation.sensor === 'rh' ? 0 : 1
                      )} ${SENSOR_UNITS[observation.sensor]}`
                    : '—'}
                </div>
              </div>

              <div className="bg-white p-2.5 rounded border border-rose-100">
                <div className="text-[10px] uppercase text-slate-400 font-sans">Estimated Bias</div>
                <div className="font-bold text-slate-800 mt-0.5">
                  {observation.bias_estimate != null
                    ? `${observation.bias_estimate > 0 ? '+' : ''}${observation.bias_estimate.toFixed(
                        observation.sensor === 'rh' ? 0 : 1
                      )} ${SENSOR_UNITS[observation.sensor]}`
                    : '—'}
                </div>
              </div>

              <div className="bg-white p-2.5 rounded border border-emerald-200">
                <div className="text-[10px] uppercase text-emerald-800 font-sans font-semibold">
                  Corrected Estimate
                </div>
                <div className="font-bold text-emerald-700 mt-0.5">
                  {observation.corrected != null
                    ? `${observation.corrected.toFixed(
                        observation.sensor === 'rh' ? 0 : 1
                      )} ${SENSOR_UNITS[observation.sensor]}`
                    : '—'}
                </div>
              </div>
            </div>

            <div className="p-3 bg-white rounded border border-rose-200 text-xs">
              <strong className="text-slate-800 font-sans">Recommended Action:</strong>{' '}
              <span className="text-slate-700">{observation.action || 'Inspect sensor element.'}</span>
            </div>

            <div className="text-[10px] font-mono font-bold text-amber-700 bg-amber-50 px-2.5 py-1 rounded border border-amber-200 inline-block">
              MODEL ESTIMATE — NOT RAW OBSERVATION
            </div>
          </div>
        )}
    </div>
  );
};
