import type { ObservationRow, VerdictType, SeverityType } from '../types';

export const SENSOR_NAMES: Record<string, string> = {
  temp: 'Temperature',
  pres: 'Pressure',
  rh: 'Humidity',
  td: 'Dew point',
  all: 'All sensors',
};

export const SENSOR_UNITS: Record<string, string> = {
  temp: '°C',
  pres: 'hPa',
  rh: '%',
};

export const FAULT_NAMES: Record<string, string> = {
  bias: 'Calibration bias',
  drift: 'Calibration drift',
  frozen: 'Stuck / frozen sensor',
  spike: 'Transient spike',
  noise: 'Excessive noise',
  inconsistency: 'T / RH physical inconsistency',
  out_of_range: 'Out of plausible range',
  missing: 'No telemetry (gap)',
  fill: 'Fill / sentinel value',
  stale: 'Repeated packet (stale)',
  duplicate: 'Duplicate timestamp',
  normal: '—',
  unknown: 'Unclear',
};

export const VERDICT_LABELS: Record<VerdictType, string> = {
  NORMAL: 'NORMAL',
  SENSOR_FAULT: 'SENSOR FAULT',
  GENUINE_WEATHER_EVENT: 'GENUINE WEATHER EVENT',
  DATA_COMM_ISSUE: 'DATA COMM ISSUE',
  UNCERTAIN: 'UNCERTAIN',
};

export const VERDICT_COLORS: Record<VerdictType, string> = {
  NORMAL: '#10b981',
  SENSOR_FAULT: '#ef4444',
  GENUINE_WEATHER_EVENT: '#f97316',
  DATA_COMM_ISSUE: '#3b82f6',
  UNCERTAIN: '#eab308',
};

export const SEVERITY_COLORS: Record<SeverityType, string> = {
  LOW: '#94a3b8',
  MEDIUM: '#eab308',
  HIGH: '#f97316',
  CRITICAL: '#ef4444',
};

export interface EvidenceStats {
  sen: 'temp' | 'pres' | 'rh';
  k: number | null;
  n: number | null;
  sp_z: number | null;
  cz: number | null;
  w: number | null;
  cus: number | null;
  unch: number | null;
  gap: number | null;
}

/**
 * Translates raw feature columns into plain meteorological terms
 */
export function formatFeatureName(feat: string): string {
  const overrides: Record<string, string> = {
    t_stuck_rh_moving: 'Temperature frozen while humidity moves',
    rh_stuck_t_moving: 'Humidity frozen while temperature moves',
    p_t_corr12: 'Pressure / temperature 12-h correlation',
    rh_t_corr12: 'Temperature / humidity 12-h correlation',
    td_t_stdratio6: 'Dew-point stability vs temperature',
    td_minus_t: 'Dew point minus air temperature',
    all_streak_min_h: 'All sensors unchanged (hours)',
    n_missing: 'Missing sensors',
    hour_sin: 'Time of day',
    hour_cos: 'Time of day',
    month_sin: 'Season',
    month_cos: 'Season',
    pres_tend3: '3-h pressure tendency',
    pres_tend3_z: '3-h pressure tendency',
    pres_tend3_minus_nb: 'Pressure tendency vs neighbours',
  };

  if (overrides[feat]) return overrides[feat];

  const match = feat.match(/^(temp|pres|rh|td)_(.+)$/);
  if (!match) return feat.replace(/_/g, ' ');

  const sensor = SENSOR_NAMES[match[1]] || match[1];
  const suffix = match[2];

  const suffixes: Record<string, string> = {
    cz: 'vs seasonal normal',
    clim_med: 'seasonal level',
    step_z: 'hour-to-hour jump',
    step_prev_z: 'previous-hour jump',
    acc_z: 'acceleration of change',
    std6_r: '6-h variability',
    rng24_r: '24-h range',
    dstd6_r: 'change in variability',
    ewm24_cz: '24-h smoothed deviation',
    ewm72_cz: '72-h smoothed deviation',
    slope72_cz: '72-h trend',
    cusum_pos: 'sustained positive offset (CUSUM)',
    cusum_neg: 'sustained negative offset (CUSUM)',
    streak_h: 'hours unchanged',
    streak_r: 'persistence vs station norm',
    missing: 'missing',
    gap_h: 'gap length',
    oor: 'out of range',
    sp_cusum_pos: 'sustained offset vs neighbours',
    sp_cusum_neg: 'sustained offset vs neighbours',
    sp_z: 'vs neighbours (spatial)',
    sp_n: 'neighbour count',
    witness: 'neighbour agreement',
    nb_med_z: "neighbours' own anomaly",
    sp_est: 'neighbour estimate',
    sp_ewm24_z: '24-h deviation vs neighbours',
    sp_slope72_z: '72-h trend vs neighbours',
    sp_bias_med24: '24-h bias vs neighbours',
    cz_minus_nb: 'deviation not shared by neighbours',
  };

  return `${sensor} ${suffixes[suffix] || suffix.replace(/_/g, ' ')}`;
}

/**
 * Extracts numeric spatial, climatological, and consensus metrics from an observation row
 */
export function extractEvidence(
  row: ObservationRow,
  neighbourCount?: number
): EvidenceStats {
  const sens: ('temp' | 'pres' | 'rh')[] = ['temp', 'pres', 'rh'];
  let sen: 'temp' | 'pres' | 'rh' = 'temp';

  if (row.sensor && (row.sensor === 'temp' || row.sensor === 'pres' || row.sensor === 'rh')) {
    sen = row.sensor;
  } else {
    let maxCz = -1;
    sens.forEach((s) => {
      const v = Math.abs(row[`${s}_cz` as keyof ObservationRow] as number || 0);
      if (v > maxCz) {
        maxCz = v;
        sen = s;
      }
    });
  }

  const ex = row.explanation || '';
  let k: number | null = null;
  let n: number | null = neighbourCount ?? null;

  let m = ex.match(/\((\d+)\/(\d+) neighbours anomalous\)/);
  if (m) {
    k = +m[1];
    n = +m[2];
  } else if ((m = ex.match(/(\d+)\/(\d+) neighbouring stations/))) {
    k = +m[1];
    n = +m[2];
  } else if ((m = ex.match(/from (\d+) neighbours/))) {
    n = +m[1];
  }

  const w = (row[`${sen}_witness` as keyof ObservationRow] as number) ?? null;
  if (k == null && n != null && w != null) {
    k = Math.round(w * n);
  }

  const cusMatch = ex.match(/CUSUM ([\d.]+)/);
  const unchMatch = ex.match(/unchanged for (\d+) h/);
  const gapMatch = ex.match(/\((\d+) h gap\)/);

  return {
    sen,
    k,
    n,
    sp_z: (row[`${sen}_sp_z` as keyof ObservationRow] as number) ?? null,
    cz: (row[`${sen}_cz` as keyof ObservationRow] as number) ?? null,
    w,
    cus: cusMatch ? +cusMatch[1] : null,
    unch: unchMatch ? +unchMatch[1] : null,
    gap: gapMatch ? +gapMatch[1] : null,
  };
}

/**
 * Returns plain-English contextual sentence explaining the diagnosis
 */
export function getPlainEnglishExplanation(
  row: ObservationRow,
  ev: EvidenceStats,
  theta: number = 0.85
): string {
  const s = SENSOR_NAMES[ev.sen] || 'The reading';
  const unit = SENSOR_UNITS[ev.sen] || '';

  const agree =
    ev.k != null && ev.n != null
      ? `${ev.k} of ${ev.n} neighbouring stations`
      : ev.w == null
      ? 'no neighbouring station data'
      : ev.w >= 0.75
      ? 'most neighbouring stations'
      : ev.w >= 0.4
      ? 'about half of the neighbouring stations'
      : ev.w > 0
      ? 'a minority of neighbouring stations'
      : 'no neighbouring station';

  const plural = ev.k != null && ev.n != null ? ev.k !== 1 : /^(most|about half|a minority)/.test(agree);
  const agreeV = plural ? 'share it' : 'shares it';

  const nbCtx =
    ev.k === 0 || ev.w === 0
      ? 'while no neighbouring station shows anything unusual'
      : ev.k != null && ev.n != null
      ? `${ev.k} of ${ev.n} neighbouring stations are also somewhat unusual, but this station goes far beyond them`
      : ev.w != null && ev.w > 0
      ? 'some neighbouring stations are also somewhat unusual, but this station goes far beyond them'
      : 'with no neighbouring station data to support it';

  const off =
    row.bias_estimate != null
      ? ` Estimated offset ${row.bias_estimate > 0 ? '+' : ''}${row.bias_estimate.toFixed(
          ev.sen === 'rh' ? 0 : 1
        )} ${unit}.`
      : '';

  const sp =
    ev.sp_z != null
      ? `${Math.abs(ev.sp_z).toFixed(1)}σ ${ev.sp_z > 0 ? 'above' : 'below'} what nearby stations imply`
      : 'not comparable with neighbours (none available)';

  const cl =
    ev.cz != null
      ? `${Math.abs(ev.cz).toFixed(1)}σ ${ev.cz > 0 ? 'above' : 'below'} this station's normal for the season and hour`
      : 'close to its seasonal normal';

  if (row.verdict === 'GENUINE_WEATHER_EVENT') {
    return `${s} is ${cl}, but ${agree} show the same anomaly at the same time. This indicates a regional weather event rather than an isolated sensor failure — the data should be kept.`;
  }

  if (row.verdict === 'UNCERTAIN' && /natural repeat length/.test(row.explanation || '')) {
    return `${s} has read the same value for ${ev.unch || 'several'} hours. ${
      /whole numbers/.test(row.explanation)
        ? "This station's logger reports whole numbers, so identical readings for several hours are normal here"
        : 'That is still within the natural repeat length for this station'
    }${
      ev.sp_z != null
        ? `, and the value is only ${Math.abs(ev.sp_z).toFixed(1)}σ from what neighbours imply`
        : ''
    }. No alert yet — it becomes a SENSOR FAULT if it stays stuck for several more hours or starts to diverge from the neighbours.`;
  }

  if (row.verdict === 'UNCERTAIN') {
    return `There is some evidence of a fault on the ${s.toLowerCase()} sensor (fault probability ${Math.round(
      (row.p_fault || 0) * 100
    )}%), below the ${Math.round(theta * 100)}% alert threshold. ${
      agree.charAt(0).toUpperCase() + agree.slice(1)
    } ${agreeV}. No alert yet — the verdict firms up if the pattern persists.`;
  }

  if (row.verdict === 'DATA_COMM_ISSUE') {
    if (row.fault === 'missing') {
      return `No data was received for ${ev.gap || 'several'} hour(s). This is a communication or power failure at the station, not a sensor measurement problem.`;
    }
    if (row.fault === 'fill') {
      return 'The logger transmitted a fill value instead of a measurement — a firmware or configuration issue, not real weather.';
    }
    if (row.fault === 'stale') {
      return 'The station re-sent an identical T/P/RH packet several times in a row — the logger is repeating old data (clock or transmit-buffer problem).';
    }
    return 'Two reports carry the same timestamp — de-duplicate the feed and check the logger clock.';
  }

  if (row.verdict === 'SENSOR_FAULT') {
    switch (row.fault) {
      case 'bias':
      case 'drift':
        return `${s} is ${sp} and ${cl}, ${nbCtx}. The offset is one-sided and has persisted for hours (CUSUM alarm), so this is a calibration offset in the sensor, not regional weather.${off} ${
          row.fault === 'bias'
            ? 'The offset appeared as a step (bias).'
            : 'The offset looks progressive (drift) — a sudden step bias can also be reported this way once it has persisted.'
        } Either way the fix is recalibration.`;
      case 'frozen':
        return `${s} has reported the same value for ${ev.unch || 'several'} hours while neighbouring stations and the other sensors kept changing. The sensing element or its connection is stuck.`;
      case 'spike':
        return ev.cz != null && Math.abs(ev.cz) >= 3
          ? `${s} jumped far outside its normal hour-to-hour change (${cl}) and then returned, ${nbCtx} — a transient sensor or logger glitch, not weather.`
          : `The model detected a short-lived irregularity in the ${s.toLowerCase()} signal, not shared by the other sensors; the value has already returned to normal. Transient glitch — no dispatch needed.`;
      case 'noise':
        return `${s} is fluctuating far more than physically plausible while neighbouring stations are steady — electrical noise or a failing element.`;
      case 'inconsistency':
        return 'Humidity and temperature no longer move together the way physics requires (dew point above air temperature or the T/RH relationship broken). The humidity element is probably wet or contaminated.';
      case 'out_of_range':
        return 'The value is physically impossible for this instrument and has been rejected.';
      default:
        return `${s} is ${sp} and ${cl}, ${nbCtx}, so a sensor fault is more likely than a regional weather event.`;
    }
  }

  return "The reading agrees with neighbouring stations, this station's own climatology and the physical relationships between temperature, pressure and humidity.";
}

export function formatCauseLabel(row: ObservationRow): string {
  if (row.verdict === 'GENUINE_WEATHER_EVENT') {
    return 'Regional weather (neighbours agree)';
  }
  if (row.verdict === 'NORMAL') {
    return '—';
  }
  return FAULT_NAMES[row.fault || ''] || row.fault || '—';
}
