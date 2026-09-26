import React from 'react';
import type { VerdictType } from '../../types';

interface VerdictBadgeProps {
  verdict: VerdictType | string;
  size?: 'sm' | 'md' | 'lg';
}

const VERDICT_CONFIG: Record<string, { label: string; bg: string; text: string; border: string }> = {
  NORMAL: {
    label: 'NORMAL',
    bg: '#ecfdf5',
    text: '#047857',
    border: '#a7f3d0',
  },
  SENSOR_FAULT: {
    label: 'SENSOR FAULT',
    bg: '#fef2f2',
    text: '#b91c1c',
    border: '#fecaca',
  },
  GENUINE_WEATHER_EVENT: {
    label: 'WEATHER EVENT',
    bg: '#fff7ed',
    text: '#c2410c',
    border: '#fed7aa',
  },
  DATA_COMM_ISSUE: {
    label: 'DATA COMM ISSUE',
    bg: '#eff6ff',
    text: '#1d4ed8',
    border: '#bfdbfe',
  },
  UNCERTAIN: {
    label: 'UNCERTAIN',
    bg: '#fefce8',
    text: '#a16207',
    border: '#fef08a',
  },
};

export const VerdictBadge: React.FC<VerdictBadgeProps> = ({ verdict, size = 'md' }) => {
  const cfg = VERDICT_CONFIG[verdict] || {
    label: verdict || 'UNKNOWN',
    bg: '#f1f5f9',
    text: '#475569',
    border: '#cbd5e1',
  };

  const sizeStyles = {
    sm: 'text-[11px] px-1.5 py-0.5 font-medium',
    md: 'text-xs px-2.5 py-0.5 font-semibold',
    lg: 'text-sm px-3 py-1 font-semibold',
  };

  return (
    <span
      className={`inline-flex items-center rounded border tracking-wide uppercase font-mono ${sizeStyles[size]}`}
      style={{
        backgroundColor: cfg.bg,
        color: cfg.text,
        borderColor: cfg.border,
      }}
    >
      {cfg.label}
    </span>
  );
};
