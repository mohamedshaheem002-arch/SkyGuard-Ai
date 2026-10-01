export type VerdictType =
  | 'NORMAL'
  | 'SENSOR_FAULT'
  | 'GENUINE_WEATHER_EVENT'
  | 'DATA_COMM_ISSUE'
  | 'UNCERTAIN';

export type SeverityType = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export type NavigationTab =
  | 'overview'
  | 'map'
  | 'stations'
  | 'alerts'
  | 'test'
  | 'benchmarks';

export interface StationMeta {
  station_id: string;
  name: string;
  lat: number;
  lon: number;
  elev: number;
  region?: string;
}

export interface SystemHealth {
  status: 'healthy' | 'degraded';
  service: string;
  version: string;
  models_loaded: boolean;
  stations_count: number;
  demo_mode: boolean;
  features_count: number;
  threshold: number;
  timestamp: string;
}

export interface NetworkMeta {
  stations: StationMeta[];
  theta: number;
  n_features: number;
  metrics: Record<string, any>;
  demo_window: [string, string];
  neighbours: Record<string, string[]>;
  demo_mode: boolean;
  mode: string;
}

export interface SensorHealth {
  health: number;
  status: 'HEALTHY' | 'WATCH' | 'MAINTENANCE' | 'CRITICAL';
  bias_24h?: number;
  drift_slope_z_per_day?: number;
  days_to_tolerance_breach?: number | null;
}

export interface StationHealthRecord {
  temp: SensorHealth;
  pres: SensorHealth;
  rh: SensorHealth;
  station: {
    health: number;
    status: 'HEALTHY' | 'WATCH' | 'MAINTENANCE' | 'CRITICAL';
  };
}

export interface ObservationRow {
  ts: string;
  station_id: string;
  temp: number | null;
  pres: number | null;
  rh: number | null;
  verdict: VerdictType;
  fault: string | null;
  sensor: string | null;
  severity: SeverityType;
  confidence: number | null;
  explanation: string;
  action: string;
  corrected: number | null;
  bias_estimate: number | null;
  p_fault: number | null;
  temp_expected?: number | null;
  pres_expected?: number | null;
  rh_expected?: number | null;
  temp_cz?: number | null;
  pres_cz?: number | null;
  rh_cz?: number | null;
  temp_sp_z?: number | null;
  pres_sp_z?: number | null;
  rh_sp_z?: number | null;
  temp_witness?: number | null;
  pres_witness?: number | null;
  rh_witness?: number | null;
  shap_top?: [string, number][] | null;
  truth_fault?: string;
}

export interface AlertEpisode extends ObservationRow {
  start: string;
  hours: number;
  active: boolean;
}

export interface StationSummary {
  station_id: string;
  n: number;
  faults: number;
  comm: number;
  genuine: number;
  health: number | { health: number; status: string };
  sensors: {
    temp: SensorHealth;
    pres: SensorHealth;
    rh: SensorHealth;
  };
  last_alert: string | null;
}

export interface OverviewData {
  report: {
    rows: number;
    alerts: number;
    seconds: number;
    cadence_h: number;
    verdict_counts: Record<string, number>;
    fault_counts?: Record<string, number>;
  };
  stations: StationSummary[];
  recent_alerts: AlertEpisode[];
  verdict_counts: Record<string, number>;
  latest: Record<string, ObservationRow>;
  demo_mode?: boolean;
}

export interface StationDetailData {
  station_id: string;
  series: {
    ts: string[];
    temp: (number | null)[];
    pres: (number | null)[];
    rh: (number | null)[];
    true_temp?: (number | null)[];
    true_pres?: (number | null)[];
    true_rh?: (number | null)[];
    temp_expected?: (number | null)[];
    pres_expected?: (number | null)[];
    rh_expected?: (number | null)[];
    verdict: VerdictType[];
    fault: (string | null)[];
    sensor: (string | null)[];
    severity: SeverityType[];
    corrected: (number | null)[];
    p_fault: (number | null)[];
    truth_fault?: (string | null)[];
  };
  alerts: ObservationRow[];
  health: StationHealthRecord;
  confusion: {
    tp: number;
    fp: number;
    fn: number;
    tn: number;
  };
  neighbours: string[];
}

export interface IngestRequest {
  station_id: string;
  timestamp: string;
  temperature?: number | null;
  pressure?: number | null;
  humidity?: number | null;
}

export interface ScoreResponse {
  report: {
    rows: number;
    alerts: number;
    seconds: number;
    cadence_h: number;
    verdict_counts: Record<string, number>;
    upload_id?: string;
    schema?: {
      mapped: Record<string, string>;
      notes: string[];
    };
    unseen_stations?: string[];
  };
  alerts: ObservationRow[];
  stations: Record<string, {
    n: number;
    verdicts: Record<string, number>;
    health: StationHealthRecord;
  }>;
  series: Record<string, any>;
}

export interface ChatMessageItem {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp?: string;
  toolsUsed?: { tool: string; args?: Record<string, any> }[];
  isStreaming?: boolean;
}

export interface ChatContextPayload {
  active_tab?: NavigationTab;
  selected_station_id?: string | null;
  selected_timestamp?: string | null;
  upload_id?: string | null;
  [key: string]: any;
}

export interface ChatStatusResponse {
  configured: boolean;
  service: string;
  model: string;
  tools_count: number;
  status: 'ready' | 'missing_api_key' | 'error';
}
